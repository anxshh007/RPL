// End-to-end agent pipeline (owner: Member 1) with the REAL repository, ImpactLens,
// TestSheriff and edit service. Only the TrueForge server is replaced: a scripted fake SDK
// emits the same event types the official SDK declares (turn.created, model.message,
// tool.response_required, tool.approval_required, turn.done).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRepoPilot } from '../../../src/agent';
import type { TrueForgeSdk, TurnEvent } from '../../../src/agent';
import type { ChangeRequest, RepoPilotEvent } from '../../../src/shared/contracts';

const FIXTURE = path.resolve(__dirname, '../../../../tests/fixtures/sample-flask-repo');
const HELPER = 'src/flask/helper.py';
const NEW_HELPER = 'def format_response(data):\n    return f"Response: {data}"\n\n\ndef format_error(msg):\n    return f"Error: {msg}"\n';

const hasPytest = ['python', 'python3', 'py'].some(
  (exe) => spawnSync(exe, ['-m', 'pytest', '--version'], { encoding: 'utf-8' }).status === 0,
);

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'repopilot-e2e-'));
  fs.cpSync(FIXTURE, root, { recursive: true });
  fs.rmSync(path.join(root, 'tests/test_fail.py')); // the fixture's deliberately failing test
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

interface ToolCallScript {
  id: string;
  name: string;
  args: unknown;
}

/** A fake TrueForge SDK that asks for the given tool calls, then ends the turn. */
function scriptedSdk(calls: ToolCallScript[], opts: { approvalFor?: string; doneStatus?: 'done' | 'error'; hang?: boolean } = {}) {
  const responses: Array<{ toolCallId: string; content: string }> = [];
  const approvals: Array<{ toolCallId: string; allow: boolean }> = [];
  let release!: () => void;
  const allAnswered = new Promise<void>((r) => (release = r));
  const expected = calls.length + (opts.approvalFor ? 1 : 0);
  if (expected === 0) release();
  const base = { createdAt: new Date().toISOString(), threadId: 'main' };

  const sdk: TrueForgeSdk = {
    server: { getCapabilities: async () => ({}) },
    sessions: {
      create: async () => ({ data: { id: 'sess-1' } }),
      cancel: async () => ({}),
      createTurnEvents: async (_s, _t, body) => {
        for (const e of body.events as unknown as Array<Record<string, unknown>>) {
          if (e.type === 'user.tool_response') responses.push({ toolCallId: String(e.toolCallId), content: String(e.content) });
          if (e.type === 'user.tool_approval') {
            approvals.push({ toolCallId: String(e.toolCallId), allow: (e.approval as { status: string }).status === 'allow' });
          }
        }
        if (responses.length + approvals.length >= expected) release();
        return {};
      },
      createTurnStream: async (_s, _b, options) => {
        async function* gen(): AsyncGenerator<TurnEvent> {
          yield { ...base, id: 'e1', type: 'turn.created', turnId: 'turn-1', previousTurnId: null, state: { status: 'running' } } as unknown as TurnEvent;
          yield { ...base, id: 'e2', type: 'model.message.delta', content: 'Looking at the helper…' } as unknown as TurnEvent;
          if (opts.hang) {
            await new Promise<void>((resolve) => options?.abortSignal?.addEventListener('abort', () => resolve(), { once: true }));
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
          }
          const all = [...calls, ...(opts.approvalFor ? [{ id: 'appr-1', name: opts.approvalFor, args: {} }] : [])];
          yield {
            ...base,
            id: 'e3',
            type: 'model.message',
            content: 'Adding format_error next to format_response.',
            toolCalls: all.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })),
          } as unknown as TurnEvent;
          if (calls.length > 0) {
            yield { ...base, id: 'e4', type: 'tool.response_required', toolCalls: calls.map((c) => ({ id: c.id, sourceEventId: 'e3' })) } as unknown as TurnEvent;
          }
          if (opts.approvalFor) {
            yield { ...base, id: 'e5', type: 'tool.approval_required', toolCalls: [{ id: 'appr-1', sourceEventId: 'e3' }] } as unknown as TurnEvent;
          }
          await allAnswered;
          const state = opts.doneStatus === 'error'
            ? { status: 'error', message: 'boom', completedAt: base.createdAt }
            : { status: 'done', output: null, requiredActions: [], completedAt: base.createdAt };
          yield { ...base, id: 'e6', type: 'turn.done', state } as unknown as TurnEvent;
        }
        return gen();
      },
    },
  };
  return { sdk, responses, approvals };
}

const request = (id: string): ChangeRequest => ({
  requestId: id,
  instruction: 'Add a format_error helper next to format_response',
  mode: 'agent',
  activeFile: HELPER,
  explicitFileMentions: [],
  explicitSymbolMentions: [],
});

const states = (events: RepoPilotEvent[]) => events.flatMap((e) => (e.type === 'agent.status' ? [e.state] : []));

test('full run: context → impact → TrueForge tools → proposal → apply → tests → undo', { skip: !hasPytest && 'pytest not installed' }, async () => {
  const { sdk, responses } = scriptedSdk([
    { id: 'c1', name: 'read_file', args: { filePath: HELPER } },
    { id: 'c2', name: 'propose_edit', args: { path: HELPER, proposedContent: NEW_HELPER } },
    { id: 'c3', name: 'apply_approved_hunks', args: { decisions: [] } }, // must be refused
  ]);
  const agent = createRepoPilot({ workspaceRoot: root, trueforgeSdk: sdk });
  const events: RepoPilotEvent[] = [];
  agent.onEvent((e) => events.push(e));
  const original = fs.readFileSync(path.join(root, HELPER), 'utf-8');

  await agent.submit(request('e2e-1'));

  const types = events.map((e) => e.type);
  assert.ok(types.indexOf('context.ready') < types.indexOf('impact.ready'), 'context before impact');
  assert.ok(types.indexOf('impact.ready') < types.indexOf('change.proposed'), 'impact before proposal');
  assert.ok(types.includes('agent.delta'));
  assert.deepEqual(states(events).slice(0, 4), ['starting', 'retrieving_context', 'analysing_impact', 'planning']);
  assert.equal(states(events).at(-1), 'review_required');
  assert.equal(types.filter((t) => t === 'impact.ready').length, 2, 'ImpactLens runs before planning and on the proposal (D-14)');

  // Tool calls went through the registry: read_file answered, apply refused for the model.
  assert.match(responses.find((r) => r.toolCallId === 'c1')!.content, /format_response/);
  assert.match(responses.find((r) => r.toolCallId === 'c3')!.content, /approval/);
  assert.ok(events.some((e) => e.type === 'agent.tool' && e.tool === 'apply_approved_hunks' && e.status === 'failed'));

  // Proposal: diff only, nothing written.
  const proposed = events.find((e) => e.type === 'change.proposed');
  assert.ok(proposed && proposed.type === 'change.proposed');
  const plan = proposed.plan;
  assert.deepEqual(plan.files.map((f) => f.path), [HELPER]);
  assert.ok(plan.impactReport, 'plan carries the impact report');
  assert.ok(plan.impactReport.testCandidates.some((t) => t.path === 'tests/test_helper.py'));
  assert.equal(fs.readFileSync(path.join(root, HELPER), 'utf-8'), original);

  // Apply accepted hunks; tests wait for approval (D-12 default).
  const decisions = plan.files.flatMap((f) => f.hunks.map((h) => ({ path: f.path, hunkId: h.hunkId, decision: 'accept' as const })));
  const applied = await agent.applyDecisions('e2e-1', decisions);
  assert.equal(applied.status, 'applied');
  assert.equal(fs.readFileSync(path.join(root, HELPER), 'utf-8'), NEW_HELPER);
  assert.ok(!events.some((e) => e.type === 'verification.started'), 'no test run before approval');

  // User approves the test run: real pytest through TestSheriff.
  const report = await agent.runVerification('e2e-1');
  assert.ok(report);
  assert.equal(report.status, 'passed');
  assert.equal(report.counts.failed, 0);
  assert.ok((report.counts.passed ?? 0) >= 1);
  assert.ok(report.selectedTests.some((t) => t.path === 'tests/test_helper.py'));
  assert.ok(events.some((e) => e.type === 'verification.completed'));

  // Undo restores the original.
  const undone = await agent.undo('e2e-1');
  assert.equal(undone.status, 'undone');
  assert.equal(fs.readFileSync(path.join(root, HELPER), 'utf-8'), original);
});

test('requireTestApproval=false runs tests right after apply', { skip: !hasPytest && 'pytest not installed' }, async () => {
  const { sdk } = scriptedSdk([{ id: 'c1', name: 'propose_edit', args: { path: HELPER, proposedContent: NEW_HELPER } }]);
  const agent = createRepoPilot({ workspaceRoot: root, trueforgeSdk: sdk, requireTestApproval: false });
  const events: RepoPilotEvent[] = [];
  agent.onEvent((e) => events.push(e));
  await agent.submit(request('e2e-2'));
  const plan = events.find((e) => e.type === 'change.proposed');
  assert.ok(plan && plan.type === 'change.proposed');
  await agent.applyDecisions('e2e-2', plan.plan.files.flatMap((f) => f.hunks.map((h) => ({ path: f.path, hunkId: h.hunkId, decision: 'accept' as const }))));
  const done = events.find((e) => e.type === 'verification.completed');
  assert.ok(done && done.type === 'verification.completed' && done.report.status === 'passed');
});

test('tool approvals requested by TrueForge are denied with a warning', async () => {
  const { sdk, approvals } = scriptedSdk([], { approvalFor: 'some_server_tool' });
  const agent = createRepoPilot({ workspaceRoot: root, trueforgeSdk: sdk });
  const events: RepoPilotEvent[] = [];
  agent.onEvent((e) => events.push(e));
  await agent.submit(request('e2e-3'));
  assert.deepEqual(approvals, [{ toolCallId: 'appr-1', allow: false }]);
  assert.ok(events.some((e) => e.type === 'agent.warning' && /Denied/.test(e.message)));
  assert.equal(states(events).at(-1), 'completed', 'nothing proposed → completed');
});

test('cancel during planning ends "cancelled" with no proposal and no file change', async () => {
  const { sdk } = scriptedSdk([], { hang: true });
  const agent = createRepoPilot({ workspaceRoot: root, trueforgeSdk: sdk });
  const events: RepoPilotEvent[] = [];
  agent.onEvent((e) => {
    events.push(e);
    if (e.type === 'agent.delta') agent.cancel('e2e-4');
  });
  const original = fs.readFileSync(path.join(root, HELPER), 'utf-8');
  await agent.submit(request('e2e-4'));
  assert.equal(states(events).at(-1), 'cancelled');
  assert.ok(!events.some((e) => e.type === 'change.proposed' || e.type === 'agent.error'));
  assert.equal(fs.readFileSync(path.join(root, HELPER), 'utf-8'), original);
});

test('a TrueForge turn error becomes a safe agent.error', async () => {
  const { sdk } = scriptedSdk([], { doneStatus: 'error' });
  const agent = createRepoPilot({ workspaceRoot: root, trueforgeSdk: sdk });
  const events: RepoPilotEvent[] = [];
  agent.onEvent((e) => events.push(e));
  await agent.submit(request('e2e-5'));
  const err = events.find((e) => e.type === 'agent.error');
  assert.ok(err && err.type === 'agent.error');
  assert.equal(err.error.kind, 'tool_error');
  assert.equal(states(events).at(-1), 'error');
});

test('without a TrueForge baseUrl the run says so and proposes nothing', async () => {
  const agent = createRepoPilot({ workspaceRoot: root });
  const events: RepoPilotEvent[] = [];
  agent.onEvent((e) => events.push(e));
  await agent.submit(request('e2e-6'));
  assert.ok(events.some((e) => e.type === 'agent.warning' && /not configured/.test(e.message)));
  assert.equal(states(events).at(-1), 'completed');
});

test('createRepoPilot requires a workspace root', () => {
  assert.throws(() => createRepoPilot({ workspaceRoot: '' }), /workspaceRoot/);
  assert.throws(() => createRepoPilot(undefined as never), /workspaceRoot/);
});
