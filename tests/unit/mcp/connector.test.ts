// RepoPilot's MCP connector for TrueForge (owner: Member 1): the HTTP endpoint's safety rules,
// the active-run binding, the agent definition sent to TrueForge, and an end-to-end run in which a
// fake TrueForge server calls RepoPilot's tools over real HTTP, the way TrueForge does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createRepositoryIntelligence } from '../../../src/repository';
import { createImpactAnalyser } from '../../../src/impact';
import { createVerificationService } from '../../../src/verification';
import { createEditService } from '../../../src/edits';
import {
  ActiveRun,
  createRepoPilotTools,
  generateConnectorToken,
  READ_ONLY_TOOLS,
  RepoPilotHttpMcpServer,
  TOOL_NAMES,
} from '../../../src/mcp';
import type { ToolRegistry } from '../../../src/mcp';
import { buildAgentSpec, createRepoPilot, TrueForgeClient, TrueForgePlanner } from '../../../src/agent';
import type { TrueForgeSdk, TurnEvent } from '../../../src/agent';
import { parseTrueForgeConfig } from '../../../src/config/configuration';
import type { ChangeRequest, FileProposal, RepoPilotEvent, RepositoryContext } from '../../../src/shared/contracts';

const TOKEN = generateConnectorToken();
let root: string;
let registry: ToolRegistry;
let activeRun: ActiveRun;
let server: RepoPilotHttpMcpServer;
let url: string;
let context: RepositoryContext;

const request: ChangeRequest = {
  requestId: 'req-http',
  instruction: 'change helper',
  mode: 'agent',
  activeFile: 'pkg/util.py',
  explicitFileMentions: [],
  explicitSymbolMentions: [],
};

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'repopilot-connector-'));
  fs.mkdirSync(path.join(root, 'pkg'));
  fs.writeFileSync(path.join(root, 'pkg/__init__.py'), '');
  fs.writeFileSync(path.join(root, 'pkg/util.py'), 'def helper(x):\n    return x + 1\n');
  const repository = createRepositoryIntelligence();
  await repository.initialize(root);
  context = await repository.getContext(request);
  registry = createRepoPilotTools({
    workspaceRoot: root,
    repository,
    impact: createImpactAnalyser(),
    verification: createVerificationService(root),
    edits: createEditService(root),
  });
  activeRun = new ActiveRun();
  server = new RepoPilotHttpMcpServer(registry, activeRun, { port: 0, token: TOKEN });
  url = await server.start();
});
after(async () => {
  await server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

/** Raw HTTP request (lets the test set the Host header, which fetch does not allow). */
function rawRequest(opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<number> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: u.hostname, port: u.port, method: opts.method ?? 'POST', path: opts.path ?? u.pathname, headers: opts.headers ?? {} },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
const initBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });

async function connectClient(token = TOKEN): Promise<Client> {
  const client = new Client({ name: 'fake-trueforge', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

// ─────────────── Endpoint safety ───────────────

test('listens on 127.0.0.1 only', () => {
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
});

test('no token or a wrong token → 401', async () => {
  assert.equal(await rawRequest({ headers: { 'Content-Type': 'application/json' }, body: initBody }), 401);
  assert.equal(await rawRequest({ headers: { ...auth, Authorization: 'Bearer wrong-token' }, body: initBody }), 401);
  assert.equal(await rawRequest({ headers: { ...auth, Authorization: TOKEN }, body: initBody }), 401, 'missing "Bearer "');
});

test('a foreign Host header is refused (DNS rebinding) → 403', async () => {
  assert.equal(await rawRequest({ headers: { ...auth, Host: 'evil.example.com' }, body: initBody }), 403);
});

test('wrong path → 404, wrong method → 405, bad JSON → 400, oversized body → 413', async () => {
  assert.equal(await rawRequest({ headers: auth, path: '/other', body: initBody }), 404);
  assert.equal(await rawRequest({ headers: auth, method: 'GET' }), 405);
  assert.equal(await rawRequest({ headers: auth, body: '{not json' }), 400);
  assert.equal(await rawRequest({ headers: auth, body: 'x'.repeat(1024 * 1024 + 10) }), 413);
});

test('a short or missing token is rejected at start-up', () => {
  assert.throws(() => new RepoPilotHttpMcpServer(registry, new ActiveRun(), { port: 0, token: 'short' }), /at least 32/);
});

// ─────────────── Over the MCP protocol ───────────────

test('lists exactly the read-only allowlist, marked read-only', async () => {
  const client = await connectClient();
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...READ_ONLY_TOOLS].sort());
    for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, t.name);
  } finally {
    await client.close();
  }
});

test('with no request planning, every tool call is refused', async () => {
  const client = await connectClient();
  try {
    const res = await client.callTool({ name: TOOL_NAMES.readFile, arguments: { filePath: 'pkg/util.py' } });
    assert.equal(res.isError, true);
    assert.match(JSON.stringify(res.content), /No RepoPilot request is planning/);
  } finally {
    await client.close();
  }
});

test('during a run: read works, propose_edit only collects, apply is refused; after the run, refused again', async () => {
  const proposals = new Map<string, FileProposal>();
  const end = activeRun.begin({ requestId: 'req-http', request, context, proposals });
  const client = await connectClient();
  try {
    const read = await client.callTool({ name: TOOL_NAMES.readFile, arguments: { filePath: 'pkg/util.py' } });
    assert.ok(!read.isError);
    assert.match(JSON.stringify(read.content), /def helper/);

    const proposed = await client.callTool({
      name: TOOL_NAMES.proposeEdit,
      arguments: { path: 'pkg/util.py', proposedContent: 'def helper(x):\n    return x + 2\n' },
    });
    assert.ok(!proposed.isError);
    assert.equal(proposals.get('pkg/util.py')?.proposedContent, 'def helper(x):\n    return x + 2\n');
    assert.equal(fs.readFileSync(path.join(root, 'pkg/util.py'), 'utf-8'), 'def helper(x):\n    return x + 1\n', 'nothing written');

    const apply = await client.callTool({ name: TOOL_NAMES.applyApprovedHunks, arguments: { decisions: [] } });
    assert.equal(apply.isError, true);
    const impact = await client.callTool({ name: TOOL_NAMES.analyseImpact, arguments: { files: ['pkg/util.py'] } });
    assert.ok(!impact.isError, 'context tools use the active request');
  } finally {
    end();
  }
  try {
    const after = await client.callTool({ name: TOOL_NAMES.readFile, arguments: { filePath: 'pkg/util.py' } });
    assert.equal(after.isError, true);
  } finally {
    await client.close();
  }
});

test('only one request can plan at a time', () => {
  const end = activeRun.begin({ requestId: 'a', request, context, proposals: new Map() });
  try {
    assert.throws(() => activeRun.begin({ requestId: 'b', request, context, proposals: new Map() }), /still planning/);
  } finally {
    end();
  }
  const again = activeRun.begin({ requestId: 'c', request, context, proposals: new Map() });
  again();
});

// ─────────────── Agent definition and planner ───────────────

test('agent definition: model, instructions, only the allowlist, no mid-turn approvals', () => {
  const spec = buildAgentSpec('openai/gpt-test', 'repopilot');
  assert.equal(spec.model.name, 'openai/gpt-test');
  assert.match(spec.instructions ?? '', /propose_edit/);
  assert.equal(spec.mcpServers?.length, 1);
  const mcp = spec.mcpServers![0];
  assert.equal(mcp.name, 'repopilot');
  assert.deepEqual([...(mcp.enableTools ?? [])].sort(), [...READ_ONLY_TOOLS].sort());
  assert.ok(!mcp.enableTools?.includes(TOOL_NAMES.applyApprovedHunks));
  assert.deepEqual(mcp.requireApprovalForTools, []);
});

test('settings: model must be provider/model; connector name is validated', () => {
  assert.equal(parseTrueForgeConfig({ model: 'openai/gpt-5.2' }).model, 'openai/gpt-5.2');
  assert.equal(parseTrueForgeConfig({}).connectorName, 'repopilot');
  assert.throws(() => parseTrueForgeConfig({ model: 'not a model' }), /provider\/model/);
  assert.throws(() => parseTrueForgeConfig({ connectorName: 'Bad Name!' }), /connectorName/);
});

/** A fake TrueForge server. Like the real one, it runs connector tools itself over HTTP. */
function fakeTrueForge(connectorUrl: () => string, calls: Array<{ id: string; name: string; args: unknown }>) {
  const created: unknown[] = [];
  const base = { createdAt: new Date().toISOString(), threadId: 'main' };
  const sdk: TrueForgeSdk = {
    server: { getCapabilities: async () => ({}) },
    sessions: {
      create: async (body) => {
        created.push(body);
        return { data: { id: 'sess-1' } };
      },
      cancel: async () => ({}),
      createTurnEvents: async () => ({}),
      createTurnStream: async () => {
        async function* gen(): AsyncGenerator<TurnEvent> {
          yield { ...base, id: 'e1', type: 'turn.created', turnId: 't1', previousTurnId: null, state: { status: 'running' } } as unknown as TurnEvent;
          yield {
            ...base,
            id: 'e2',
            type: 'model.message',
            content: 'Reading, then proposing.',
            toolCalls: calls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: JSON.stringify(c.args) },
              toolInfo: { type: 'mcp', name: c.name, serverId: 's1', serverName: 'repopilot' },
            })),
          } as unknown as TurnEvent;
          // TrueForge calls the connector over HTTP with the bearer token, then reports the result.
          const client = new Client({ name: 'trueforge', version: '1' });
          await client.connect(new StreamableHTTPClientTransport(new URL(connectorUrl()), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
          try {
            for (const c of calls) {
              const res = await client.callTool({ name: c.name, arguments: c.args as Record<string, unknown> });
              const text = (res.content as Array<{ text: string }>)[0]?.text ?? '';
              yield { ...base, id: `r-${c.id}`, type: 'tool.response', toolCallId: c.id, content: text } as unknown as TurnEvent;
            }
          } finally {
            await client.close();
          }
          yield { ...base, id: 'e9', type: 'turn.done', state: { status: 'done', output: null, requiredActions: [], completedAt: base.createdAt } } as unknown as TurnEvent;
        }
        return gen();
      },
    },
  };
  return { sdk, created };
}

test('planner: sends the agent definition, marks the run active only while planning, reports tool.response', async () => {
  const run = new ActiveRun();
  const { sdk, created } = fakeTrueForge(() => url, []);
  const planner = new TrueForgePlanner(new TrueForgeClient(parseTrueForgeConfig({ baseUrl: 'http://127.0.0.1:1' }), sdk), registry, {
    activeRun: run,
    agent: { model: 'openai/gpt-test', connectorName: 'repopilot' },
  });
  const events: RepoPilotEvent[] = [];
  await planner.plan({ request, context, signal: new AbortController().signal, emit: (e) => events.push(e) });
  const body = created[0] as { agent: { spec?: { model: { name: string } }; name?: string } };
  assert.equal(body.agent.spec?.model.name, 'openai/gpt-test');
  assert.equal(run.requestId, undefined, 'run ended');

  // Without a model: the saved agent by name.
  const { sdk: sdk2, created: created2 } = fakeTrueForge(() => url, []);
  await new TrueForgePlanner(new TrueForgeClient(parseTrueForgeConfig({ baseUrl: 'http://127.0.0.1:1' }), sdk2), registry).plan({
    request, context, signal: new AbortController().signal, emit: () => undefined,
  });
  assert.deepEqual((created2[0] as { agent: unknown }).agent, { name: 'repopilot-core' });
});

// ─────────────── End to end over HTTP ───────────────

test('end to end: TrueForge calls RepoPilot over HTTP → proposal → apply writes the accepted hunk', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'repopilot-e2e-http-'));
  fs.mkdirSync(path.join(ws, 'pkg'));
  fs.writeFileSync(path.join(ws, 'pkg/__init__.py'), '');
  fs.writeFileSync(path.join(ws, 'pkg/util.py'), 'def helper(x):\n    return x + 1\n');
  let connector = '';
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => (markReady = resolve));
  const { sdk } = fakeTrueForge(() => connector, [
    { id: 'c1', name: TOOL_NAMES.readFile, args: { filePath: 'pkg/util.py' } },
    { id: 'c2', name: TOOL_NAMES.proposeEdit, args: { path: 'pkg/util.py', proposedContent: 'def helper(x):\n    return x + 2\n' } },
    { id: 'c3', name: TOOL_NAMES.applyApprovedHunks, args: { decisions: [] } },
  ]);
  const agent = createRepoPilot({
    workspaceRoot: ws,
    trueforgeSdk: sdk,
    trueforge: { baseUrl: 'http://127.0.0.1:1', model: 'openai/gpt-test' },
    mcpConnector: {
      port: 0,
      token: TOKEN,
      onReady: (u) => {
        connector = u;
        markReady();
      },
    },
  });
  try {
    await ready;
    const events: RepoPilotEvent[] = [];
    agent.onEvent((e) => events.push(e));
    await agent.submit({ ...request, requestId: 'e2e-http' });

    const tools = events.flatMap((e) => (e.type === 'agent.tool' ? [`${e.tool}:${e.status}`] : []));
    assert.ok(tools.includes('read_file:succeeded'), tools.join(', '));
    assert.ok(tools.includes('propose_edit:succeeded'), tools.join(', '));
    assert.ok(tools.includes('apply_approved_hunks:failed'), 'the model cannot apply');

    const proposed = events.find((e) => e.type === 'change.proposed');
    assert.ok(proposed && proposed.type === 'change.proposed');
    assert.deepEqual(proposed.plan.files.map((f) => f.path), ['pkg/util.py']);
    assert.equal(fs.readFileSync(path.join(ws, 'pkg/util.py'), 'utf-8'), 'def helper(x):\n    return x + 1\n', 'nothing written yet');

    const res = await agent.applyDecisions(
      'e2e-http',
      proposed.plan.files.flatMap((f) => f.hunks.map((h) => ({ path: f.path, hunkId: h.hunkId, decision: 'accept' as const }))),
    );
    assert.equal(res.status, 'applied');
    assert.equal(fs.readFileSync(path.join(ws, 'pkg/util.py'), 'utf-8').replace(/\r\n/g, '\n'), 'def helper(x):\n    return x + 2\n');
  } finally {
    await agent.dispose();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
