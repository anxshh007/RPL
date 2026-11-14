import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createImpactAnalyser } from '../../../src/impact';
import { buildDependencyGraph } from '../../../src/impact/dependency-graph';
import {
  DEFAULT_MAX_GRAPH_NODES,
  buildGraphData,
  edgeId,
} from '../../../src/impact/graph-adapter';
import type { ImpactGraphData } from '../../../src/impact/graph-adapter';
import type {
  AffectedFile,
  DependencyEdge,
  ImpactReport,
  RiskLevel,
} from '../../../src/shared/contracts';
import {
  BASIC_PATHS,
  MINI_FLASK_PATHS,
  SAMPLE_REPORT_GENERATED_AT,
  SAMPLE_REPORT_OPTIONS,
  allFixtures,
  cycle,
  edge,
  emptyRepository,
  makeContext,
  makeRequest,
  miniFlask,
  miniFlaskProposed,
  sampleReport,
  singleFile,
} from '../../fixtures/impact';
import type { ImpactFixture } from '../../fixtures/impact';

const { a: A, b: B, c: C } = BASIC_PATHS;
const fixedClock = (): Date => new Date(SAMPLE_REPORT_GENERATED_AT);

type AnalyserOptions = Parameters<typeof createImpactAnalyser>[0];

function reportFor(fixture: ImpactFixture, options?: AnalyserOptions): Promise<ImpactReport> {
  return createImpactAnalyser({ now: fixedClock, ...options }).analyseImpact(
    fixture.request,
    fixture.context,
    fixture.proposedFiles,
  );
}

function reportFrom(
  edges: DependencyEdge[],
  targets: string[],
  options?: AnalyserOptions,
): Promise<ImpactReport> {
  return createImpactAnalyser({ now: fixedClock, ...options }).analyseImpact(
    makeRequest('r', { explicitFileMentions: targets }),
    makeContext('r', { dependencyEdges: edges }),
  );
}

/** A minimal affected file, for calling the adapter directly. */
function affected(path: string, risk: RiskLevel, relationshipPath: string[]): AffectedFile {
  return {
    path,
    risk,
    reasons: ['test'],
    relationshipPath,
    confidence: 'high',
    relatedSymbols: [],
    matchedRule: 'direct-dependency',
  };
}

/** Checks the invariants every graph must satisfy. */
function assertGraphInvariants(report: ImpactReport, label: string): void {
  const ids = report.nodes.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: node ids are unique`);
  const edgeIds = report.edges.map((e) => e.id);
  assert.equal(new Set(edgeIds).size, edgeIds.length, `${label}: edge ids are unique`);

  const changed = new Set(report.changedTargets);
  const riskByPath = new Map(report.affectedFiles.map((file) => [file.path, file.risk]));
  for (const node of report.nodes) {
    assert.equal(node.id, node.path, `${label}: node id is its path`);
    assert.ok(node.label.length > 0 && !node.label.includes('/'), `${label}: label is a file name`);
    if (changed.has(node.id)) {
      assert.equal(node.highlight, 'changed', `${label}: ${node.id} is changed`);
      assert.ok(!('risk' in node), `${label}: a changed node has no risk`);
    } else if (riskByPath.has(node.id)) {
      assert.equal(node.highlight, 'affected', `${label}: ${node.id} is affected`);
      assert.equal(node.risk, riskByPath.get(node.id), `${label}: ${node.id} carries its risk`);
    } else {
      assert.equal(node.highlight, 'none', `${label}: ${node.id} is only on a path`);
      assert.ok(!('risk' in node), `${label}: an on-path node has no risk`);
    }
  }
  for (const e of report.edges) {
    assert.equal(e.id, `${e.source}→${e.target}:${e.kind}`, `${label}: edge id format`);
    assert.ok(ids.includes(e.source), `${label}: edge source ${e.source} is a node`);
    assert.ok(ids.includes(e.target), `${label}: edge target ${e.target} is a node`);
  }
}

// ───────────────────────── Ids and fields ─────────────────────────

test('graph: node id is the path, edge id is source→target:kind', async () => {
  assert.equal(edgeId('a.py', 'b.py', 'imports'), 'a.py→b.py:imports');
  assert.equal(edgeId('a.py', 'b.py', 'imports').charCodeAt(4), 0x2192, 'the arrow is U+2192');

  const P = MINI_FLASK_PATHS;
  const report = await reportFor(miniFlask);
  assert.deepEqual(
    report.nodes.map((node) => node.id),
    [P.helpers, P.app, P.testHelpers, P.cli],
  );
  assert.deepEqual(
    report.edges.map((e) => e.id),
    [
      'src/flask/app.py→src/flask/helpers.py:imports',
      'src/flask/cli.py→src/flask/app.py:imports',
      'tests/test_helpers.py→src/flask/helpers.py:imports',
    ],
  );
});

test('graph: an edge runs from the dependant (source) to what it depends on (target)', async () => {
  const report = await reportFrom([edge(B, A)], [A]);
  assert.deepEqual(report.edges, [
    { id: `${B}→${A}:imports`, source: B, target: A, kind: 'imports', evidence: 'observed' },
  ]);
});

test('graph: changed nodes are "changed", affected nodes are "affected" and carry their risk', async () => {
  const P = MINI_FLASK_PATHS;
  const report = await reportFor(miniFlaskProposed);
  assert.deepEqual(report.nodes, [
    { id: P.cli, label: 'cli.py', kind: 'file', path: P.cli, highlight: 'changed' },
    { id: P.helpers, label: 'helpers.py', kind: 'file', path: P.helpers, highlight: 'changed' },
    { id: P.app, label: 'app.py', kind: 'file', path: P.app, highlight: 'affected', risk: 'high' },
    {
      id: P.testCli,
      label: 'test_cli.py',
      kind: 'test',
      path: P.testCli,
      highlight: 'affected',
      risk: 'high',
    },
    {
      id: P.testHelpers,
      label: 'test_helpers.py',
      kind: 'test',
      path: P.testHelpers,
      highlight: 'affected',
      risk: 'high',
    },
    { id: P.docsCli, label: 'cli.rst', kind: 'file', path: P.docsCli, highlight: 'affected', risk: 'low' },
  ]);
  const inferred = report.edges.filter((e) => e.evidence === 'inferred');
  assert.deepEqual(
    inferred.map((e) => e.id),
    ['docs/cli.rst→src/flask/cli.py:references'],
    'inferred links are marked as such',
  );
});

test('graph: a file that is only on a path is highlighted "none"', () => {
  // Called directly: B is on the path to C but is not in the affected list.
  const graph = buildDependencyGraph({
    dependencyEdges: [edge(B, A), edge(C, B)],
    unresolvedImports: [],
  });
  const data = buildGraphData({
    graph,
    changedTargets: [A],
    affectedFiles: [affected(C, 'medium', [A, B, C])],
  });
  assert.deepEqual(data.nodes, [
    { id: A, label: 'a.py', kind: 'file', path: A, highlight: 'changed' },
    { id: C, label: 'c.py', kind: 'file', path: C, highlight: 'affected', risk: 'medium' },
    { id: B, label: 'b.py', kind: 'file', path: B, highlight: 'none' },
  ]);
  assert.deepEqual(
    data.edges.map((e) => e.id),
    [`${B}→${A}:imports`, `${C}→${B}:imports`],
  );
  assert.deepEqual(data.warnings, []);
});

test('graph: every known link between shown files is an edge, including cycles', async () => {
  const report = await reportFor(cycle);
  assert.deepEqual(
    report.edges.map((e) => e.id),
    [`${A}→${B}:imports`, `${B}→${A}:imports`],
  );
});

test('graph: a changed file with no links is still a node; no changed files means no graph', async () => {
  const single = await reportFor(singleFile);
  assert.deepEqual(single.nodes, [{ id: A, label: 'a.py', kind: 'file', path: A, highlight: 'changed' }]);
  assert.deepEqual(single.edges, []);

  const empty = await reportFor(emptyRepository);
  assert.deepEqual(empty.nodes, []);
  assert.deepEqual(empty.edges, []);
});

// ───────────────────────── The node cap ─────────────────────────

/** A changed, 30 files importing it (high), and 30 files importing the first of those (medium). */
function wideGraph(): DependencyEdge[] {
  const pad = (i: number): string => String(i).padStart(2, '0');
  const direct = Array.from({ length: 30 }, (_, i) => edge(`src/gen/h${pad(i)}.py`, A));
  const twoHop = Array.from({ length: 30 }, (_, i) => edge(`src/gen/m${pad(i)}.py`, 'src/gen/h00.py'));
  return [...twoHop, ...direct];
}

test('cap: the default is 50 nodes, changed first, then by risk, with a warning when trimmed', async () => {
  assert.equal(DEFAULT_MAX_GRAPH_NODES, 50);
  const report = await reportFrom(wideGraph(), [A]);

  assert.equal(report.affectedFiles.length, 60, 'affectedFiles is never trimmed');
  assert.equal(report.nodes.length, 50);
  assert.equal(report.nodes[0]?.id, A);
  assert.equal(report.nodes[0]?.highlight, 'changed');
  assert.deepEqual(
    report.nodes.slice(1).map((node) => node.risk),
    [...Array<RiskLevel>(30).fill('high'), ...Array<RiskLevel>(19).fill('medium')],
    'all 30 high-risk files are kept; 19 of the 30 medium ones fit',
  );
  assert.equal(report.nodes.at(-1)?.id, 'src/gen/m18.py');
  assert.deepEqual(report.warnings, [
    'The impact graph is limited to 50 files and shows 50 of 61; affectedFiles lists them all.',
  ]);
  assert.equal(report.summary.incomplete, false);
  assertGraphInvariants(report, 'wide graph');
  assert.ok(
    !report.edges.some((e) => e.source === 'src/gen/m19.py'),
    'edges to trimmed nodes are dropped',
  );
});

test('cap: exactly at the cap there is no warning', async () => {
  const edges = Array.from({ length: 49 }, (_, i) => edge(`src/gen/f${String(i).padStart(2, '0')}.py`, A));
  const report = await reportFrom(edges, [A]);
  assert.equal(report.nodes.length, 50);
  assert.deepEqual(report.warnings, []);
});

test('cap: configurable, and an invalid value falls back to the default with a warning', async () => {
  const P = MINI_FLASK_PATHS;
  const small = await reportFor(miniFlask, { maxGraphNodes: 2 });
  assert.deepEqual(
    small.nodes.map((node) => node.id),
    [P.helpers, P.app],
  );
  assert.deepEqual(
    small.edges.map((e) => e.id),
    ['src/flask/app.py→src/flask/helpers.py:imports'],
  );
  assert.deepEqual(small.warnings, [
    'The impact graph is limited to 2 files and shows 2 of 4; affectedFiles lists them all.',
  ]);

  const invalid = await reportFor(miniFlask, { maxGraphNodes: 0 });
  assert.equal(invalid.nodes.length, 4);
  assert.deepEqual(invalid.warnings, ['Invalid maxGraphNodes (0); using the default of 50.']);
});

// ───────────────────────── Semantic only ─────────────────────────

test('no styling: nodes and edges carry only the contract fields and semantic values', async () => {
  const nodeKeys = new Set(['id', 'label', 'kind', 'path', 'highlight', 'risk']);
  const edgeKeys = ['evidence', 'id', 'kind', 'source', 'target'];
  const styling = /colou?r|css|style|theme|#[0-9a-f]{3,8}\b|rgb\(|hsl\(|px\b/i;

  for (const fixture of allFixtures) {
    const report = await reportFor(fixture, { maxDepth: 3 });
    for (const node of report.nodes) {
      for (const key of Object.keys(node)) {
        assert.ok(nodeKeys.has(key), `${fixture.name}: unexpected node field "${key}"`);
      }
      assert.ok(['file', 'symbol', 'test'].includes(node.kind));
      assert.ok(['changed', 'affected', 'none'].includes(node.highlight));
    }
    for (const e of report.edges) {
      assert.deepEqual(Object.keys(e).sort(), edgeKeys, `${fixture.name}: edge fields`);
      assert.ok(['imports', 'references', 'exports', 'tests'].includes(e.kind));
      assert.ok(['observed', 'inferred'].includes(e.evidence));
    }
    const graphOnly: ImpactGraphData = { nodes: report.nodes, edges: report.edges, warnings: [] };
    assert.ok(!styling.test(JSON.stringify(graphOnly)), `${fixture.name}: no styling in graph data`);
  }
});

// ───────────────────────── Every fixture ─────────────────────────

test('graph: invariants hold on every fixture at depths 1 to 4', async () => {
  for (const fixture of allFixtures) {
    for (const maxDepth of [1, 2, 3, 4]) {
      const report = await reportFor(fixture, { maxDepth });
      assertGraphInvariants(report, `${fixture.name} depth ${maxDepth}`);
      assert.ok(report.nodes.length <= DEFAULT_MAX_GRAPH_NODES);
    }
  }
});

test('graph: deterministic, and independent of edge order', async () => {
  const edges = [...wideGraph(), ...miniFlask.context.dependencyEdges];
  const targets = [A, MINI_FLASK_PATHS.helpers];
  const first = await reportFrom(edges, targets);
  const again = await reportFrom(edges, targets);
  const reversed = await reportFrom([...edges].reverse(), [...targets].reverse());

  assert.deepEqual(again.nodes, first.nodes);
  assert.deepEqual(again.edges, first.edges);
  assert.deepEqual(reversed.nodes, first.nodes);
  assert.deepEqual(reversed.edges, first.edges);
});

// ───────────────────────── The sample report ─────────────────────────

test('sample report: matches what the analyser produces for mini-Flask', async () => {
  const fresh = await reportFor(miniFlask, SAMPLE_REPORT_OPTIONS);
  assert.deepEqual(sampleReport, fresh);
  assert.equal(JSON.stringify(sampleReport), JSON.stringify(fresh), 'same field and item order');
});

test('sample report: contains every value the UI has to handle', () => {
  const values = <T>(items: readonly T[]): T[] => [...new Set(items)].sort();

  assert.deepEqual(values(sampleReport.affectedFiles.map((f) => f.risk)), ['high', 'low', 'medium']);
  assert.deepEqual(values(sampleReport.affectedFiles.map((f) => f.confidence)), ['high', 'low', 'medium']);
  assert.deepEqual(values(sampleReport.nodes.map((n) => n.highlight)), ['affected', 'changed']);
  assert.deepEqual(values(sampleReport.nodes.map((n) => n.kind)), ['file', 'test']);
  assert.deepEqual(values(sampleReport.edges.map((e) => e.kind)), ['imports', 'references']);
  assert.deepEqual(values(sampleReport.edges.map((e) => e.evidence)), ['inferred', 'observed']);
  assert.ok(sampleReport.testCandidates.length >= 2);
  assert.equal(sampleReport.summary.incomplete, false);
  assertGraphInvariants(sampleReport, 'sample report');
});
