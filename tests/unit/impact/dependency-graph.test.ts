import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_GRAPH_CACHE_SIZE,
  MAX_DETAILED_WARNINGS,
  buildDependencyGraph,
  createGraphCache,
  dependantEdgesOf,
  dependencyEdgesOf,
  graphCacheKey,
  normalisePath,
} from '../../../src/impact/dependency-graph';
import type { DependencyGraph } from '../../../src/impact/dependency-graph';
import type { DependencyEdge, UnresolvedImport } from '../../../src/shared/contracts';
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
  miniFlask,
  singleFile,
  unresolvedImport,
} from '../../fixtures/impact';

const { a: A, b: B, c: C, d: D } = BASIC_PATHS;

/** A graph as plain data, so two graphs can be compared with deepEqual. */
function snapshot(graph: DependencyGraph): Record<string, unknown> {
  return {
    files: graph.files,
    edges: graph.edges,
    forward: [...graph.forward],
    reverse: [...graph.reverse],
    unresolvedImports: graph.unresolvedImports,
    rejectedPaths: graph.rejectedPaths,
    warnings: graph.warnings,
    droppedInput: graph.droppedInput,
  };
}

function froms(edges: readonly DependencyEdge[]): string[] {
  return edges.map((e) => e.from);
}

function tos(edges: readonly DependencyEdge[]): string[] {
  return edges.map((e) => e.to);
}

/** Passes deliberately malformed data through the typed parameter. */
function asEdges(values: readonly unknown[]): DependencyEdge[] {
  return values as DependencyEdge[];
}

function asUnresolved(values: readonly unknown[]): UnresolvedImport[] {
  return values as UnresolvedImport[];
}

// ───────────────────────── normalisePath ─────────────────────────

test('normalisePath: a clean path is unchanged', () => {
  assert.deepEqual(normalisePath('src/flask/cli.py'), { ok: true, path: 'src/flask/cli.py' });
  assert.deepEqual(normalisePath('setup.py'), { ok: true, path: 'setup.py' });
});

test('normalisePath: tidies leading "./", backslashes, repeated slashes and "." segments', () => {
  const cases: Array<[string, string]> = [
    ['./src/pkg/a.py', 'src/pkg/a.py'],
    ['././src/pkg/a.py', 'src/pkg/a.py'],
    ['src\\pkg\\a.py', 'src/pkg/a.py'],
    ['.\\src\\pkg\\a.py', 'src/pkg/a.py'],
    ['src//pkg///a.py', 'src/pkg/a.py'],
    ['src/./pkg/a.py', 'src/pkg/a.py'],
    ['src/pkg/', 'src/pkg'],
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(normalisePath(input), { ok: true, path: expected }, input);
  }
});

test('normalisePath: keeps case and dots that are not path segments', () => {
  assert.deepEqual(normalisePath('Src/Pkg/A.py'), { ok: true, path: 'Src/Pkg/A.py' });
  assert.deepEqual(normalisePath('.editorconfig'), { ok: true, path: '.editorconfig' });
  assert.deepEqual(normalisePath('src/..hidden/a..b.py'), { ok: true, path: 'src/..hidden/a..b.py' });
});

test('normalisePath: rejects .git, node_modules and .env paths', () => {
  const restricted = [
    '.git/config',
    'src/.git/hooks/pre-commit',
    'node_modules/pkg/index.js',
    'packages/web/node_modules/pkg/index.js',
    '.env',
    'config/.env',
    '.env.local',
    'config/.env.production',
    '.env/lib/site.py',
    '.GIT/config',
    'Node_Modules/pkg/index.js',
    './node_modules\\pkg\\index.js',
  ];
  for (const input of restricted) {
    assert.deepEqual(normalisePath(input), { ok: false, reason: 'restricted' }, input);
  }
});

test('normalisePath: names that only look like restricted ones are accepted', () => {
  const allowed = [
    '.github/workflows/ci.yml',
    '.gitignore',
    'src/git/config.py',
    'src/node_modules_shim.py',
    'src/env.py',
    'docs/.envrc',
    'src/my.env.py',
  ];
  for (const input of allowed) {
    assert.deepEqual(normalisePath(input), { ok: true, path: input }, input);
  }
});

test('bad paths: edges into .git, node_modules or .env are ignored with a warning', () => {
  const graph = buildDependencyGraph({
    dependencyEdges: [
      edge(B, A),
      edge(B, 'node_modules/requests/index.js'),
      edge('.git/hooks/pre-commit', A),
      edge(C, '.env'),
    ],
    unresolvedImports: [],
  });
  assert.deepEqual(graph.files, [A, B]);
  assert.deepEqual(graph.edges, [{ from: B, to: A, kind: 'imports', evidence: 'observed' }]);
  const why = 'paths in .git or node_modules, and .env files, are not allowed.';
  assert.deepEqual(graph.warnings, [
    `Ignored 1 dependency edge with path ".env": ${why}`,
    `Ignored 1 dependency edge with path ".git/hooks/pre-commit": ${why}`,
    `Ignored 1 dependency edge with path "node_modules/requests/index.js": ${why}`,
  ]);
});

test('normalisePath: rejects absolute paths', () => {
  for (const input of ['/etc/hosts', 'C:\\Users\\x\\a.py', 'c:/Users/x/a.py', '\\\\server\\share\\a.py']) {
    assert.deepEqual(normalisePath(input), { ok: false, reason: 'absolute' }, input);
  }
});

test('normalisePath: rejects any ".." segment', () => {
  for (const input of ['../a.py', 'src/../a.py', 'src/pkg/..', 'src\\..\\a.py', './../a.py']) {
    assert.deepEqual(normalisePath(input), { ok: false, reason: 'parent_segment' }, input);
  }
});

test('normalisePath: rejects empty paths and non-strings', () => {
  for (const input of ['', '   ', '.', './', '.\\']) {
    assert.deepEqual(normalisePath(input), { ok: false, reason: 'empty' }, JSON.stringify(input));
  }
  for (const input of [undefined, null, 42, {}, ['src/a.py']]) {
    assert.deepEqual(normalisePath(input), { ok: false, reason: 'not_a_string' });
  }
});

// ─────────────────────── buildDependencyGraph ───────────────────────

test('empty graph: an empty repository gives an empty graph with no warnings', () => {
  const graph = buildDependencyGraph(emptyRepository.context);
  assert.deepEqual(snapshot(graph), {
    files: [],
    edges: [],
    forward: [],
    reverse: [],
    unresolvedImports: [],
    rejectedPaths: [],
    warnings: [],
    droppedInput: false,
  });
});

test('droppedInput: true only when part of the input was ignored', () => {
  const dropped = (source: Parameters<typeof buildDependencyGraph>[0]): boolean =>
    buildDependencyGraph(source).droppedInput;

  assert.equal(dropped(miniFlask.context), false);
  assert.equal(dropped(duplicateEdges.context), false, 'duplicates are merged, not dropped');
  assert.equal(dropped(unresolvedImport.context), false, 'unresolved imports are kept aside');
  assert.equal(
    dropped({ dependencyEdges: [edge(A, A)], unresolvedImports: [] }),
    false,
    'a self edge carries no information',
  );

  assert.equal(dropped(badPath.context), true, 'rejected paths');
  assert.equal(dropped(undefined), true, 'missing context');
  assert.equal(dropped({}), true, 'missing lists');
  assert.equal(dropped({ dependencyEdges: asEdges([null]), unresolvedImports: [] }), true, 'malformed edge');
  assert.equal(
    dropped({ dependencyEdges: [], unresolvedImports: asUnresolved([{ file: A }]) }),
    true,
    'malformed unresolved import',
  );
});

test('empty graph: a file with no edges is not in the graph, and lookups return []', () => {
  const graph = buildDependencyGraph(singleFile.context);
  assert.deepEqual(graph.files, []);
  assert.deepEqual(dependantEdgesOf(graph, A), []);
  assert.deepEqual(dependencyEdgesOf(graph, A), []);
});

test('missing input: no context, or missing lists, gives an empty graph and a warning', () => {
  for (const source of [undefined, null]) {
    const graph = buildDependencyGraph(source);
    assert.deepEqual(graph.files, []);
    assert.deepEqual(graph.edges, []);
    assert.deepEqual(graph.warnings, ['Repository context is missing; the dependency graph is empty.']);
  }

  const noLists = buildDependencyGraph({});
  assert.deepEqual(noLists.edges, []);
  assert.deepEqual(noLists.warnings, [
    'dependencyEdges is missing or not a list; treated as empty.',
    'unresolvedImports is missing or not a list; treated as empty.',
  ]);

  const nullLists = buildDependencyGraph({ dependencyEdges: null, unresolvedImports: null });
  assert.deepEqual(nullLists.warnings, noLists.warnings);
});

test('direct import: forward and reverse maps answer both questions', () => {
  const graph = buildDependencyGraph(directImport.context);
  const bToA: DependencyEdge = { from: B, to: A, kind: 'imports', evidence: 'observed' };

  assert.deepEqual(graph.files, [A, B]);
  assert.deepEqual(graph.edges, [bToA]);
  assert.deepEqual(dependantEdgesOf(graph, A), [bToA], 'who depends on A');
  assert.deepEqual(dependencyEdgesOf(graph, B), [bToA], 'what B depends on');
  assert.deepEqual(dependantEdgesOf(graph, B), [], 'nothing depends on B');
  assert.deepEqual(dependencyEdgesOf(graph, A), [], 'A depends on nothing');
  assert.deepEqual(graph.warnings, []);
});

test('every file in the graph has an entry in both maps', () => {
  const graph = buildDependencyGraph(miniFlask.context);
  assert.deepEqual([...graph.forward.keys()], graph.files);
  assert.deepEqual([...graph.reverse.keys()], graph.files);
});

test('duplicates: exact repeats collapse to one edge', () => {
  const graph = buildDependencyGraph({
    dependencyEdges: [edge(B, A), edge(B, A), edge(B, A)],
    unresolvedImports: [],
  });
  assert.deepEqual(graph.edges, [{ from: B, to: A, kind: 'imports', evidence: 'observed' }]);
  assert.deepEqual(froms(dependantEdgesOf(graph, A)), [B]);
});

test('duplicates: the fixture collapses to two edges, and observed beats inferred', () => {
  const graph = buildDependencyGraph(duplicateEdges.context);
  assert.deepEqual(graph.edges, [
    { from: B, to: A, kind: 'imports', evidence: 'observed' },
    { from: C, to: A, kind: 'imports', evidence: 'observed' },
  ]);
  assert.deepEqual(graph.warnings, []);
});

test('duplicates: observed beats inferred whichever comes first', () => {
  const inferredFirst = buildDependencyGraph({
    dependencyEdges: [edge(B, A, 'imports', 'inferred'), edge(B, A, 'imports', 'observed')],
    unresolvedImports: [],
  });
  const observedFirst = buildDependencyGraph({
    dependencyEdges: [edge(B, A, 'imports', 'observed'), edge(B, A, 'imports', 'inferred')],
    unresolvedImports: [],
  });
  assert.equal(inferredFirst.edges[0]?.evidence, 'observed');
  assert.deepEqual(snapshot(inferredFirst), snapshot(observedFirst));
});

test('duplicates: two inferred copies stay inferred', () => {
  const graph = buildDependencyGraph({
    dependencyEdges: [edge(B, A, 'imports', 'inferred'), edge(B, A, 'imports', 'inferred')],
    unresolvedImports: [],
  });
  assert.deepEqual(graph.edges, [{ from: B, to: A, kind: 'imports', evidence: 'inferred' }]);
});

test('duplicates: different kinds between the same two files are separate edges', () => {
  const graph = buildDependencyGraph({
    dependencyEdges: [edge(B, A, 'tests', 'inferred'), edge(B, A, 'imports', 'observed')],
    unresolvedImports: [],
  });
  assert.deepEqual(graph.edges, [
    { from: B, to: A, kind: 'imports', evidence: 'observed' },
    { from: B, to: A, kind: 'tests', evidence: 'inferred' },
  ]);
});

test('duplicates: paths that normalise to the same file are the same edge', () => {
  const graph = buildDependencyGraph({
    dependencyEdges: [
      edge('./src/pkg/b.py', 'src/pkg/a.py'),
      edge('src\\pkg\\b.py', './src/pkg/a.py'),
      edge('src//pkg/b.py', 'src/./pkg/a.py'),
    ],
    unresolvedImports: [],
  });
  assert.deepEqual(graph.files, [A, B]);
  assert.deepEqual(graph.edges, [{ from: B, to: A, kind: 'imports', evidence: 'observed' }]);
  assert.deepEqual(graph.warnings, []);
});

test('cycle: both directions are kept and each file depends on the other', () => {
  const graph = buildDependencyGraph(cycle.context);
  assert.deepEqual(graph.files, [A, B]);
  assert.equal(graph.edges.length, 2);
  assert.deepEqual(froms(dependantEdgesOf(graph, A)), [B]);
  assert.deepEqual(froms(dependantEdgesOf(graph, B)), [A]);
  assert.deepEqual(tos(dependencyEdgesOf(graph, A)), [B]);
  assert.deepEqual(tos(dependencyEdgesOf(graph, B)), [A]);
  assert.deepEqual(graph.warnings, []);
});

test('self edge: a file depending on itself is ignored with a warning', () => {
  const graph = buildDependencyGraph({
    dependencyEdges: [edge(A, A), edge('./src/pkg/a.py', A), edge(B, A)],
    unresolvedImports: [],
  });
  assert.deepEqual(graph.edges, [{ from: B, to: A, kind: 'imports', evidence: 'observed' }]);
  assert.deepEqual(graph.warnings, ['Ignored 2 dependency edges from a file to itself.']);
});

test('unresolved imports: kept aside and reported, one warning per file', () => {
  const graph = buildDependencyGraph(unresolvedImport.context);
  assert.deepEqual(graph.edges, [{ from: B, to: A, kind: 'imports', evidence: 'observed' }]);
  assert.deepEqual(graph.files, [A, B], 'C has no resolved edge, so it is not a graph file');
  assert.deepEqual(graph.unresolvedImports, [
    { file: B, module: 'requests' },
    { file: C, module: 'pkg.missing_module' },
  ]);
  assert.deepEqual(graph.warnings, [
    `Unresolved import in ${B}: requests (impact through it is not analysed).`,
    `Unresolved import in ${C}: pkg.missing_module (impact through it is not analysed).`,
  ]);
});

test('unresolved imports: normalised, deduplicated, sorted and grouped by file', () => {
  const graph = buildDependencyGraph({
    dependencyEdges: [],
    unresolvedImports: [
      { file: './src/pkg/b.py', module: 'yaml' },
      { file: 'src/pkg/b.py', module: 'requests' },
      { file: 'src\\pkg\\b.py', module: 'yaml' },
      { file: A, module: 'attr' },
    ],
  });
  assert.deepEqual(graph.unresolvedImports, [
    { file: A, module: 'attr' },
    { file: B, module: 'requests' },
    { file: B, module: 'yaml' },
  ]);
  assert.deepEqual(graph.warnings, [
    `Unresolved import in ${A}: attr (impact through it is not analysed).`,
    `Unresolved imports in ${B}: requests, yaml (impact through them is not analysed).`,
  ]);
});

test('unresolved imports: a bad file path or a missing module is ignored with a warning', () => {
  const graph = buildDependencyGraph({
    dependencyEdges: [],
    unresolvedImports: asUnresolved([
      { file: '../outside/x.py', module: 'os' },
      { file: A, module: '' },
      { file: A },
      null,
      { file: B, module: 'requests' },
    ]),
  });
  assert.deepEqual(graph.unresolvedImports, [{ file: B, module: 'requests' }]);
  assert.deepEqual(graph.rejectedPaths, [
    { path: '../outside/x.py', reason: 'parent_segment', source: 'unresolved_import', occurrences: 1 },
  ]);
  assert.deepEqual(graph.warnings, [
    'Ignored 1 unresolved import with path "../outside/x.py": paths containing ".." are not allowed.',
    'Ignored 3 malformed unresolved imports (not an object, or no module name).',
    `Unresolved import in ${B}: requests (impact through it is not analysed).`,
  ]);
});

test('bad paths: rejected with warnings, and the good edge survives', () => {
  const graph = buildDependencyGraph(badPath.context);

  assert.deepEqual(graph.files, [A, B]);
  assert.deepEqual(graph.edges, [{ from: B, to: A, kind: 'imports', evidence: 'observed' }]);
  assert.deepEqual(graph.rejectedPaths, [
    { path: BAD_PATHS.parentLeading, reason: 'parent_segment', source: 'dependency_edge', occurrences: 1 },
    { path: BAD_PATHS.absolutePosix, reason: 'absolute', source: 'dependency_edge', occurrences: 1 },
    { path: BAD_PATHS.absoluteWindows, reason: 'absolute', source: 'dependency_edge', occurrences: 1 },
    { path: BAD_PATHS.parentInside, reason: 'parent_segment', source: 'dependency_edge', occurrences: 1 },
  ]);
  assert.deepEqual(graph.warnings, [
    'Ignored 1 dependency edge with path "../outside/lib.py": paths containing ".." are not allowed.',
    'Ignored 1 dependency edge with path "/abs/elsewhere/c.py": absolute paths are not allowed.',
    'Ignored 1 dependency edge with path "C:\\Users\\someone\\d.py": absolute paths are not allowed.',
    'Ignored 1 dependency edge with path "src/pkg/../../escape.py": paths containing ".." are not allowed.',
  ]);

  const allPaths = [...graph.files, ...graph.edges.flatMap((e) => [e.from, e.to])];
  for (const path of allPaths) {
    assert.ok(!path.startsWith('/') && !path.includes('..') && !path.includes('\\'), path);
  }
});

test('bad paths: the same bad path on several edges is one warning with a count', () => {
  const graph = buildDependencyGraph({
    dependencyEdges: [edge('/abs/x.py', A), edge('/abs/x.py', B), edge(C, '/abs/x.py')],
    unresolvedImports: [],
  });
  assert.deepEqual(graph.edges, []);
  assert.deepEqual(graph.rejectedPaths, [
    { path: '/abs/x.py', reason: 'absolute', source: 'dependency_edge', occurrences: 3 },
  ]);
  assert.deepEqual(graph.warnings, [
    'Ignored 3 dependency edges with path "/abs/x.py": absolute paths are not allowed.',
  ]);
});

test('bad edges: malformed entries produce a warning, never a crash', () => {
  const graph = buildDependencyGraph({
    dependencyEdges: asEdges([
      null,
      42,
      'src/pkg/a.py',
      { from: B, to: A },
      { from: B, to: A, kind: 'bogus', evidence: 'observed' },
      { from: B, to: A, kind: 'imports', evidence: 'certain' },
      { from: 7, to: A, kind: 'imports', evidence: 'observed' },
      { from: C, to: A, kind: 'imports', evidence: 'observed' },
    ]),
    unresolvedImports: [],
  });
  assert.deepEqual(graph.edges, [{ from: C, to: A, kind: 'imports', evidence: 'observed' }]);
  assert.deepEqual(graph.warnings, [
    'Ignored 1 dependency edge with path "<number>": the path is not a string.',
    'Ignored 6 malformed dependency edges (not an object, or an invalid kind or evidence).',
  ]);
});

test('warnings: long lists are capped and the remainder is counted', () => {
  const extra = 3;
  const total = MAX_DETAILED_WARNINGS + extra;
  const pad = (i: number): string => String(i).padStart(2, '0');

  const graph = buildDependencyGraph({
    dependencyEdges: Array.from({ length: total }, (_, i) => edge(`/abs/f${pad(i)}.py`, A)),
    unresolvedImports: Array.from({ length: MAX_DETAILED_WARNINGS + 1 }, (_, i) => ({
      file: `src/pkg/m${pad(i)}.py`,
      module: 'requests',
    })),
  });

  assert.equal(graph.rejectedPaths.length, total, 'the structured list is never capped');
  assert.equal(graph.unresolvedImports.length, MAX_DETAILED_WARNINGS + 1);
  assert.equal(graph.warnings.length, 2 * (MAX_DETAILED_WARNINGS + 1));
  assert.equal(
    graph.warnings[MAX_DETAILED_WARNINGS],
    `${extra} more rejected dependency edge paths not listed.`,
  );
  assert.equal(graph.warnings.at(-1), '1 more file with unresolved imports not listed.');
});

test('inferred-only: evidence and kind are carried through unchanged', () => {
  const graph = buildDependencyGraph(inferredOnly.context);
  assert.deepEqual(dependantEdgesOf(graph, A), [
    { from: BASIC_PATHS.guide, to: A, kind: 'references', evidence: 'inferred' },
    { from: BASIC_PATHS.testA, to: A, kind: 'tests', evidence: 'inferred' },
  ]);
});

test('mini-Flask: the reverse map lists dependants in sorted order', () => {
  const P = MINI_FLASK_PATHS;
  const graph = buildDependencyGraph(miniFlask.context);

  assert.deepEqual(graph.files, [P.docsCli, P.app, P.cli, P.helpers, P.testCli, P.testHelpers]);
  assert.equal(graph.edges.length, 5);
  assert.deepEqual(froms(dependantEdgesOf(graph, P.helpers)), [P.app, P.testHelpers]);
  assert.deepEqual(froms(dependantEdgesOf(graph, P.app)), [P.cli]);
  assert.deepEqual(dependantEdgesOf(graph, P.cli), [
    { from: P.docsCli, to: P.cli, kind: 'references', evidence: 'inferred' },
    { from: P.testCli, to: P.cli, kind: 'imports', evidence: 'observed' },
  ]);
  assert.deepEqual(tos(dependencyEdgesOf(graph, P.cli)), [P.app]);
  assert.deepEqual(dependantEdgesOf(graph, P.testCli), []);
  assert.deepEqual(graph.warnings, []);
});

test('deterministic: the same input gives the same graph every time', () => {
  for (const fixture of allFixtures) {
    assert.deepEqual(
      snapshot(buildDependencyGraph(fixture.context)),
      snapshot(buildDependencyGraph(fixture.context)),
      fixture.name,
    );
  }
});

test('deterministic: input order does not change the graph', () => {
  const edges: DependencyEdge[] = [
    ...miniFlask.context.dependencyEdges,
    edge(D, C),
    edge(C, B, 'references', 'inferred'),
    edge(C, B, 'imports'),
    edge(B, A),
    edge(B, A),
    edge('/abs/z.py', A),
    edge('../y.py', A),
    edge(A, A),
  ];
  const unresolved: UnresolvedImport[] = [
    { file: C, module: 'zlib_extra' },
    { file: B, module: 'requests' },
    { file: C, module: 'attr' },
  ];
  const rotated = [...edges.slice(4), ...edges.slice(0, 4)];

  const original = snapshot(buildDependencyGraph({ dependencyEdges: edges, unresolvedImports: unresolved }));
  const reversed = snapshot(
    buildDependencyGraph({
      dependencyEdges: [...edges].reverse(),
      unresolvedImports: [...unresolved].reverse(),
    }),
  );
  const shifted = snapshot(buildDependencyGraph({ dependencyEdges: rotated, unresolvedImports: unresolved }));

  assert.deepEqual(reversed, original);
  assert.deepEqual(shifted, original);
});

// ───────────────────────────── Cache ─────────────────────────────

/** A fresh copy of a context's lists, so only the content can match, not the objects. */
function copyOf(source: {
  dependencyEdges: readonly DependencyEdge[];
  unresolvedImports: readonly UnresolvedImport[];
}): { dependencyEdges: DependencyEdge[]; unresolvedImports: UnresolvedImport[] } {
  return {
    dependencyEdges: source.dependencyEdges.map((e) => ({ ...e })),
    unresolvedImports: source.unresolvedImports.map((u) => ({ ...u })),
  };
}

test('cache: a repeated call returns the same graph without rebuilding', () => {
  const cache = createGraphCache();
  const first = cache.get(miniFlask.context);
  const second = cache.get(miniFlask.context);

  assert.equal(second, first, 'the very same graph object');
  assert.deepEqual(cache.stats(), { hits: 1, misses: 1 });
  assert.equal(cache.size, 1);
  assert.deepEqual(snapshot(first), snapshot(buildDependencyGraph(miniFlask.context)));
});

test('cache: the key is the edge set, so equal content in any order is a hit', () => {
  const cache = createGraphCache();
  const first = cache.get(unresolvedImport.context);

  const copy = copyOf(unresolvedImport.context);
  assert.equal(cache.get(copy), first, 'a different object with equal content');

  const shuffled = copyOf(miniFlask.context);
  const original = cache.get(miniFlask.context);
  shuffled.dependencyEdges.reverse();
  assert.equal(cache.get(shuffled), original, 'the same edges in another order');

  assert.deepEqual(cache.stats(), { hits: 2, misses: 2 });
  assert.equal(
    graphCacheKey(shuffled),
    graphCacheKey(miniFlask.context),
    'order does not change the key',
  );
});

test('cache: any difference in the edges or unresolved imports is a miss, never a stale graph', () => {
  const base = copyOf(directImport.context);
  const variants = [
    { ...base, dependencyEdges: [...base.dependencyEdges, edge(C, A)] },
    { ...base, dependencyEdges: [edge(B, A, 'imports', 'inferred')] },
    { ...base, dependencyEdges: [edge(B, A, 'references', 'observed')] },
    { ...base, dependencyEdges: [edge(A, B)] },
    { ...base, dependencyEdges: [] },
    { ...base, unresolvedImports: [{ file: B, module: 'requests' }] },
  ];

  const cache = createGraphCache(20);
  cache.get(base);
  for (const variant of variants) {
    assert.notEqual(graphCacheKey(variant), graphCacheKey(base));
    assert.deepEqual(snapshot(cache.get(variant)), snapshot(buildDependencyGraph(variant)));
  }
  assert.deepEqual(cache.stats(), { hits: 0, misses: variants.length + 1 });
});

test('cache: a cached graph always equals a freshly built one, on every fixture', () => {
  const cache = createGraphCache(allFixtures.length);
  for (const pass of [1, 2]) {
    for (const fixture of allFixtures) {
      assert.deepEqual(
        snapshot(cache.get(fixture.context)),
        snapshot(buildDependencyGraph(fixture.context)),
        `${fixture.name}, pass ${pass}`,
      );
    }
  }
  assert.ok(cache.stats().hits >= allFixtures.length, 'the second pass was served from the cache');
});

test('cache: malformed entries that produce different warnings have different keys', () => {
  const withNull = { dependencyEdges: asEdges([{ from: null, to: A, kind: 'imports', evidence: 'observed' }]), unresolvedImports: [] };
  const withNumber = { dependencyEdges: asEdges([{ from: 7, to: A, kind: 'imports', evidence: 'observed' }]), unresolvedImports: [] };
  const withText = { dependencyEdges: asEdges([{ from: '<number>', to: A, kind: 'imports', evidence: 'observed' }]), unresolvedImports: [] };

  const cache = createGraphCache();
  assert.deepEqual(cache.get(withNull).warnings, [
    'Ignored 1 dependency edge with path "<null>": the path is not a string.',
  ]);
  assert.deepEqual(cache.get(withNumber).warnings, [
    'Ignored 1 dependency edge with path "<number>": the path is not a string.',
  ]);
  assert.deepEqual(cache.get(withText).warnings, []);
  assert.deepEqual(cache.get(withText).files, ['<number>', A]);
  assert.equal(cache.size, 3);
});

test('cache: a source with a missing list is built every time and not stored', () => {
  const cache = createGraphCache();
  for (const source of [undefined, null, {}, { dependencyEdges: [] }]) {
    assert.equal(graphCacheKey(source), undefined);
    assert.deepEqual(snapshot(cache.get(source)), snapshot(buildDependencyGraph(source)));
  }
  assert.equal(cache.size, 0);
  assert.deepEqual(cache.stats(), { hits: 0, misses: 4 });
});

test('cache: when full, the least recently used graph is dropped', () => {
  const cache = createGraphCache(2);
  const first = cache.get(directImport.context);
  cache.get(cycle.context);
  assert.equal(cache.get(directImport.context), first, 'still cached, and now most recently used');

  cache.get(miniFlask.context);
  assert.equal(cache.size, 2);
  assert.equal(cache.get(directImport.context), first, 'the recently used graph survived');
  assert.deepEqual(cache.stats(), { hits: 2, misses: 3 });

  cache.get(cycle.context);
  assert.deepEqual(cache.stats(), { hits: 2, misses: 4 }, 'the least recently used graph was rebuilt');
});

test('cache: an invalid size falls back to the default', () => {
  for (const size of [0, -1, 1.5, Number.NaN]) {
    const cache = createGraphCache(size);
    for (const fixture of allFixtures) {
      cache.get(fixture.context);
    }
    assert.equal(cache.size, DEFAULT_GRAPH_CACHE_SIZE, String(size));
  }
});

test('invalidate: drops only the graphs that contain one of the paths', () => {
  const cache = createGraphCache();
  cache.get(miniFlask.context);
  cache.get(directImport.context);
  cache.get(unresolvedImport.context);
  assert.equal(cache.size, 3);

  assert.equal(cache.invalidate(['src/not/in/any/graph.py']), 0);
  assert.equal(cache.size, 3);

  assert.equal(cache.invalidate([MINI_FLASK_PATHS.cli]), 1, 'only the mini-Flask graph has cli.py');
  assert.equal(cache.size, 2);

  // C appears only as the importer of an unresolved import.
  assert.equal(cache.invalidate([C]), 1);
  assert.equal(cache.size, 1);

  assert.equal(cache.invalidate([A, B]), 1, 'one graph matches both paths and is counted once');
  assert.equal(cache.size, 0);
});

test('invalidate: paths are normalised, bad paths are ignored, and no argument clears everything', () => {
  const cache = createGraphCache();
  cache.get(miniFlask.context);
  cache.get(directImport.context);

  assert.equal(cache.invalidate([]), 0, 'an empty list changes nothing');
  assert.equal(cache.invalidate(['/etc/hosts', '../x.py', 42 as unknown as string]), 0);
  assert.equal(cache.invalidate(['.\\src\\flask\\helpers.py']), 1, 'normalised before matching');
  assert.equal(cache.size, 1);

  assert.equal(cache.invalidate(), 1);
  assert.equal(cache.size, 0);
  assert.equal(cache.invalidate(), 0);
});

test('invalidate: the next call rebuilds and gives the same graph', () => {
  const cache = createGraphCache();
  const before = cache.get(miniFlask.context);
  cache.invalidate([MINI_FLASK_PATHS.helpers]);
  const after = cache.get(miniFlask.context);

  assert.notEqual(after, before, 'a new graph object was built');
  assert.deepEqual(snapshot(after), snapshot(before));
  assert.deepEqual(cache.stats(), { hits: 0, misses: 2 });
});

test('read-only: the input is not mutated and output edges are new objects', () => {
  // Fixtures are deep-frozen, so any write to the input would have thrown.
  const input = directImport.context.dependencyEdges;
  const before = JSON.stringify(input);
  const graph = buildDependencyGraph(directImport.context);
  assert.equal(JSON.stringify(input), before);
  assert.notEqual(graph.edges[0], input[0]);
});
