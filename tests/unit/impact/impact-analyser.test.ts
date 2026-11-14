import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDependencyGraph } from '../../../src/impact/dependency-graph';
import {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_VISITED_FILES,
  findDirectDependants,
  resolveChangedTargets,
  traceImpact,
} from '../../../src/impact/impact-analyser';
import type {
  ImpactTrace,
  TraversalOptions,
  TraversalResult,
} from '../../../src/impact/impact-analyser';
import type { ChangeRequest, DependencyEdge } from '../../../src/shared/contracts';
import {
  BAD_PATHS,
  BASIC_PATHS,
  MINI_FLASK_PATHS,
  allFixtures,
  badPath,
  cycle,
  directImport,
  duplicateEdges,
  edge,
  emptyRepository,
  inferredOnly,
  makeRequest,
  miniFlask,
  miniFlaskProposed,
  singleFile,
  threeHopChain,
  twoHopChain,
  unresolvedImport,
} from '../../fixtures/impact';
import type { ImpactFixture } from '../../fixtures/impact';

const { a: A, b: B, c: C, d: D, guide: GUIDE, testA: TEST_A } = BASIC_PATHS;
const X = 'src/pkg/x.py';

/** Runs both steps the way the analyser will: resolve targets, then find dependants. */
function directFor(fixture: ImpactFixture): ImpactTrace[] {
  const graph = buildDependencyGraph(fixture.context);
  const { targets } = resolveChangedTargets(fixture.request, fixture.proposedFiles);
  return findDirectDependants(graph, targets);
}

function directFrom(edges: DependencyEdge[], targets: string[]): ImpactTrace[] {
  return findDirectDependants(
    buildDependencyGraph({ dependencyEdges: edges, unresolvedImports: [] }),
    targets,
  );
}

function paths(traces: readonly ImpactTrace[]): string[] {
  return traces.map((t) => t.path);
}

/** Checks the invariants every direct trace must satisfy. */
function assertDirectInvariants(traces: readonly ImpactTrace[], targets: readonly string[]): void {
  const changed = new Set(targets);
  assert.deepEqual(paths(traces), [...new Set(paths(traces))].sort(), 'sorted, no repeats');
  for (const trace of traces) {
    assert.ok(!changed.has(trace.path), `${trace.path}: a changed file is never affected`);
    assert.equal(trace.distance, 1, `${trace.path}: direct means one hop`);
    assert.equal(trace.relationshipPath.length, 2, `${trace.path}: path has two files`);
    assert.equal(trace.relationshipPath[1], trace.path, `${trace.path}: path ends at the file`);
    assert.ok(
      changed.has(trace.relationshipPath[0] ?? ''),
      `${trace.path}: path starts at a changed file`,
    );
    assert.equal(trace.pathEdges.length, 1, `${trace.path}: one edge on the path`);
    assert.equal(trace.pathEdges[0]?.from, trace.path);
    assert.equal(trace.pathEdges[0]?.to, trace.relationshipPath[0]);
    assert.equal(trace.pathEvidence, trace.pathEdges[0]?.evidence);
    assert.ok(trace.directLinks.length >= 1, `${trace.path}: at least one direct link`);
    for (const link of trace.directLinks) {
      assert.equal(link.from, trace.path);
      assert.ok(changed.has(link.to), `${trace.path}: every direct link points at a changed file`);
    }
  }
}

// ─────────────────────── resolveChangedTargets ───────────────────────

test('changed targets: the active file is used when nothing is proposed', () => {
  assert.deepEqual(resolveChangedTargets(directImport.request), {
    targets: [A],
    source: 'request',
    warnings: [],
  });
});

test('changed targets: active file and mentions are combined, deduplicated and sorted', () => {
  const request = makeRequest('r1', {
    activeFile: C,
    explicitFileMentions: [B, './src/pkg/a.py', C, 'src\\pkg\\b.py'],
  });
  assert.deepEqual(resolveChangedTargets(request), {
    targets: [A, B, C],
    source: 'request',
    warnings: [],
  });
});

test('changed targets: non-empty proposed files replace the request', () => {
  const P = MINI_FLASK_PATHS;
  assert.deepEqual(
    resolveChangedTargets(miniFlaskProposed.request, miniFlaskProposed.proposedFiles),
    { targets: [P.cli, P.helpers], source: 'proposed_files', warnings: [] },
  );

  const request = makeRequest('r2', { activeFile: A, explicitFileMentions: [B] });
  assert.deepEqual(resolveChangedTargets(request, [C]).targets, [C]);
});

test('changed targets: empty, null or missing proposed files fall back to the request', () => {
  for (const proposed of [[], null, undefined]) {
    assert.deepEqual(resolveChangedTargets(directImport.request, proposed), {
      targets: [A],
      source: 'request',
      warnings: [],
    });
  }
});

test('changed targets: none given returns an empty list and a warning', () => {
  assert.deepEqual(resolveChangedTargets(emptyRepository.request), {
    targets: [],
    source: 'none',
    warnings: [
      'No changed files were given (no proposed files, active file or file mentions); nothing to analyse.',
    ],
  });
});

test('changed targets: a missing request does not crash', () => {
  for (const request of [undefined, null]) {
    const result = resolveChangedTargets(request);
    assert.deepEqual(result.targets, []);
    assert.equal(result.source, 'none');
    assert.equal(result.warnings.length, 1);
  }
  const noMentions = { requestId: 'r3', instruction: 'x', mode: 'agent' } as ChangeRequest;
  assert.deepEqual(resolveChangedTargets(noMentions).targets, []);
});

test('changed targets: bad paths are rejected with a warning and good ones are kept', () => {
  assert.deepEqual(resolveChangedTargets(badPath.request), {
    targets: [A],
    source: 'request',
    warnings: [
      `Ignored changed file "${BAD_PATHS.mentionParent}": paths containing ".." are not allowed.`,
      `Ignored changed file "${BAD_PATHS.mentionAbsolute}": absolute paths are not allowed.`,
    ],
  });
});

test('changed targets: when every path is rejected, the list is empty and says why', () => {
  const request = makeRequest('r4', { explicitFileMentions: ['/etc/hosts', '/etc/hosts', '../x.py'] });
  assert.deepEqual(resolveChangedTargets(request), {
    targets: [],
    source: 'request',
    warnings: [
      'Ignored changed file "../x.py": paths containing ".." are not allowed.',
      'Ignored changed file "/etc/hosts": absolute paths are not allowed.',
      'No valid changed files remain after rejecting bad paths; nothing to analyse.',
    ],
  });
});

test('changed targets: rejected proposed files do not fall back to the request', () => {
  const result = resolveChangedTargets(directImport.request, ['/abs/only.py']);
  assert.deepEqual(result.targets, []);
  assert.equal(result.source, 'proposed_files');
  assert.deepEqual(result.warnings, [
    'Ignored changed file "/abs/only.py": absolute paths are not allowed.',
    'No valid changed files remain after rejecting bad paths; nothing to analyse.',
  ]);
});

test('changed targets: non-string entries are rejected, not thrown on', () => {
  const proposed = [A, 42, null] as unknown as string[];
  const result = resolveChangedTargets(undefined, proposed);
  assert.deepEqual(result.targets, [A]);
  assert.deepEqual(result.warnings, [
    'Ignored changed file "<null>": the path is not a string.',
    'Ignored changed file "<number>": the path is not a string.',
  ]);
});

// ─────────────────────── findDirectDependants ───────────────────────

test('direct: B imports A, so changing A affects B with path [A, B]', () => {
  const bToA: DependencyEdge = { from: B, to: A, kind: 'imports', evidence: 'observed' };
  assert.deepEqual(directFor(directImport), [
    {
      path: B,
      distance: 1,
      relationshipPath: [A, B],
      pathEdges: [bToA],
      pathEvidence: 'observed',
      directLinks: [bToA],
    },
  ]);
});

test('direct: the direction is dependants only, never dependencies', () => {
  // B imports A. Changing B must not report A.
  assert.deepEqual(directFrom([edge(B, A)], [B]), []);
});

test('direct: no targets, an empty graph or an unknown file all give []', () => {
  assert.deepEqual(directFor(emptyRepository), []);
  assert.deepEqual(directFor(singleFile), []);
  assert.deepEqual(directFrom([edge(B, A)], []), []);
  assert.deepEqual(directFrom([edge(B, A)], ['src/pkg/not_in_graph.py']), []);
});

test('direct: a chain stops at one hop', () => {
  assert.deepEqual(paths(directFor(twoHopChain)), [B]);
  assert.deepEqual(paths(directFor(threeHopChain)), [B]);
});

test('direct: in a cycle, the changed file is not reported as affected', () => {
  assert.deepEqual(paths(directFor(cycle)), [B]);
  assert.deepEqual(directFor(cycle)[0]?.relationshipPath, [A, B]);

  const graph = buildDependencyGraph(cycle.context);
  assert.deepEqual(findDirectDependants(graph, [A, B]), [], 'both changed: nothing else is affected');
});

test('direct: duplicate edges report each dependant once', () => {
  const traces = directFor(duplicateEdges);
  assert.deepEqual(paths(traces), [B, C]);
  for (const trace of traces) {
    assert.equal(trace.directLinks.length, 1);
    assert.equal(trace.pathEvidence, 'observed');
  }
});

test('direct: inferred links are found and marked inferred', () => {
  const traces = directFor(inferredOnly);
  assert.deepEqual(paths(traces), [GUIDE, TEST_A]);
  assert.deepEqual(
    traces.map((t) => [t.pathEvidence, t.pathEdges[0]?.kind]),
    [
      ['inferred', 'references'],
      ['inferred', 'tests'],
    ],
  );
});

test('direct: bad paths and unresolved imports do not disturb the good edge', () => {
  assert.deepEqual(paths(directFor(badPath)), [B]);
  assert.deepEqual(paths(directFor(unresolvedImport)), [B]);
});

test('direct: a file linked to two changed files has both links and one path', () => {
  const traces = directFrom([edge(X, B), edge(X, A), edge(C, B)], [A, B]);
  assert.deepEqual(paths(traces), [C, X]);

  const x = traces[1];
  assert.deepEqual(x?.directLinks, [
    { from: X, to: A, kind: 'imports', evidence: 'observed' },
    { from: X, to: B, kind: 'imports', evidence: 'observed' },
  ]);
  assert.deepEqual(x?.relationshipPath, [A, X], 'ties go to the first changed file by path');
  assert.deepEqual(traces[0]?.relationshipPath, [B, C]);
});

test('direct: an observed link is preferred over an inferred one for the path', () => {
  const traces = directFrom([edge(X, A, 'references', 'inferred'), edge(X, B)], [A, B]);
  const x = traces[0];
  assert.deepEqual(x?.relationshipPath, [B, X]);
  assert.equal(x?.pathEvidence, 'observed');
  assert.deepEqual(
    x?.directLinks.map((l) => [l.to, l.evidence]),
    [
      [A, 'inferred'],
      [B, 'observed'],
    ],
    'the inferred link is still recorded',
  );
});

test('direct: two kinds of link to the same changed file are both recorded', () => {
  const traces = directFrom([edge(X, A, 'tests', 'inferred'), edge(X, A, 'imports', 'observed')], [A]);
  assert.equal(traces.length, 1);
  assert.deepEqual(
    traces[0]?.directLinks.map((l) => l.kind),
    ['imports', 'tests'],
  );
  assert.equal(traces[0]?.pathEdges[0]?.kind, 'imports');
  assert.equal(traces[0]?.pathEvidence, 'observed');
});

test('direct: a changed file that depends on another changed file is not affected', () => {
  // B imports A, C imports B, D imports A. A and B are both changed.
  const traces = directFrom([edge(B, A), edge(C, B), edge(D, A)], [A, B]);
  assert.deepEqual(paths(traces), [C, D]);
  assert.deepEqual(traces[0]?.relationshipPath, [B, C]);
  assert.deepEqual(traces[1]?.relationshipPath, [A, D]);
});

test('direct: mini-Flask with helpers.py changed', () => {
  const P = MINI_FLASK_PATHS;
  const traces = directFor(miniFlask);
  assert.deepEqual(
    traces.map((t) => [t.path, t.relationshipPath, t.pathEvidence]),
    [
      [P.app, [P.helpers, P.app], 'observed'],
      [P.testHelpers, [P.helpers, P.testHelpers], 'observed'],
    ],
  );
});

test('direct: mini-Flask with helpers.py and cli.py proposed', () => {
  const P = MINI_FLASK_PATHS;
  const traces = directFor(miniFlaskProposed);
  assert.deepEqual(
    traces.map((t) => [t.path, t.relationshipPath, t.pathEvidence]),
    [
      [P.docsCli, [P.cli, P.docsCli], 'inferred'],
      [P.app, [P.helpers, P.app], 'observed'],
      [P.testCli, [P.cli, P.testCli], 'observed'],
      [P.testHelpers, [P.helpers, P.testHelpers], 'observed'],
    ],
  );
  assert.ok(!paths(traces).includes(P.cli), 'cli.py is changed, so it is not listed as affected');
});

test('direct: invariants hold on every fixture', () => {
  for (const fixture of allFixtures) {
    const { targets } = resolveChangedTargets(fixture.request, fixture.proposedFiles);
    assertDirectInvariants(directFor(fixture), targets);
  }
});

test('direct: deterministic, and independent of edge order and target order', () => {
  const edges = [
    ...miniFlask.context.dependencyEdges,
    edge(X, MINI_FLASK_PATHS.helpers, 'references', 'inferred'),
    edge(X, MINI_FLASK_PATHS.cli),
  ];
  const targets = [MINI_FLASK_PATHS.cli, MINI_FLASK_PATHS.helpers];

  const first = directFrom(edges, targets);
  assert.deepEqual(directFrom(edges, targets), first, 'same input, same output');
  assert.deepEqual(directFrom([...edges].reverse(), targets), first, 'edge order');
  assert.deepEqual(directFrom(edges, [...targets].reverse()), first, 'target order');
  assert.deepEqual(directFrom(edges, [...targets, ...targets]), first, 'repeated targets');
  assertDirectInvariants(first, targets);
});

// ─────────────────────────── traceImpact ───────────────────────────

const Y = 'src/pkg/y.py';
const Z = 'src/pkg/z.py';
const CAP_WARNING = (cap: number): string =>
  `Stopped after reaching the limit of ${cap} affected files; more files may be affected.`;
const ABORT_WARNING = 'Analysis was cancelled before it finished; the results are partial.';

function traceFor(fixture: ImpactFixture, options?: TraversalOptions): TraversalResult {
  const graph = buildDependencyGraph(fixture.context);
  const { targets } = resolveChangedTargets(fixture.request, fixture.proposedFiles);
  return traceImpact(graph, targets, options);
}

function traceFrom(
  edges: DependencyEdge[],
  targets: string[],
  options?: TraversalOptions,
): TraversalResult {
  return traceImpact(
    buildDependencyGraph({ dependencyEdges: edges, unresolvedImports: [] }),
    targets,
    options,
  );
}

/** [path, distance, relationshipPath, pathEvidence] for each trace. */
function outline(result: TraversalResult): unknown[] {
  return result.traces.map((t) => [t.path, t.distance, t.relationshipPath, t.pathEvidence]);
}

/** `count` files that each import A directly, named so they sort by number. */
function star(count: number): DependencyEdge[] {
  return Array.from({ length: count }, (_, i) => edge(starFile(i), A));
}

function starFile(i: number): string {
  return `src/gen/f${String(i).padStart(4, '0')}.py`;
}

/** A stand-in signal that reports "aborted" after it has been checked `checks` times. */
function abortAfter(checks: number): AbortSignal {
  let reads = 0;
  const fake = {
    get aborted(): boolean {
      reads += 1;
      return reads > checks;
    },
  };
  return fake as unknown as AbortSignal;
}

/** Checks the invariants every traversal result must satisfy. */
function assertTraceInvariants(result: TraversalResult, targets: readonly string[]): void {
  const changed = new Set(targets);
  const tracePaths = paths(result.traces);
  assert.deepEqual(tracePaths, [...new Set(tracePaths)].sort(), 'sorted, no repeats');
  assert.ok(result.traces.length <= result.maxVisitedFiles, 'never more files than the cap');
  assert.equal(result.incomplete, result.stoppedBy !== 'completed');

  for (const trace of result.traces) {
    const label = trace.path;
    const route = trace.relationshipPath;
    assert.ok(!changed.has(trace.path), `${label}: a changed file is never affected`);
    assert.ok(trace.distance >= 1 && trace.distance <= result.maxDepth, `${label}: within depth`);
    assert.equal(route.length, trace.distance + 1, `${label}: path length is distance + 1`);
    assert.equal(route.at(-1), trace.path, `${label}: path ends at the file`);
    assert.equal(new Set(route).size, route.length, `${label}: no file repeats on the path`);
    assert.deepEqual(
      route.map((file) => changed.has(file)),
      route.map((_, i) => i === 0),
      `${label}: only the first file on the path is a changed file`,
    );
    assert.equal(trace.pathEdges.length, trace.distance, `${label}: one edge per hop`);
    trace.pathEdges.forEach((pathEdge, i) => {
      assert.equal(pathEdge.to, route[i], `${label}: edge ${i} points back along the path`);
      assert.equal(pathEdge.from, route[i + 1], `${label}: edge ${i} starts at the next file`);
    });
    assert.equal(
      trace.pathEvidence,
      trace.pathEdges.every((e) => e.evidence === 'observed') ? 'observed' : 'inferred',
      `${label}: path evidence matches its edges`,
    );
    for (const link of trace.directLinks) {
      assert.equal(link.from, trace.path);
      assert.ok(changed.has(link.to), `${label}: direct links point at changed files`);
    }
  }
}

test('traversal: the defaults are depth 2 and a cap of 500 files', () => {
  assert.equal(DEFAULT_MAX_DEPTH, 2);
  assert.equal(DEFAULT_MAX_VISITED_FILES, 500);
  const result = traceFor(directImport);
  assert.equal(result.maxDepth, 2);
  assert.equal(result.maxVisitedFiles, 500);
  assert.equal(result.stoppedBy, 'completed');
  assert.equal(result.incomplete, false);
  assert.deepEqual(result.warnings, []);
});

test('traversal: two hops are found at depth 2, with the full path', () => {
  const result = traceFor(twoHopChain);
  assert.deepEqual(outline(result), [
    [B, 1, [A, B], 'observed'],
    [C, 2, [A, B, C], 'observed'],
  ]);
  assert.deepEqual(result.traces[1]?.pathEdges, [
    { from: B, to: A, kind: 'imports', evidence: 'observed' },
    { from: C, to: B, kind: 'imports', evidence: 'observed' },
  ]);
  assert.deepEqual(result.traces[1]?.directLinks, [], 'C has no direct link to A');
  assert.equal(result.incomplete, false);
});

test('traversal: three hops are not found at depth 2', () => {
  const result = traceFor(threeHopChain);
  assert.deepEqual(paths(result.traces), [B, C]);
  assert.ok(!paths(result.traces).includes(D));
  assert.equal(result.incomplete, false, 'stopping at the depth limit is not "incomplete"');
  assert.deepEqual(result.warnings, []);
});

test('traversal: maxDepth is configurable', () => {
  assert.deepEqual(paths(traceFor(threeHopChain, { maxDepth: 1 }).traces), [B]);
  assert.deepEqual(outline(traceFor(threeHopChain, { maxDepth: 3 })), [
    [B, 1, [A, B], 'observed'],
    [C, 2, [A, B, C], 'observed'],
    [D, 3, [A, B, C, D], 'observed'],
  ]);
  assert.deepEqual(paths(traceFor(threeHopChain, { maxDepth: 99 }).traces), [B, C, D]);
});

test('traversal: at depth 1 it agrees exactly with findDirectDependants', () => {
  for (const fixture of allFixtures) {
    const graph = buildDependencyGraph(fixture.context);
    const { targets } = resolveChangedTargets(fixture.request, fixture.proposedFiles);
    assert.deepEqual(
      traceImpact(graph, targets, { maxDepth: 1 }).traces,
      findDirectDependants(graph, targets),
      fixture.name,
    );
  }

  const mixed = [
    edge(X, A, 'references', 'inferred'),
    edge(X, B),
    edge(Y, A, 'tests', 'inferred'),
    edge(Y, A, 'imports', 'observed'),
    edge(Z, B, 'references', 'inferred'),
    edge(Z, A, 'tests', 'inferred'),
    edge(C, B),
    edge(D, C),
  ];
  const graph = buildDependencyGraph({ dependencyEdges: mixed, unresolvedImports: [] });
  assert.deepEqual(
    traceImpact(graph, [A, B], { maxDepth: 1 }).traces,
    findDirectDependants(graph, [A, B]),
  );
});

test('traversal: a cycle terminates and each file appears once', () => {
  assert.deepEqual(outline(traceFor(cycle)), [[B, 1, [A, B], 'observed']]);
  assert.deepEqual(outline(traceFor(cycle, { maxDepth: 50 })), [[B, 1, [A, B], 'observed']]);

  // A ring: B imports A, C imports B, A imports C.
  const ring = [edge(B, A), edge(C, B), edge(A, C)];
  const result = traceFrom(ring, [A], { maxDepth: 50 });
  assert.deepEqual(outline(result), [
    [B, 1, [A, B], 'observed'],
    [C, 2, [A, B, C], 'observed'],
  ]);
  assert.equal(result.incomplete, false);

  assert.deepEqual(traceFrom(ring, [A, B, C], { maxDepth: 50 }).traces, []);
});

test('traversal: the shortest path is used, and ties resolve by path order', () => {
  // X imports A directly and also through B.
  const shortcut = traceFrom([edge(X, B), edge(B, A), edge(X, A)], [A]);
  assert.deepEqual(outline(shortcut), [
    [B, 1, [A, B], 'observed'],
    [X, 1, [A, X], 'observed'],
  ]);

  // D imports B and C; both import A. Two equally short paths.
  const diamond = traceFrom([edge(D, C), edge(D, B), edge(C, A), edge(B, A)], [A]);
  assert.deepEqual(outline(diamond)[2], [D, 2, [A, B, D], 'observed']);
});

test('traversal: an observed path beats a shorter inferred link', () => {
  // X refers to A by inference (one hop), and imports B, which imports A (two hops).
  const edges = [edge(X, A, 'references', 'inferred'), edge(X, B), edge(B, A)];

  const depth2 = traceFrom(edges, [A]);
  assert.deepEqual(outline(depth2), [
    [B, 1, [A, B], 'observed'],
    [X, 2, [A, B, X], 'observed'],
  ]);
  assert.deepEqual(
    depth2.traces[1]?.directLinks,
    [{ from: X, to: A, kind: 'references', evidence: 'inferred' }],
    'the inferred direct link is still recorded',
  );

  // With depth 1 the observed path is out of range, so only the inferred link is left.
  assert.deepEqual(outline(traceFrom(edges, [A], { maxDepth: 1 })), [
    [B, 1, [A, B], 'observed'],
    [X, 1, [A, X], 'inferred'],
  ]);
});

test('traversal: a file reached only through an inferred link is marked inferred', () => {
  // As above, plus Y imports X. Y is three observed hops away, two through the inferred link.
  const edges = [edge(X, A, 'references', 'inferred'), edge(X, B), edge(B, A), edge(Y, X)];
  const result = traceFrom(edges, [A]);
  assert.deepEqual(outline(result), [
    [B, 1, [A, B], 'observed'],
    [X, 2, [A, B, X], 'observed'],
    [Y, 2, [A, X, Y], 'inferred'],
  ]);
  assert.deepEqual(
    result.traces[2]?.pathEdges.map((e) => e.evidence),
    ['inferred', 'observed'],
  );
  assert.deepEqual(outline(traceFor(inferredOnly)), [
    [GUIDE, 1, [A, GUIDE], 'inferred'],
    [TEST_A, 1, [A, TEST_A], 'inferred'],
  ]);
});

test('traversal: with several changed files, each affected file uses the nearest one', () => {
  // D imports C, C imports B, B imports A. A and C are changed.
  const result = traceFrom([edge(B, A), edge(C, B), edge(D, C)], [A, C], { maxDepth: 5 });
  assert.deepEqual(outline(result), [
    [B, 1, [A, B], 'observed'],
    [D, 1, [C, D], 'observed'],
  ]);
});

test('traversal: hitting the cap sets incomplete and adds a warning', () => {
  const result = traceFrom(star(600), [A]);
  assert.equal(result.traces.length, 500);
  assert.equal(result.stoppedBy, 'visit_cap');
  assert.equal(result.incomplete, true);
  assert.deepEqual(result.warnings, [CAP_WARNING(500)]);
  assert.deepEqual(
    paths(result.traces),
    Array.from({ length: 500 }, (_, i) => starFile(i)),
    'the files kept are the first 500 in path order',
  );
});

test('traversal: exactly at the cap is complete; one more is not', () => {
  const atCap = traceFrom(star(500), [A]);
  assert.equal(atCap.traces.length, 500);
  assert.equal(atCap.incomplete, false);
  assert.deepEqual(atCap.warnings, []);

  const overCap = traceFrom(star(501), [A]);
  assert.equal(overCap.traces.length, 500);
  assert.equal(overCap.incomplete, true);
});

test('traversal: the cap is configurable and keeps the nearest files', () => {
  // B and Z import A; C imports B.
  const edges = [edge(C, B), edge(Z, A), edge(B, A)];

  const capped = traceFrom(edges, [A], { maxVisitedFiles: 2 });
  assert.deepEqual(paths(capped.traces), [B, Z], 'both one-hop files are kept; the two-hop file is cut');
  assert.equal(capped.incomplete, true);
  assert.deepEqual(capped.warnings, [CAP_WARNING(2)]);

  const roomy = traceFrom(edges, [A], { maxVisitedFiles: 3 });
  assert.deepEqual(paths(roomy.traces), [B, C, Z]);
  assert.equal(roomy.incomplete, false);
});

test('traversal: under the cap, observed links are kept ahead of inferred ones', () => {
  const edges = [edge(GUIDE, A, 'references', 'inferred'), edge(B, A)];
  const capped = traceFrom(edges, [A], { maxVisitedFiles: 1 });
  assert.deepEqual(outline(capped), [[B, 1, [A, B], 'observed']]);
  assert.equal(capped.stoppedBy, 'visit_cap');

  const roomy = traceFrom(edges, [A], { maxVisitedFiles: 2 });
  assert.deepEqual(paths(roomy.traces), [GUIDE, B]);
  assert.equal(roomy.incomplete, false);
});

test('traversal: a signal aborted before the call stops it immediately', () => {
  const controller = new AbortController();
  controller.abort();
  const result = traceFor(miniFlask, { signal: controller.signal });
  assert.deepEqual(result.traces, []);
  assert.equal(result.stoppedBy, 'aborted');
  assert.equal(result.incomplete, true);
  assert.deepEqual(result.warnings, [ABORT_WARNING]);
});

test('traversal: a signal aborted part-way returns what was found so far', () => {
  // The first check (before expanding A) passes; the second (before expanding B) aborts.
  const result = traceFor(twoHopChain, { signal: abortAfter(1) });
  assert.deepEqual(outline(result), [[B, 1, [A, B], 'observed']]);
  assert.equal(result.stoppedBy, 'aborted');
  assert.equal(result.incomplete, true);
  assert.deepEqual(result.warnings, [ABORT_WARNING]);
  assertTraceInvariants(result, [A]);
});

test('traversal: a signal that is never aborted changes nothing', () => {
  const controller = new AbortController();
  assert.deepEqual(traceFor(miniFlask, { signal: controller.signal }), traceFor(miniFlask));
});

test('traversal: invalid limits fall back to the defaults with a warning', () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = traceFor(twoHopChain, { maxDepth: bad });
    assert.equal(result.maxDepth, 2);
    assert.deepEqual(result.warnings, [`Invalid maxDepth (${String(bad)}); using the default of 2.`]);
    assert.deepEqual(paths(result.traces), [B, C]);
    assert.equal(result.incomplete, false);
  }
  const result = traceFor(twoHopChain, { maxVisitedFiles: 0 });
  assert.equal(result.maxVisitedFiles, 500);
  assert.deepEqual(result.warnings, ['Invalid maxVisitedFiles (0); using the default of 500.']);
});

test('traversal: no changed files gives no traces', () => {
  const result = traceFor(emptyRepository);
  assert.deepEqual(result.traces, []);
  assert.equal(result.incomplete, false);
  assert.deepEqual(traceFor(singleFile).traces, []);
});

test('traversal: mini-Flask with helpers.py changed, at depth 2 and depth 3', () => {
  const P = MINI_FLASK_PATHS;
  assert.deepEqual(outline(traceFor(miniFlask)), [
    [P.app, 1, [P.helpers, P.app], 'observed'],
    [P.cli, 2, [P.helpers, P.app, P.cli], 'observed'],
    [P.testHelpers, 1, [P.helpers, P.testHelpers], 'observed'],
  ]);
  assert.deepEqual(outline(traceFor(miniFlask, { maxDepth: 3 })), [
    [P.docsCli, 3, [P.helpers, P.app, P.cli, P.docsCli], 'inferred'],
    [P.app, 1, [P.helpers, P.app], 'observed'],
    [P.cli, 2, [P.helpers, P.app, P.cli], 'observed'],
    [P.testCli, 3, [P.helpers, P.app, P.cli, P.testCli], 'observed'],
    [P.testHelpers, 1, [P.helpers, P.testHelpers], 'observed'],
  ]);
});

test('traversal: mini-Flask with helpers.py and cli.py proposed', () => {
  const P = MINI_FLASK_PATHS;
  assert.deepEqual(outline(traceFor(miniFlaskProposed)), [
    [P.docsCli, 1, [P.cli, P.docsCli], 'inferred'],
    [P.app, 1, [P.helpers, P.app], 'observed'],
    [P.testCli, 1, [P.cli, P.testCli], 'observed'],
    [P.testHelpers, 1, [P.helpers, P.testHelpers], 'observed'],
  ]);
});

test('traversal: invariants hold on every fixture at depths 1 to 4', () => {
  for (const fixture of allFixtures) {
    const { targets } = resolveChangedTargets(fixture.request, fixture.proposedFiles);
    for (const maxDepth of [1, 2, 3, 4]) {
      assertTraceInvariants(traceFor(fixture, { maxDepth }), targets);
    }
  }
});

test('traversal: deterministic, and independent of edge order and target order', () => {
  const edges = [
    ...miniFlask.context.dependencyEdges,
    edge(X, MINI_FLASK_PATHS.helpers, 'references', 'inferred'),
    edge(X, MINI_FLASK_PATHS.app),
    edge(Y, X),
    edge(Z, MINI_FLASK_PATHS.testHelpers, 'tests', 'inferred'),
    edge(Z, MINI_FLASK_PATHS.cli),
    edge(MINI_FLASK_PATHS.helpers, Y),
  ];
  const targets = [MINI_FLASK_PATHS.helpers, MINI_FLASK_PATHS.docsCli];
  const options = { maxDepth: 3 };

  const first = traceFrom(edges, targets, options);
  assert.ok(first.traces.length > 0);
  assert.deepEqual(traceFrom(edges, targets, options), first, 'same input, same output');
  assert.deepEqual(traceFrom([...edges].reverse(), targets, options), first, 'edge order');
  assert.deepEqual(traceFrom(edges, [...targets].reverse(), options), first, 'target order');
  assert.deepEqual(traceFrom(edges, [...targets, ...targets], options), first, 'repeated targets');
  assertTraceInvariants(first, targets);
});
