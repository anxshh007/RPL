import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDependencyGraph } from '../../../src/impact/dependency-graph';
import { resolveChangedTargets, traceImpact } from '../../../src/impact/impact-analyser';
import type { TraversalOptions } from '../../../src/impact/impact-analyser';
import {
  CONTEXT_LIMITATION,
  ESTIMATE_LIMITATION,
  NO_EDGES_WARNING,
  STATIC_ANALYSIS_LIMITATION,
  assembleReport,
  depthLimitation,
} from '../../../src/impact/impact-report';
import type {
  ChangeRequest,
  DependencyEdge,
  ImpactReport,
  RepositoryContext,
} from '../../../src/shared/contracts';
import {
  BAD_PATHS,
  BASIC_PATHS,
  MINI_FLASK_PATHS,
  allFixtures,
  badPath,
  directImport,
  edge,
  emptyRepository,
  inferredOnly,
  makeContext,
  makeRequest,
  miniFlask,
  miniFlaskProposed,
  singleFile,
  unresolvedImport,
} from '../../fixtures/impact';
import type { ImpactFixture } from '../../fixtures/impact';

const { a: A, b: B, c: C, d: D, guide: GUIDE, testA: TEST_A } = BASIC_PATHS;
const X = 'src/pkg/x.py';
const FIXED_TIME = '2026-01-01T00:00:00.000Z';
const NO_TARGETS_WARNING =
  'No changed files were given (no proposed files, active file or file mentions); nothing to analyse.';

/** Builds a report from its parts, the same way the entry point does. */
function build(
  request: ChangeRequest,
  context: RepositoryContext | undefined,
  proposedFiles?: string[],
  options?: TraversalOptions,
): ImpactReport {
  const changed = resolveChangedTargets(request, proposedFiles);
  const graph = buildDependencyGraph(context);
  const traversal = traceImpact(graph, changed.targets, options);
  return assembleReport({
    requestId: request.requestId,
    generatedAt: FIXED_TIME,
    changed,
    graph,
    traversal,
  });
}

function reportFor(fixture: ImpactFixture, options?: TraversalOptions): ImpactReport {
  return build(fixture.request, fixture.context, fixture.proposedFiles, options);
}

function reportFrom(
  edges: DependencyEdge[],
  targets: string[],
  options?: TraversalOptions,
): ImpactReport {
  return build(
    makeRequest('r', { explicitFileMentions: targets }),
    makeContext('r', { dependencyEdges: edges }),
    undefined,
    options,
  );
}

function affectedPaths(report: ImpactReport): string[] {
  return report.affectedFiles.map((file) => file.path);
}

// ───────────────────────── The whole report ─────────────────────────

test('report: every field is filled for mini-Flask', () => {
  const P = MINI_FLASK_PATHS;
  assert.deepEqual(reportFor(miniFlask), {
    requestId: 'fixture-mini-flask',
    generatedAt: FIXED_TIME,
    changedTargets: [P.helpers],
    affectedFiles: [
      {
        path: P.app,
        risk: 'high',
        reasons: [
          'imports src/flask/helpers.py, which is being changed',
          'is an entry point or configuration file (name matches "app.py")',
        ],
        relationshipPath: [P.helpers, P.app],
        confidence: 'high',
        relatedSymbols: [],
        matchedRule: 'direct-dependency',
      },
      {
        path: P.testHelpers,
        risk: 'high',
        reasons: [
          'imports src/flask/helpers.py, which is being changed',
          'is a test file linked to the change',
        ],
        relationshipPath: [P.helpers, P.testHelpers],
        confidence: 'high',
        relatedSymbols: [],
        matchedRule: 'direct-dependency',
      },
      {
        path: P.cli,
        risk: 'high',
        reasons: [
          'is an entry point or configuration file (name matches "cli.py")',
          'is two hops from the change: imports src/flask/app.py, which imports ' +
            'src/flask/helpers.py, which is being changed',
        ],
        relationshipPath: [P.helpers, P.app, P.cli],
        confidence: 'medium',
        relatedSymbols: [],
        matchedRule: 'entry-or-config',
      },
    ],
    testCandidates: [
      {
        path: P.testHelpers,
        reason: 'Depends directly on src/flask/helpers.py, which is being changed.',
        source: 'impact',
        confidence: 'high',
      },
    ],
    nodes: [
      { id: P.helpers, label: 'helpers.py', kind: 'file', path: P.helpers, highlight: 'changed' },
      { id: P.app, label: 'app.py', kind: 'file', path: P.app, highlight: 'affected', risk: 'high' },
      {
        id: P.testHelpers,
        label: 'test_helpers.py',
        kind: 'test',
        path: P.testHelpers,
        highlight: 'affected',
        risk: 'high',
      },
      { id: P.cli, label: 'cli.py', kind: 'file', path: P.cli, highlight: 'affected', risk: 'high' },
    ],
    edges: [
      {
        id: 'src/flask/app.py→src/flask/helpers.py:imports',
        source: P.app,
        target: P.helpers,
        kind: 'imports',
        evidence: 'observed',
      },
      {
        id: 'src/flask/cli.py→src/flask/app.py:imports',
        source: P.cli,
        target: P.app,
        kind: 'imports',
        evidence: 'observed',
      },
      {
        id: 'tests/test_helpers.py→src/flask/helpers.py:imports',
        source: P.testHelpers,
        target: P.helpers,
        kind: 'imports',
        evidence: 'observed',
      },
    ],
    summary: { analysedFiles: 6, affectedCount: 3, high: 3, medium: 0, low: 0, incomplete: false },
    warnings: [],
    limitations: [
      'Static analysis only; does not prove runtime impact.',
      ESTIMATE_LIMITATION,
      'Only files within 2 hops of a changed file are reported.',
      CONTEXT_LIMITATION,
    ],
  });
});

test('report: affected files are ordered by risk, then hops, then path', () => {
  const edges = [
    edge(D, C),
    edge(C, B),
    edge(B, A),
    edge(X, A),
    edge(GUIDE, A, 'references', 'inferred'),
  ];
  const report = reportFrom(edges, [A], { maxDepth: 3 });
  assert.deepEqual(
    report.affectedFiles.map((f) => [f.path, f.risk, f.relationshipPath.length - 1]),
    [
      [B, 'high', 1],
      [X, 'high', 1],
      [C, 'medium', 2],
      [GUIDE, 'low', 1],
      [D, 'low', 3],
    ],
  );
  assert.deepEqual(report.summary, {
    analysedFiles: 6,
    affectedCount: 5,
    high: 2,
    medium: 1,
    low: 2,
    incomplete: false,
  });
});

// ───────────────────────── Test candidates ─────────────────────────

test('test candidates: affected test files are listed and stay in affectedFiles', () => {
  const P = MINI_FLASK_PATHS;
  const report = reportFor(miniFlaskProposed);
  assert.deepEqual(report.testCandidates, [
    {
      path: P.testCli,
      reason: 'Depends directly on src/flask/cli.py, which is being changed.',
      source: 'impact',
      confidence: 'high',
    },
    {
      path: P.testHelpers,
      reason: 'Depends directly on src/flask/helpers.py, which is being changed.',
      source: 'impact',
      confidence: 'high',
    },
  ]);
  for (const candidate of report.testCandidates) {
    assert.ok(affectedPaths(report).includes(candidate.path), `${candidate.path} is still affected`);
  }
  assert.ok(!report.testCandidates.some((c) => c.path === P.docsCli), 'a doc is not a test candidate');
});

test('test candidates: detected by tests/ directory, test_*.py and *_test.py', () => {
  const edges = [
    edge(B, A),
    edge('tests/integration/checks.py', A),
    edge('src/pkg/test_utils.py', B),
    edge('src/pkg/utils_test.py', B),
    edge('src/pkg/testing.py', A),
  ];
  const report = reportFrom(edges, [A]);
  assert.deepEqual(report.testCandidates, [
    {
      path: 'tests/integration/checks.py',
      reason: 'Depends directly on src/pkg/a.py, which is being changed.',
      source: 'impact',
      confidence: 'high',
    },
    {
      path: 'src/pkg/test_utils.py',
      reason: 'Depends on src/pkg/a.py, which is being changed, through 2 hops.',
      source: 'impact',
      confidence: 'medium',
    },
    {
      path: 'src/pkg/utils_test.py',
      reason: 'Depends on src/pkg/a.py, which is being changed, through 2 hops.',
      source: 'impact',
      confidence: 'medium',
    },
  ]);
});

test('test candidates: an inferred link gives a low-confidence candidate that says so', () => {
  assert.deepEqual(reportFor(inferredOnly).testCandidates, [
    {
      path: TEST_A,
      reason:
        'Linked to src/pkg/a.py, which is being changed, by an inferred relationship ' +
        '(not observed in source).',
      source: 'impact',
      confidence: 'low',
    },
  ]);
});

// ───────────────────────── Limitations ─────────────────────────

test('limitations: the static-analysis limitation is always first', () => {
  assert.equal(STATIC_ANALYSIS_LIMITATION, 'Static analysis only; does not prove runtime impact.');
  for (const fixture of allFixtures) {
    assert.equal(reportFor(fixture).limitations[0], STATIC_ANALYSIS_LIMITATION, fixture.name);
  }
});

test('limitations: the depth limit in use is stated', () => {
  assert.equal(depthLimitation(1), 'Only files within 1 hop of a changed file are reported.');
  assert.ok(reportFor(miniFlask, { maxDepth: 1 }).limitations.includes(depthLimitation(1)));
  assert.ok(reportFor(miniFlask, { maxDepth: 3 }).limitations.includes(depthLimitation(3)));
});

// ───────────────────── Warnings and incomplete ─────────────────────

test('incomplete: a clean analysis is complete and has no warnings', () => {
  for (const fixture of [directImport, miniFlask, miniFlaskProposed, inferredOnly]) {
    const report = reportFor(fixture);
    assert.equal(report.summary.incomplete, false, fixture.name);
    assert.deepEqual(report.warnings, [], fixture.name);
  }
});

test('incomplete: bad paths are warned about, and the good edge is still analysed', () => {
  const report = reportFor(badPath);
  assert.deepEqual(report.changedTargets, [A]);
  assert.deepEqual(affectedPaths(report), [B]);
  assert.equal(report.summary.incomplete, true);
  assert.deepEqual(report.warnings, [
    `Ignored changed file "${BAD_PATHS.mentionParent}": paths containing ".." are not allowed.`,
    `Ignored changed file "${BAD_PATHS.mentionAbsolute}": absolute paths are not allowed.`,
    'Ignored 1 dependency edge with path "../outside/lib.py": paths containing ".." are not allowed.',
    'Ignored 1 dependency edge with path "/abs/elsewhere/c.py": absolute paths are not allowed.',
    'Ignored 1 dependency edge with path "C:\\Users\\someone\\d.py": absolute paths are not allowed.',
    'Ignored 1 dependency edge with path "src/pkg/../../escape.py": paths containing ".." are not allowed.',
  ]);
});

test('incomplete: one malformed edge gives a warning, not a crash', () => {
  const junk = [edge(B, A), null, { from: C, to: A }] as unknown as DependencyEdge[];
  const report = reportFrom(junk, [A]);
  assert.deepEqual(affectedPaths(report), [B]);
  assert.equal(report.summary.incomplete, true);
  assert.deepEqual(report.warnings, [
    'Ignored 2 malformed dependency edges (not an object, or an invalid kind or evidence).',
  ]);
});

test('incomplete: hitting the file cap or a cancelled signal marks the report incomplete', () => {
  const capped = reportFor(miniFlask, { maxVisitedFiles: 1 });
  assert.equal(capped.summary.incomplete, true);
  assert.equal(capped.summary.affectedCount, 1);
  assert.deepEqual(capped.warnings, [
    'Stopped after reaching the limit of 1 affected files; more files may be affected.',
  ]);

  const controller = new AbortController();
  controller.abort();
  const cancelled = reportFor(miniFlask, { signal: controller.signal });
  assert.equal(cancelled.summary.incomplete, true);
  assert.deepEqual(cancelled.affectedFiles, []);
  assert.deepEqual(cancelled.warnings, [
    'Analysis was cancelled before it finished; the results are partial.',
  ]);
});

test('incomplete: unresolved imports are warned about but do not mark the report incomplete', () => {
  const report = reportFor(unresolvedImport);
  assert.deepEqual(affectedPaths(report), [B]);
  assert.equal(report.summary.incomplete, false);
  assert.deepEqual(report.warnings, [
    `Unresolved import in ${B}: requests (impact through it is not analysed).`,
    `Unresolved import in ${C}: pkg.missing_module (impact through it is not analysed).`,
  ]);
  assert.ok(report.limitations.includes(CONTEXT_LIMITATION));
});

test('empty input: an empty repository gives a valid, empty, partial report', () => {
  assert.deepEqual(reportFor(emptyRepository), {
    requestId: 'fixture-empty-repository',
    generatedAt: FIXED_TIME,
    changedTargets: [],
    affectedFiles: [],
    testCandidates: [],
    nodes: [],
    edges: [],
    summary: { analysedFiles: 0, affectedCount: 0, high: 0, medium: 0, low: 0, incomplete: true },
    warnings: [NO_TARGETS_WARNING, NO_EDGES_WARNING],
    limitations: [
      STATIC_ANALYSIS_LIMITATION,
      ESTIMATE_LIMITATION,
      depthLimitation(2),
      CONTEXT_LIMITATION,
    ],
  });
});

test('empty input: a changed file with no edges at all is reported as partial', () => {
  const report = reportFor(singleFile);
  assert.deepEqual(report.changedTargets, [A]);
  assert.deepEqual(report.affectedFiles, []);
  assert.equal(report.summary.analysedFiles, 1);
  assert.equal(report.summary.incomplete, true);
  assert.deepEqual(report.warnings, [NO_EDGES_WARNING]);
});

test('empty input: no changed files, with a usable graph, is complete with a warning', () => {
  const report = build(emptyRepository.request, directImport.context);
  assert.deepEqual(report.changedTargets, []);
  assert.deepEqual(report.affectedFiles, []);
  assert.equal(report.summary.analysedFiles, 2);
  assert.equal(report.summary.incomplete, false);
  assert.deepEqual(report.warnings, [NO_TARGETS_WARNING]);
});

test('empty input: a missing context gives a partial report and one clear warning', () => {
  const report = build(directImport.request, undefined);
  assert.deepEqual(report.changedTargets, [A]);
  assert.deepEqual(report.affectedFiles, []);
  assert.equal(report.summary.incomplete, true);
  assert.deepEqual(report.warnings, ['Repository context is missing; the dependency graph is empty.']);
});

// ───────────────────────── Graph data ─────────────────────────

test('graph data: the report carries nodes and edges for the changed and affected files', () => {
  const report = reportFor(directImport);
  assert.deepEqual(report.nodes, [
    { id: A, label: 'a.py', kind: 'file', path: A, highlight: 'changed' },
    { id: B, label: 'b.py', kind: 'file', path: B, highlight: 'affected', risk: 'high' },
  ]);
  assert.deepEqual(report.edges, [
    { id: `${B}→${A}:imports`, source: B, target: A, kind: 'imports', evidence: 'observed' },
  ]);
});

test('graph data: trimming the graph warns, but the report stays complete and lists every file', () => {
  const changed = resolveChangedTargets(miniFlask.request);
  const graph = buildDependencyGraph(miniFlask.context);
  const traversal = traceImpact(graph, changed.targets);
  const report = assembleReport({
    requestId: 'r',
    generatedAt: FIXED_TIME,
    changed,
    graph,
    traversal,
    maxGraphNodes: 2,
  });

  assert.equal(report.nodes.length, 2);
  assert.equal(report.affectedFiles.length, 3, 'affectedFiles is not trimmed');
  assert.equal(report.summary.affectedCount, 3);
  assert.equal(report.summary.incomplete, false, 'a display limit is not missing analysis');
  assert.deepEqual(report.warnings, [
    'The impact graph is limited to 2 files and shows 2 of 4; affectedFiles lists them all.',
  ]);
});

// ───────────────────────── Every fixture ─────────────────────────

test('report: contract invariants hold on every fixture at depths 1 to 4', () => {
  for (const fixture of allFixtures) {
    for (const maxDepth of [1, 2, 3, 4]) {
      const report = reportFor(fixture, { maxDepth });
      const label = `${fixture.name} depth ${maxDepth}`;
      const changed = new Set(report.changedTargets);

      for (const key of [
        'changedTargets',
        'affectedFiles',
        'testCandidates',
        'nodes',
        'edges',
        'warnings',
        'limitations',
      ] as const) {
        assert.ok(Array.isArray(report[key]), `${label}: ${key} is an array, never null`);
      }
      assert.equal(report.requestId, fixture.request.requestId, label);
      assert.equal(report.generatedAt, FIXED_TIME, label);

      const { summary } = report;
      assert.equal(summary.affectedCount, report.affectedFiles.length, `${label}: affectedCount`);
      assert.equal(summary.high + summary.medium + summary.low, summary.affectedCount, `${label}: counts add up`);
      assert.ok(summary.analysedFiles >= summary.affectedCount + changed.size, `${label}: analysedFiles`);
      if (summary.incomplete) {
        assert.ok(report.warnings.length > 0, `${label}: incomplete always comes with a warning`);
      }
      assert.equal(new Set(report.warnings).size, report.warnings.length, `${label}: no repeated warnings`);
      assert.deepEqual(affectedPaths(report), [...new Set(affectedPaths(report))], `${label}: no repeated files`);

      for (const file of report.affectedFiles) {
        const where = `${label}: ${file.path}`;
        assert.ok(!changed.has(file.path), `${where}: a changed file is not affected`);
        assert.ok(file.reasons.length >= 1, `${where}: has a reason`);
        assert.ok(file.relationshipPath.length >= 2, `${where}: has a relationship path`);
        assert.ok(changed.has(file.relationshipPath[0] ?? ''), `${where}: path starts at a changed file`);
        assert.equal(file.relationshipPath.at(-1), file.path, `${where}: path ends at the file`);
        assert.ok(['high', 'medium', 'low'].includes(file.confidence), `${where}: confidence`);
        assert.ok(['high', 'medium', 'low'].includes(file.risk), `${where}: risk`);
        assert.ok(file.matchedRule.length > 0, `${where}: matched rule`);
        assert.deepEqual(file.relatedSymbols, [], `${where}: relatedSymbols`);
        assert.ok(!('heuristicScore' in file), `${where}: no heuristic score is produced`);
        if (file.reasons.some((reason) => reason.includes('inferred'))) {
          assert.notEqual(file.confidence, 'high', `${where}: inferred links are never high confidence`);
        }
      }
      for (const candidate of report.testCandidates) {
        assert.equal(candidate.source, 'impact', `${label}: candidate source`);
        assert.ok(candidate.reason.length > 0, `${label}: candidate reason`);
        assert.ok(affectedPaths(report).includes(candidate.path), `${label}: candidate is an affected file`);
      }
    }
  }
});

test('report: deterministic, and the input is not modified', () => {
  for (const fixture of allFixtures) {
    const before = JSON.stringify(fixture);
    assert.deepEqual(reportFor(fixture), reportFor(fixture), fixture.name);
    assert.equal(JSON.stringify(fixture), before, `${fixture.name}: fixture unchanged`);
  }
  const edges = [...miniFlask.context.dependencyEdges];
  const targets = [MINI_FLASK_PATHS.helpers, MINI_FLASK_PATHS.cli];
  assert.deepEqual(
    reportFrom([...edges].reverse(), [...targets].reverse()),
    reportFrom(edges, targets),
    'input order does not change the report',
  );
});
