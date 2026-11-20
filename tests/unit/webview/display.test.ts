// Panel display (owner: Member 5): step spinners, graph arrow direction, and theme colours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Position } from 'reactflow';
import type { ImpactReport, RepoPilotEvent } from '../../../src/shared/contracts';
import { deriveThinkingSteps } from '../../../src/webview/state/thinkingSteps';
import { getStatusBadge } from '../../../src/webview/state/agentStatus';
import { buildImpactFlowGraph, getConfidenceBadge, getRiskColors } from '../../../src/webview/components/ImpactPanel';

const status = (state: string, message: string): RepoPilotEvent =>
  ({ type: 'agent.status', requestId: 'r1', state, message }) as RepoPilotEvent;

// ─────────────── Steps ───────────────

test('steps: earlier steps are finished, the latest spins while the agent works', () => {
  const steps = deriveThinkingSteps([
    status('starting', 'Request received.'),
    status('retrieving_context', 'Retrieving repository context…'),
    { type: 'agent.warning', requestId: 'r1', message: 'not a step' },
    status('analysing_impact', 'Analysing impact…'),
  ]);
  assert.deepEqual(steps.map((s) => s.status), ['completed', 'completed', 'running']);
  assert.deepEqual(steps.map((s) => s.label), ['Request received.', 'Retrieving repository context…', 'Analysing impact…']);
});

test('steps: when the run ends, every step is finished ("5/5", not "1/5")', () => {
  for (const end of ['completed', 'cancelled', 'error', 'review_required']) {
    const steps = deriveThinkingSteps([
      status('starting', 'a'),
      status('retrieving_context', 'b'),
      status('analysing_impact', 'c'),
      status('planning', 'd'),
      status(end, 'e'),
    ]);
    assert.equal(steps.filter((s) => s.status === 'completed').length, 5, end);
  }
});

test('steps: no status events, no steps', () => {
  assert.deepEqual(deriveThinkingSteps([]), []);
});

// ─────────────── Graph arrows ───────────────

const chain: ImpactReport = {
  requestId: 'r1',
  generatedAt: '2026-01-01T00:00:00.000Z',
  changedTargets: ['pkg/helper.py'],
  affectedFiles: [
    { path: 'pkg/mid.py', risk: 'high', reasons: ['imports pkg/helper.py'], relationshipPath: ['pkg/helper.py', 'pkg/mid.py'], confidence: 'high', relatedSymbols: [], matchedRule: 'direct-dependency' },
    { path: 'pkg/top.py', risk: 'medium', reasons: ['imports pkg/mid.py'], relationshipPath: ['pkg/helper.py', 'pkg/mid.py', 'pkg/top.py'], confidence: 'medium', relatedSymbols: [], matchedRule: 'transitive-dependency' },
    { path: 'tests/test_helper.py', risk: 'high', reasons: ['tests pkg/helper.py'], relationshipPath: ['pkg/helper.py', 'tests/test_helper.py'], confidence: 'medium', relatedSymbols: [], matchedRule: 'test-convention' },
  ],
  testCandidates: [],
  nodes: [
    { id: 'pkg/helper.py', label: 'helper.py', kind: 'file', highlight: 'changed' },
    { id: 'pkg/mid.py', label: 'mid.py', kind: 'file', highlight: 'affected', risk: 'high' },
    { id: 'pkg/top.py', label: 'top.py', kind: 'file', highlight: 'affected', risk: 'medium' },
    { id: 'tests/test_helper.py', label: 'test_helper.py', kind: 'test', highlight: 'affected', risk: 'high' },
  ],
  edges: [
    { id: 'e1', source: 'pkg/mid.py', target: 'pkg/helper.py', kind: 'imports', evidence: 'observed' },
    { id: 'e2', source: 'pkg/top.py', target: 'pkg/mid.py', kind: 'imports', evidence: 'observed' },
    { id: 'e3', source: 'tests/test_helper.py', target: 'pkg/helper.py', kind: 'tests', evidence: 'inferred' },
  ],
  summary: { analysedFiles: 4, affectedCount: 3, high: 2, medium: 1, low: 0, incomplete: false },
  warnings: [],
  limitations: [],
};

test('graph: arrows leave a box on the right and enter the next box on the left', () => {
  const { nodes } = buildImpactFlowGraph(chain);
  for (const n of nodes) {
    assert.equal(n.sourcePosition, Position.Right, n.id);
    assert.equal(n.targetPosition, Position.Left, n.id);
  }
});

test('graph: every arrow points rightwards (dependant left of its dependency), so none has to loop', () => {
  const { nodes, edges } = buildImpactFlowGraph(chain);
  const x = new Map(nodes.map((n) => [n.id, n.position.x]));
  for (const e of edges) {
    assert.ok((x.get(e.source) ?? 0) < (x.get(e.target) ?? 0), `${e.source} → ${e.target}`);
  }
});

// ─────────────── Theme colours ───────────────

const css = fs.readFileSync(path.resolve(__dirname, '../../../../src/webview/styles.css'), 'utf-8');
const rootBlock = css.slice(css.indexOf('Theme-aware palette'), css.indexOf('body.vscode-dark, body.vscode-high-contrast {'));
const darkBlock = css.slice(css.indexOf('body.vscode-dark, body.vscode-high-contrast {'));

function usedVariables(): string[] {
  const values: string[] = [];
  for (const risk of ['high', 'medium', 'low', undefined] as const) values.push(...Object.values(getRiskColors(risk)));
  for (const c of ['high', 'medium', 'low', undefined] as const) {
    const b = getConfidenceBadge(c);
    values.push(b.bg, b.text);
  }
  for (const s of ['starting', 'review_required', 'completed', 'error', 'idle']) values.push(...Object.values(getStatusBadge(s)));
  const g = buildImpactFlowGraph(chain);
  for (const n of g.nodes) values.push(String(n.style?.backgroundColor), String(n.style?.borderColor));
  for (const e of g.edges) values.push(String(e.style?.stroke));
  return [...new Set(values.flatMap((v) => [...v.matchAll(/var\((--rp-[a-z-]+),/g)].map((m) => m[1])))];
}

test('theme: colours set from code are CSS variables with the light colour as fallback', () => {
  for (const v of [...Object.values(getRiskColors('high')), ...Object.values(getStatusBadge('planning'))]) {
    assert.match(v, /^var\(--rp-[a-z-]+, (#[0-9a-f]{6}|rgba\([^)]*\))\)$/);
  }
});

test('theme: every variable used from code has a light value and a dark value in styles.css', () => {
  const used = usedVariables();
  assert.ok(used.length >= 15, `found ${used.length}`);
  for (const name of used) {
    assert.ok(rootBlock.includes(`${name}:`), `${name} missing from :root`);
    assert.ok(darkBlock.includes(`${name}:`), `${name} missing from the dark theme block`);
  }
});

test('theme: dark themes override the fixed light text colours that were unreadable', () => {
  for (const cls of ['text-gray-900', 'text-gray-700', 'text-gray-500', 'text-blue-700', 'bg-white', 'bg-gray-50']) {
    assert.ok(new RegExp(`vscode-dark[^{]*\\.${cls}\\b`).test(css), cls);
  }
});
