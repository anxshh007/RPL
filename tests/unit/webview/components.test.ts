import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  RepoPilotEvent,
  ChangePlan,
  HunkDecision,
  ImpactReport,
  VerificationReport,
  ApplyResult,
  UndoResult,
} from '../../../src/shared/contracts';
import {
  makeDecisionKey,
  parseDecisionKey,
  DECISION_KEY_SEPARATOR,
} from '../../../src/webview/components/DiffReview';
import {
  getRiskColors,
  getConfidenceBadge,
  buildImpactFlowGraph,
} from '../../../src/webview/components/ImpactPanel';

// ──────────────── Sample Report (Self-contained UTF-8 test fixture) ────────────────

const sampleReport: ImpactReport = {
  requestId: 'fixture-mini-flask',
  generatedAt: '2026-01-01T00:00:00.000Z',
  changedTargets: ['src/flask/helpers.py'],
  affectedFiles: [
    {
      path: 'src/flask/app.py',
      risk: 'high',
      reasons: [
        'imports src/flask/helpers.py, which is being changed',
        'is an entry point or configuration file (name matches "app.py")',
      ],
      relationshipPath: ['src/flask/helpers.py', 'src/flask/app.py'],
      confidence: 'high',
      relatedSymbols: [],
      matchedRule: 'direct-dependency',
    },
    {
      path: 'tests/test_helpers.py',
      risk: 'high',
      reasons: [
        'imports src/flask/helpers.py, which is being changed',
        'is a test file linked to the change',
      ],
      relationshipPath: ['src/flask/helpers.py', 'tests/test_helpers.py'],
      confidence: 'high',
      relatedSymbols: [],
      matchedRule: 'direct-dependency',
    },
    {
      path: 'src/flask/cli.py',
      risk: 'medium',
      reasons: ['imports src/flask/helpers.py, which is being changed'],
      relationshipPath: ['src/flask/helpers.py', 'src/flask/cli.py'],
      confidence: 'high',
      relatedSymbols: [],
      matchedRule: 'direct-dependency',
    },
    {
      path: 'docs/cli.rst',
      risk: 'low',
      reasons: ['references src/flask/cli.py, which is in the affected set'],
      relationshipPath: ['src/flask/helpers.py', 'src/flask/cli.py', 'docs/cli.rst'],
      confidence: 'medium',
      relatedSymbols: [],
      matchedRule: 'transitive-dependency',
    },
    {
      path: 'tests/test_cli.py',
      risk: 'high',
      reasons: [
        'imports src/flask/cli.py, which is in the affected set',
        'is a test file linked to the change',
      ],
      relationshipPath: ['src/flask/helpers.py', 'src/flask/cli.py', 'tests/test_cli.py'],
      confidence: 'high',
      relatedSymbols: [],
      matchedRule: 'transitive-dependency',
    },
  ],
  testCandidates: [
    {
      path: 'tests/test_helpers.py',
      reason: 'direct test for changed file src/flask/helpers.py',
      source: 'impact',
      confidence: 'high',
    },
    {
      path: 'tests/test_cli.py',
      reason: 'test for affected file src/flask/cli.py',
      source: 'impact',
      confidence: 'high',
    },
  ],
  nodes: [
    { id: 'src/flask/helpers.py', label: 'src/flask/helpers.py', kind: 'file', highlight: 'changed' },
    { id: 'src/flask/app.py', label: 'src/flask/app.py', kind: 'file', highlight: 'affected', risk: 'high' },
    { id: 'tests/test_helpers.py', label: 'tests/test_helpers.py', kind: 'test', highlight: 'affected', risk: 'high' },
    { id: 'src/flask/cli.py', label: 'src/flask/cli.py', kind: 'file', highlight: 'affected', risk: 'medium' },
    { id: 'docs/cli.rst', label: 'docs/cli.rst', kind: 'file', highlight: 'affected', risk: 'low' },
    { id: 'tests/test_cli.py', label: 'tests/test_cli.py', kind: 'test', highlight: 'affected', risk: 'high' },
  ],
  edges: [
    { id: 'src/flask/app.py→src/flask/helpers.py:imports', source: 'src/flask/app.py', target: 'src/flask/helpers.py', kind: 'imports', evidence: 'observed' },
    { id: 'tests/test_helpers.py→src/flask/helpers.py:imports', source: 'tests/test_helpers.py', target: 'src/flask/helpers.py', kind: 'imports', evidence: 'observed' },
    { id: 'src/flask/cli.py→src/flask/helpers.py:imports', source: 'src/flask/cli.py', target: 'src/flask/helpers.py', kind: 'imports', evidence: 'observed' },
    { id: 'docs/cli.rst→src/flask/cli.py:references', source: 'docs/cli.rst', target: 'src/flask/cli.py', kind: 'references', evidence: 'inferred' },
    { id: 'tests/test_cli.py→src/flask/cli.py:imports', source: 'tests/test_cli.py', target: 'src/flask/cli.py', kind: 'imports', evidence: 'observed' },
  ],
  summary: {
    analysedFiles: 6,
    affectedCount: 5,
    high: 3,
    medium: 1,
    low: 1,
    incomplete: false,
  },
  warnings: ['Inferred reference from docs/cli.rst is heuristic'],
  limitations: [
    'Dynamic imports via importlib are not traced',
    'Analysis depth bounded to maxDepth=3',
  ],
};

// ──────────────── 1. Decision Keys & Hunk Decisions ────────────────

test('makeDecisionKey and parseDecisionKey use safe non-colon separator', () => {
  const path = 'C:\\workspace\\src\\flask\\helpers.py';
  const hunkId = 'hunk-1';
  const key = makeDecisionKey(path, hunkId);

  assert.ok(key.includes(DECISION_KEY_SEPARATOR));
  assert.equal(key, `${path}\u0000${hunkId}`);

  const parsed = parseDecisionKey(key);
  assert.equal(parsed.path, path);
  assert.equal(parsed.hunkId, hunkId);
});

test('hunk decisions correctly map accepted and rejected states without path corruption', () => {
  const decisions = new Map<string, 'accept' | 'reject'>();
  decisions.set(makeDecisionKey('src/flask/helpers.py', 'hunk-1'), 'accept');
  decisions.set(makeDecisionKey('src/flask/helpers.py', 'hunk-2'), 'reject');
  decisions.set(makeDecisionKey('tests/test_cli.py', 'hunk-1'), 'accept');

  const hunkDecisions: HunkDecision[] = Array.from(decisions.entries()).map(([key, decision]) => {
    const { path, hunkId } = parseDecisionKey(key);
    return { path, hunkId, decision };
  });

  assert.equal(hunkDecisions.length, 3);
  assert.deepEqual(hunkDecisions[0], { path: 'src/flask/helpers.py', hunkId: 'hunk-1', decision: 'accept' });
  assert.deepEqual(hunkDecisions[1], { path: 'src/flask/helpers.py', hunkId: 'hunk-2', decision: 'reject' });
  assert.deepEqual(hunkDecisions[2], { path: 'tests/test_cli.py', hunkId: 'hunk-1', decision: 'accept' });

  const hasAccepted = Array.from(decisions.values()).some((d) => d === 'accept');
  assert.equal(hasAccepted, true);
});

// ──────────────── 2. Webview Event Stream State Derivation ────────────────

interface AppStateFromEvents {
  agentState: string;
  changePlan?: ChangePlan;
  impactReport?: ImpactReport;
  verificationReport?: VerificationReport;
  errorMessage?: string;
  warningMessage?: string;
  streamingDelta: string;
  applyResult?: ApplyResult;
  undoResult?: UndoResult;
  verificationTests?: string[];
}

function deriveStateFromEvents(events: RepoPilotEvent[]): AppStateFromEvents {
  let agentState = 'idle';
  let changePlan: ChangePlan | undefined;
  let impactReport: ImpactReport | undefined;
  let verificationReport: VerificationReport | undefined;
  let errorMessage: string | undefined;
  let warningMessage: string | undefined;
  let streamingDelta = '';
  let applyResult: ApplyResult | undefined;
  let undoResult: UndoResult | undefined;
  let verificationTests: string[] | undefined;

  for (const e of events) {
    if (e.type === 'agent.status') {
      agentState = e.state;
    } else if (e.type === 'change.proposed') {
      changePlan = e.plan;
    } else if (e.type === 'impact.ready') {
      impactReport = e.report;
    } else if (e.type === 'verification.started') {
      verificationTests = e.tests;
    } else if (e.type === 'verification.completed') {
      verificationReport = e.report;
      verificationTests = undefined;
    } else if (e.type === 'agent.error') {
      agentState = 'error';
      errorMessage = e.error.message;
    } else if (e.type === 'agent.warning') {
      warningMessage = e.message;
    } else if (e.type === 'agent.delta') {
      streamingDelta += e.text;
    } else if (e.type === 'change.applied') {
      applyResult = e.result;
    } else if (e.type === 'change.undone') {
      undoResult = e.result;
    }
  }

  return {
    agentState,
    changePlan,
    impactReport,
    verificationReport,
    errorMessage,
    warningMessage,
    streamingDelta,
    applyResult,
    undoResult,
    verificationTests,
  };
}

test('event stream correctly derives agent state, impact, diff and verification', () => {
  const events: RepoPilotEvent[] = [
    { type: 'agent.status', requestId: 'req-1', state: 'retrieving_context', message: 'Scanning files' },
    { type: 'agent.status', requestId: 'req-1', state: 'analysing_impact', message: 'Analysing impact' },
    { type: 'impact.ready', requestId: 'req-1', report: sampleReport },
    { type: 'agent.status', requestId: 'req-1', state: 'planning', message: 'Proposing changes' },
    {
      type: 'change.proposed',
      requestId: 'req-1',
      plan: {
        requestId: 'req-1',
        summary: 'Update debug flag',
        files: [
          {
            path: 'src/flask/helpers.py',
            changeType: 'modify',
            originalContentHash: 'hash1',
            proposedContent: 'def get_debug_flag(): return False\n',
            unifiedDiff: '@@ -28,3 +28,3 @@\n-old\n+new\n',
            hunks: [{ hunkId: 'hunk-1', oldStart: 28, oldLines: 3, newStart: 28, newLines: 3, diffText: '-old\n+new\n' }],
          },
        ],
        rationale: ['User requested off and n support'],
      },
    },
    { type: 'verification.started', requestId: 'req-1', tests: ['tests/test_cli.py'] },
    { type: 'agent.status', requestId: 'req-1', state: 'verifying', message: 'Running tests' },
    {
      type: 'verification.completed',
      requestId: 'req-1',
      report: {
        requestId: 'req-1',
        status: 'passed',
        runner: 'pytest',
        commandLabel: 'pytest -q tests/test_cli.py',
        selectedTests: [{ path: 'tests/test_cli.py', reason: 'changed' }],
        counts: { total: 11, passed: 11, failed: 0, skipped: 0, errors: 0 },
        parsingComplete: true,
        exitCode: 0,
        durationMs: 380,
        failures: [],
        stdoutTail: '11 passed',
        stderrTail: '',
        outputTruncated: false,
        limitations: [],
      },
    },
    { type: 'agent.status', requestId: 'req-1', state: 'completed', message: 'Done' },
  ];

  const state = deriveStateFromEvents(events);

  assert.equal(state.agentState, 'completed');
  assert.ok(state.impactReport);
  assert.equal(state.impactReport.requestId, 'fixture-mini-flask');
  assert.ok(state.changePlan);
  assert.equal(state.changePlan.files.length, 1);
  assert.ok(state.verificationReport);
  assert.equal(state.verificationReport.counts.passed, 11);
  assert.equal(state.verificationTests, undefined);
  assert.equal(state.errorMessage, undefined);
});

test('event stream correctly captures error and warning states', () => {
  const events: RepoPilotEvent[] = [
    { type: 'agent.status', requestId: 'req-2', state: 'retrieving_context', message: 'Scanning' },
    { type: 'agent.warning', requestId: 'req-2', message: 'Repository indexing reached file limit' },
    { type: 'agent.error', requestId: 'req-2', error: { kind: 'auth_config', message: 'Failed to access file outside workspace', retryable: false } },
  ];

  const state = deriveStateFromEvents(events);
  assert.equal(state.agentState, 'error');
  assert.equal(state.errorMessage, 'Failed to access file outside workspace');
  assert.equal(state.warningMessage, 'Repository indexing reached file limit');
});

test('event stream correctly handles change.applied and stale state', () => {
  const staleEvent: RepoPilotEvent = {
    type: 'change.applied',
    requestId: 'req-3',
    result: {
      requestId: 'req-3',
      status: 'stale',
      appliedPaths: [],
      appliedHunkIds: [],
      stalePaths: ['src/flask/helpers.py'],
      message: 'Files modified since proposal',
    },
  };

  const state = deriveStateFromEvents([staleEvent]);
  assert.ok(state.applyResult);
  assert.equal(state.applyResult.status, 'stale');
  assert.deepEqual(state.applyResult.stalePaths, ['src/flask/helpers.py']);
  assert.equal(state.applyResult.appliedPaths.length, 0);

  // Successfully applied event
  const appliedEvent: RepoPilotEvent = {
    type: 'change.applied',
    requestId: 'req-4',
    result: {
      requestId: 'req-4',
      status: 'applied',
      appliedPaths: ['src/flask/helpers.py'],
      appliedHunkIds: ['hunk-1'],
      stalePaths: [],
    },
  };

  const appliedState = deriveStateFromEvents([appliedEvent]);
  assert.ok(appliedState.applyResult);
  assert.equal(appliedState.applyResult.status, 'applied');
  assert.equal(appliedState.applyResult.appliedHunkIds.length, 1);
});

// ──────────────── 3. ImpactPanel Report Rendering & Graph Mapping ────────────────

test('getRiskColors returns theme variables with the light palette as fallback', () => {
  const high = getRiskColors('high');
  assert.equal(high.text, 'var(--rp-risk-high-text, #cf222e)');
  assert.equal(high.bg, 'var(--rp-risk-high-bg, #ffebe9)');

  const med = getRiskColors('medium');
  assert.equal(med.text, 'var(--rp-risk-medium-text, #9a6700)');
  assert.equal(med.bg, 'var(--rp-risk-medium-bg, #fff8c5)');

  const low = getRiskColors('low');
  assert.equal(low.text, 'var(--rp-risk-low-text, #0969da)');
  assert.equal(low.bg, 'var(--rp-risk-low-bg, #ddf4ff)');

  const def = getRiskColors(undefined);
  assert.equal(def.text, 'var(--rp-risk-none-text, #57606a)');
});

test('getConfidenceBadge returns correct label and color tokens', () => {
  const high = getConfidenceBadge('high');
  assert.equal(high.label, 'High Conf.');
  assert.equal(high.text, 'var(--rp-conf-high-text, #1a7f37)');

  const med = getConfidenceBadge('medium');
  assert.equal(med.label, 'Med Conf.');
  assert.equal(med.text, 'var(--rp-risk-medium-text, #9a6700)');

  const low = getConfidenceBadge('low');
  assert.equal(low.label, 'Low Conf.');
  assert.equal(low.text, 'var(--rp-risk-none-text, #57606a)');
});

test('buildImpactFlowGraph transforms sample report into valid React Flow nodes and edges', () => {
  const { nodes, edges } = buildImpactFlowGraph(sampleReport);

  // Verify node counts and properties
  assert.equal(nodes.length, 6);
  const changedNode = nodes.find((n) => n.id === 'src/flask/helpers.py');
  assert.ok(changedNode);
  assert.equal(changedNode.style?.backgroundColor, 'var(--rp-changed-bg, #fbefff)'); // Highlighted style for changed target

  const highRiskNode = nodes.find((n) => n.id === 'src/flask/app.py');
  assert.ok(highRiskNode);
  assert.equal(highRiskNode.style?.backgroundColor, 'var(--rp-risk-high-bg, #ffebe9)'); // High risk bg

  // Verify edges and dashed inferred evidence
  assert.equal(edges.length, 5);
  const inferredEdge = edges.find((e) => e.id === 'docs/cli.rst→src/flask/cli.py:references');
  assert.ok(inferredEdge);
  assert.equal(inferredEdge.animated, true);
  assert.equal(inferredEdge.style?.strokeDasharray, '5,5');

  const observedEdge = edges.find((e) => e.id === 'src/flask/app.py→src/flask/helpers.py:imports');
  assert.ok(observedEdge);
  assert.equal(observedEdge.animated, false);
  assert.equal(observedEdge.style?.strokeDasharray, undefined);
});
