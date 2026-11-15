import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  RepoPilotEvent,
  ChangePlan,
  HunkDecision,
  ImpactReport,
  VerificationReport,
} from '../../../src/shared/contracts';
import {
  makeDecisionKey,
  parseDecisionKey,
  DECISION_KEY_SEPARATOR,
} from '../../../src/webview/components/DiffReview';
import {
  getRiskColors,
  getConfidenceBadge,
} from '../../../src/webview/components/ImpactPanel';
import { sampleReport } from '../../fixtures/impact/sample-report';

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
}

function deriveStateFromEvents(events: RepoPilotEvent[]): AppStateFromEvents {
  let agentState = 'idle';
  let changePlan: ChangePlan | undefined;
  let impactReport: ImpactReport | undefined;
  let verificationReport: VerificationReport | undefined;
  let errorMessage: string | undefined;

  for (const e of events) {
    if (e.type === 'agent.status') {
      agentState = e.state;
    } else if (e.type === 'change.proposed') {
      changePlan = e.plan;
    } else if (e.type === 'impact.ready') {
      impactReport = e.report;
    } else if (e.type === 'verification.completed') {
      verificationReport = e.report;
    } else if (e.type === 'agent.error') {
      agentState = 'error';
      errorMessage = e.error.message;
    }
  }

  return { agentState, changePlan, impactReport, verificationReport, errorMessage };
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
  assert.equal(state.errorMessage, undefined);
});

test('event stream correctly captures error state', () => {
  const events: RepoPilotEvent[] = [
    { type: 'agent.status', requestId: 'req-2', state: 'retrieving_context', message: 'Scanning' },
    { type: 'agent.error', requestId: 'req-2', error: { kind: 'auth_config', message: 'Failed to access file outside workspace', retryable: false } },
  ];

  const state = deriveStateFromEvents(events);
  assert.equal(state.agentState, 'error');
  assert.equal(state.errorMessage, 'Failed to access file outside workspace');
});

// ──────────────── 3. ImpactPanel Report Rendering & Semantic Mapping ────────────────

test('getRiskColors returns semantic light theme palette values', () => {
  const high = getRiskColors('high');
  assert.equal(high.text, '#cf222e');
  assert.equal(high.bg, '#ffebe9');

  const med = getRiskColors('medium');
  assert.equal(med.text, '#9a6700');
  assert.equal(med.bg, '#fff8c5');

  const low = getRiskColors('low');
  assert.equal(low.text, '#0969da');
  assert.equal(low.bg, '#ddf4ff');

  const def = getRiskColors(undefined);
  assert.equal(def.text, '#57606a');
});

test('getConfidenceBadge returns correct label and color tokens', () => {
  const high = getConfidenceBadge('high');
  assert.equal(high.label, 'High Conf.');
  assert.equal(high.text, '#1a7f37');

  const med = getConfidenceBadge('medium');
  assert.equal(med.label, 'Med Conf.');
  assert.equal(med.text, '#9a6700');

  const low = getConfidenceBadge('low');
  assert.equal(low.label, 'Low Conf.');
  assert.equal(low.text, '#57606a');
});

test('ImpactPanel verifies complete sample-report structure and mappings', () => {
  assert.equal(sampleReport.requestId, 'fixture-mini-flask');
  assert.equal(sampleReport.changedTargets[0], 'src/flask/helpers.py');

  // Verify node structure & highlights
  assert.equal(sampleReport.nodes.length, 6);
  const changedNode = sampleReport.nodes.find((n) => n.highlight === 'changed');
  assert.ok(changedNode);
  assert.equal(changedNode.id, 'src/flask/helpers.py');

  const affectedNodes = sampleReport.nodes.filter((n) => n.highlight === 'affected');
  assert.equal(affectedNodes.length, 5);

  // Verify edges and inferred evidence
  assert.equal(sampleReport.edges.length, 5);
  const inferredEdge = sampleReport.edges.find((e) => e.evidence === 'inferred');
  assert.ok(inferredEdge);
  assert.equal(inferredEdge.source, 'docs/cli.rst');
  assert.equal(inferredEdge.target, 'src/flask/cli.py');

  // Verify affected files list (uncapped)
  assert.equal(sampleReport.affectedFiles.length, 5);
  sampleReport.affectedFiles.forEach((file) => {
    assert.ok(file.path.length > 0);
    assert.ok(['high', 'medium', 'low'].includes(file.risk));
    assert.ok(['high', 'medium', 'low'].includes(file.confidence));
    assert.ok(file.reasons.length > 0);
    assert.ok(file.relationshipPath.length >= 2);
  });

  // Verify summary and limitations
  assert.equal(sampleReport.summary.analysedFiles, 6);
  assert.equal(sampleReport.summary.affectedCount, 5);
  assert.equal(sampleReport.summary.high, 3);
  assert.equal(sampleReport.summary.medium, 1);
  assert.equal(sampleReport.summary.low, 1);
  assert.equal(sampleReport.summary.incomplete, false);
  assert.equal(sampleReport.limitations.length, 4);
});
