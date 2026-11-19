// Panel state (owner: Member 5): the real reducer behind useExtensionBridge, the status badge,
// and the plan store behind "Open diff". Plain Node: no React, no DOM, no vscode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChangePlan, HostToWebview, RepoPilotEvent } from '../../../src/shared/contracts';
import { bridgeReducer, initialBridgeState, isPlanApplied } from '../../../src/webview/state/bridgeState';
import type { BridgeState } from '../../../src/webview/state/bridgeState';
import { getStatusBadge, isAgentRunning } from '../../../src/webview/state/agentStatus';
import { MAX_REMEMBERED_PLANS, ProposedPlans } from '../../../src/extension/proposed-plans';

const ev = (event: RepoPilotEvent): HostToWebview => ({ type: 'host.event', event });
const run = (msgs: HostToWebview[], from: BridgeState = initialBridgeState) => msgs.reduce(bridgeReducer, from);

const plan = (requestId: string, path = 'src/app.py'): ChangePlan => ({
  requestId,
  summary: 's',
  rationale: [],
  files: [
    {
      path,
      changeType: 'modify',
      originalContentHash: 'h',
      proposedContent: 'x = 2\n',
      unifiedDiff: '',
      hunks: [{ hunkId: 'hunk-1', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, diffText: '-x = 1\n+x = 2' }],
    },
  ],
});

/** One full request: start → warning → delta → proposal → applied → undone → completed. */
const firstRequest: HostToWebview[] = [
  ev({ type: 'agent.status', requestId: 'r1', state: 'starting', message: 'Request received.' }),
  ev({ type: 'agent.warning', requestId: 'r1', message: 'first warning' }),
  ev({ type: 'agent.warning', requestId: 'r1', message: 'second warning' }),
  ev({ type: 'agent.delta', requestId: 'r1', text: 'thinking…' }),
  ev({ type: 'change.proposed', requestId: 'r1', plan: plan('r1') }),
  ev({ type: 'agent.status', requestId: 'r1', state: 'review_required', message: 'Review.' }),
  ev({ type: 'change.applied', requestId: 'r1', result: { requestId: 'r1', status: 'applied', appliedPaths: ['src/app.py'], appliedHunkIds: ['hunk-1'], stalePaths: [] } }),
  ev({ type: 'change.undone', requestId: 'r1', result: { requestId: 'r1', status: 'undone', restoredPaths: ['src/app.py'] } }),
  ev({ type: 'agent.status', requestId: 'r1', state: 'completed', message: 'Done.' }),
];

test('warnings are kept as a list, in order', () => {
  const s = run(firstRequest);
  assert.deepEqual(s.warnings, ['first warning', 'second warning']);
});

test('a new request clears everything from the previous one', () => {
  const s = run([...firstRequest, ev({ type: 'agent.status', requestId: 'r2', state: 'starting', message: 'Request received.' })]);
  assert.equal(s.activeRequestId, 'r2');
  assert.equal(s.runningRequestId, 'r2');
  assert.deepEqual(s.warnings, []);
  assert.equal(s.streamingDelta, '');
  assert.equal(s.lastApplyResult, null);
  assert.equal(s.lastUndoResult, null);
  assert.equal(s.errorMessage, null);
  assert.equal(s.events.length, 1, 'only the new request\'s events are shown');
  assert.ok(!s.events.some((e) => e.type === 'change.proposed'), 'the old plan and impact report are gone');
});

test('after an undo, a later request that applies shows as applied (R2 bug)', () => {
  const s = run([
    ...firstRequest,
    ev({ type: 'agent.status', requestId: 'r2', state: 'starting', message: '…' }),
    ev({ type: 'change.proposed', requestId: 'r2', plan: plan('r2') }),
    ev({ type: 'change.applied', requestId: 'r2', result: { requestId: 'r2', status: 'applied', appliedPaths: ['src/app.py'], appliedHunkIds: ['hunk-1'], stalePaths: [] } }),
  ]);
  assert.equal(isPlanApplied(s), true);
});

test('within one request: apply → undo shows not applied', () => {
  assert.equal(isPlanApplied(run(firstRequest)), false);
});

test('late events from an earlier request are ignored', () => {
  const s = run([
    ...firstRequest,
    ev({ type: 'agent.status', requestId: 'r2', state: 'starting', message: '…' }),
    ev({ type: 'agent.warning', requestId: 'r1', message: 'late warning from r1' }),
    ev({ type: 'agent.delta', requestId: 'r1', text: 'late text' }),
    ev({ type: 'agent.status', requestId: 'r1', state: 'completed', message: 'late' }),
  ]);
  assert.deepEqual(s.warnings, []);
  assert.equal(s.streamingDelta, '');
  assert.equal(s.agentState, 'starting');
});

test('apply and undo stay available after the run finishes (activeRequestId kept, nothing running)', () => {
  const s = run(firstRequest);
  assert.equal(s.activeRequestId, 'r1');
  assert.equal(s.runningRequestId, null);
});

test('agent.error ends the run and shows only the safe message', () => {
  const s = run([
    ev({ type: 'agent.status', requestId: 'r3', state: 'starting', message: '…' }),
    ev({ type: 'agent.error', requestId: 'r3', error: { kind: 'network', message: 'TrueForge server is unreachable.', retryable: true } }),
  ]);
  assert.equal(s.agentState, 'error');
  assert.equal(s.errorMessage, 'TrueForge server is unreachable.');
  assert.equal(s.runningRequestId, null);
});

test('submitting clears old banners at once; host.workspace and host.error are kept separately', () => {
  let s = run(firstRequest);
  s = bridgeReducer(s, { type: 'host.error', message: 'Open a folder first.' });
  s = bridgeReducer(s, { type: 'local.submit' });
  assert.equal(s.errorMessage, null);
  assert.deepEqual(s.warnings, []);
  s = bridgeReducer(s, { type: 'host.workspace', available: true, name: 'flask' });
  assert.deepEqual(s.workspace, { available: true, name: 'flask' });
});

test('verification.started / completed track the running tests', () => {
  let s = run([ev({ type: 'agent.status', requestId: 'r4', state: 'starting', message: '…' })]);
  s = bridgeReducer(s, ev({ type: 'verification.started', requestId: 'r4', tests: ['tests/test_app.py'] }));
  assert.deepEqual(s.verificationTests, ['tests/test_app.py']);
  s = bridgeReducer(
    s,
    ev({
      type: 'verification.completed',
      requestId: 'r4',
      report: {
        requestId: 'r4', status: 'not_run', runner: 'none', commandLabel: '', selectedTests: [],
        counts: { total: null, passed: null, failed: null, skipped: null, errors: null },
        parsingComplete: false, exitCode: null, durationMs: null, failures: [], stdoutTail: '', stderrTail: '',
        outputTruncated: false, limitations: ['pytest not found'],
      },
    }),
  );
  assert.equal(s.verificationTests, null);
});

test('status badge covers every contract state; "executing" is not special', () => {
  const contractStates = ['idle', 'starting', 'retrieving_context', 'analysing_impact', 'planning', 'review_required', 'applying', 'verifying', 'completed', 'cancelled', 'error'];
  for (const st of contractStates) {
    const c = getStatusBadge(st);
    assert.ok(c.bg && c.text && c.border, st);
  }
  assert.deepEqual(getStatusBadge('executing'), getStatusBadge('idle'));
  assert.notDeepEqual(getStatusBadge('review_required'), getStatusBadge('planning'), 'review needs a different colour');
});

test('only working states count as running; review_required waits for the user', () => {
  for (const st of ['starting', 'retrieving_context', 'analysing_impact', 'planning', 'applying', 'verifying']) {
    assert.equal(isAgentRunning(st), true, st);
  }
  for (const st of ['idle', 'review_required', 'completed', 'cancelled', 'error']) {
    assert.equal(isAgentRunning(st), false, st);
  }
});

test('Open diff: only files in the agent\'s own plan can be opened', () => {
  const plans = new ProposedPlans();
  plans.record({ type: 'change.proposed', requestId: 'r1', plan: plan('r1', 'src/app.py') });
  assert.equal(plans.get('r1', 'src/app.py')?.proposedContent, 'x = 2\n');
  assert.equal(plans.get('r1', '../secret.txt'), undefined);
  assert.equal(plans.get('r1', 'src/other.py'), undefined);
  assert.equal(plans.get('nope', 'src/app.py'), undefined);
});

test('Open diff: only the most recent plans are remembered', () => {
  const plans = new ProposedPlans();
  for (let i = 0; i <= MAX_REMEMBERED_PLANS; i++) {
    plans.record({ type: 'change.proposed', requestId: `r${i}`, plan: plan(`r${i}`) });
  }
  assert.equal(plans.get('r0', 'src/app.py'), undefined, 'oldest dropped');
  assert.ok(plans.get(`r${MAX_REMEMBERED_PLANS}`, 'src/app.py'));
  plans.record({ type: 'agent.warning', requestId: 'r1', message: 'ignored' });
});
