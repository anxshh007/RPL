// MCP layer (owner: Member 1): every module's handler is registered once, the model sees only
// READ_ONLY_TOOLS, user-only tools are refused for the model, and the MCP server lists/calls tools.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createRepositoryIntelligence } from '../../../src/repository';
import { createImpactAnalyser } from '../../../src/impact';
import { createVerificationService } from '../../../src/verification';
import { createEditService } from '../../../src/edits';
import { createRepoPilotTools, RepoPilotMcpServer, READ_ONLY_TOOLS, TOOL_NAMES } from '../../../src/mcp';
import type { ToolCallContext, ToolRegistry } from '../../../src/mcp';
import type { ChangeRequest, FileProposal } from '../../../src/shared/contracts';

let root: string;
let registry: ToolRegistry;
let repoContext: Awaited<ReturnType<ReturnType<typeof createRepositoryIntelligence>['getContext']>>;
const request: ChangeRequest = {
  requestId: 'req-mcp',
  instruction: 'add a helper',
  mode: 'agent',
  activeFile: 'pkg/util.py',
  explicitFileMentions: [],
  explicitSymbolMentions: [],
};

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'repopilot-mcp-'));
  fs.mkdirSync(path.join(root, 'pkg'));
  fs.writeFileSync(path.join(root, 'pkg/__init__.py'), '');
  fs.writeFileSync(path.join(root, 'pkg/util.py'), 'def helper(x):\n    return x + 1\n');
  fs.writeFileSync(path.join(root, 'pkg/app.py'), 'from pkg.util import helper\n\nprint(helper(1))\n');
  const repository = createRepositoryIntelligence();
  await repository.initialize(root);
  repoContext = await repository.getContext(request);
  registry = createRepoPilotTools({
    workspaceRoot: root,
    repository,
    impact: createImpactAnalyser(),
    verification: createVerificationService(root),
    edits: createEditService(root),
  });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

const modelCtx = (extra: Partial<ToolCallContext> = {}): ToolCallContext => ({ origin: 'model', requestId: 'req-mcp', ...extra });

test('all 12 tools are registered and the model sees exactly READ_ONLY_TOOLS', () => {
  assert.deepEqual([...registry.names()].sort(), Object.values(TOOL_NAMES).sort());
  assert.deepEqual(registry.listForModel().map((t) => t.name).sort(), [...READ_ONLY_TOOLS].sort());
  for (const t of registry.listForModel()) {
    assert.equal(typeof t.description, 'string');
    assert.equal(typeof t.inputSchema, 'object');
  }
});

test('the model cannot call apply, undo or run_tests', async () => {
  for (const name of [TOOL_NAMES.applyApprovedHunks, TOOL_NAMES.undoChanges, TOOL_NAMES.runTests]) {
    const out = await registry.execute(name, {}, modelCtx());
    assert.equal(out.ok, false, name);
    assert.ok(!out.ok && /approval/.test(out.error.message));
  }
});

test('unknown tools and bad input return a SafeError instead of throwing', async () => {
  const unknown = await registry.execute('run_shell', { cmd: 'rm -rf /' }, modelCtx());
  assert.ok(!unknown.ok && unknown.error.kind === 'validation');
  const bad = await registry.execute(TOOL_NAMES.proposeEdit, { path: 42 }, modelCtx({ proposals: new Map() }));
  assert.ok(!bad.ok && bad.error.kind === 'validation');
});

test('read-only repository tools run through Member 2 handlers', async () => {
  const read = await registry.execute(TOOL_NAMES.readFile, { filePath: 'pkg/util.py' }, modelCtx());
  assert.ok(read.ok);
  assert.match(JSON.stringify(read.value), /def helper/);
  const escape = await registry.execute(TOOL_NAMES.readFile, { filePath: '../secret.txt' }, modelCtx());
  assert.equal(escape.ok, false);
  const sym = await registry.execute(TOOL_NAMES.findSymbol, { name: 'helper' }, modelCtx());
  assert.ok(sym.ok && JSON.stringify(sym.value).includes('pkg/util.py'));
});

test('impact and context tools use the run request; without one they refuse', async () => {
  const none = await registry.execute(TOOL_NAMES.analyseImpact, {}, modelCtx());
  assert.equal(none.ok, false);
  const out = await registry.execute(TOOL_NAMES.analyseImpact, { files: ['pkg/util.py'] }, modelCtx({ request, context: repoContext }));
  assert.ok(out.ok);
  assert.match(JSON.stringify(out.value), /pkg\/app\.py/, 'ImpactLens finds the importer');
  const ctx = await registry.execute(TOOL_NAMES.getRepositoryContext, {}, modelCtx({ request }));
  assert.ok(ctx.ok);
});

test('propose_edit collects a proposal and writes nothing; unsafe paths are refused', async () => {
  const proposals = new Map<string, FileProposal>();
  const out = await registry.execute(
    TOOL_NAMES.proposeEdit,
    { path: 'pkg/util.py', proposedContent: 'def helper(x):\n    return x + 2\n' },
    modelCtx({ proposals }),
  );
  assert.ok(out.ok);
  assert.equal(proposals.get('pkg/util.py')?.proposedContent, 'def helper(x):\n    return x + 2\n');
  assert.equal(fs.readFileSync(path.join(root, 'pkg/util.py'), 'utf-8'), 'def helper(x):\n    return x + 1\n');

  const bad = await registry.execute(TOOL_NAMES.proposeEdit, { path: '../../evil.py', proposedContent: 'x' }, modelCtx({ proposals }));
  assert.ok(!bad.ok && bad.error.kind === 'validation');
  assert.equal(proposals.size, 1);
});

test('the MCP server lists the allowlist and calls tools over the protocol', async () => {
  const server = new RepoPilotMcpServer(registry);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientT);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((t) => t.name).sort(), [...READ_ONLY_TOOLS].sort());
    const ok = await client.callTool({ name: TOOL_NAMES.readFile, arguments: { filePath: 'pkg/app.py' } });
    assert.ok(!ok.isError);
    assert.match(JSON.stringify(ok.content), /from pkg\.util import helper/);
    const refused = await client.callTool({ name: TOOL_NAMES.applyApprovedHunks, arguments: { decisions: [] } });
    assert.equal(refused.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});
