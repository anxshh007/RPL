/**
 * Sanity checks for the ImpactLens fixtures.
 *
 * These tests do not exercise ImpactLens. They prove that each fixture really
 * has the shape its name promises, so later stages can rely on them.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DependencyEdge } from '../../../src/shared/contracts';
import {
  BAD_PATHS,
  BASIC_PATHS,
  MINI_FLASK_PATHS,
  allFixtures,
  badPath,
  cycle,
  directImport,
  duplicateEdges,
  emptyRepository,
  inferredOnly,
  miniFlask,
  miniFlaskEdges,
  miniFlaskProposed,
  singleFile,
  threeHopChain,
  twoHopChain,
  unresolvedImport,
} from '../../fixtures/impact';

const EDGE_KINDS: readonly string[] = ['imports', 'references', 'tests'];
const EVIDENCE: readonly string[] = ['observed', 'inferred'];

const { a: A, b: B, c: C, d: D } = BASIC_PATHS;

/** Files that depend directly on `path`, sorted. */
function dependantsOf(edges: readonly DependencyEdge[], path: string): string[] {
  return [...new Set(edges.filter((e) => e.to === path).map((e) => e.from))].sort();
}

function hasEdge(edges: readonly DependencyEdge[], from: string, to: string): boolean {
  return edges.some((e) => e.from === from && e.to === to);
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:/.test(path);
}

function hasParentSegment(path: string): boolean {
  return path.split(/[\\/]/).includes('..');
}

test('there are twelve fixtures with unique names', () => {
  assert.equal(allFixtures.length, 12);
  const names = allFixtures.map((f) => f.name);
  assert.equal(new Set(names).size, names.length);
});

test('every fixture is well-formed', () => {
  for (const fixture of allFixtures) {
    const { name, description, request, context } = fixture;
    assert.ok(name.length > 0, 'name is set');
    assert.ok(description.length > 0, `${name}: description is set`);
    assert.equal(request.requestId, `fixture-${name}`, `${name}: request id`);
    assert.equal(context.requestId, request.requestId, `${name}: context id matches request id`);

    const collections: Array<[string, unknown]> = [
      ['request.explicitFileMentions', request.explicitFileMentions],
      ['request.explicitSymbolMentions', request.explicitSymbolMentions],
      ['context.relevantFiles', context.relevantFiles],
      ['context.relevantSymbols', context.relevantSymbols],
      ['context.dependencyEdges', context.dependencyEdges],
      ['context.unresolvedImports', context.unresolvedImports],
      ['context.budgetConflicts', context.budgetConflicts],
      ['context.warnings', context.warnings],
    ];
    for (const [label, value] of collections) {
      assert.ok(Array.isArray(value), `${name}: ${label} is an array, never null`);
    }

    for (const e of context.dependencyEdges) {
      assert.equal(typeof e.from, 'string', `${name}: edge.from is a string`);
      assert.equal(typeof e.to, 'string', `${name}: edge.to is a string`);
      assert.ok(EDGE_KINDS.includes(e.kind), `${name}: edge kind "${e.kind}" is valid`);
      assert.ok(EVIDENCE.includes(e.evidence), `${name}: evidence "${e.evidence}" is valid`);
    }
  }
});

test('every fixture is deep-frozen, so input mutation throws', () => {
  for (const fixture of allFixtures) {
    const { name, request, context } = fixture;
    assert.ok(Object.isFrozen(fixture), `${name}: fixture`);
    assert.ok(Object.isFrozen(request), `${name}: request`);
    assert.ok(Object.isFrozen(request.explicitFileMentions), `${name}: explicitFileMentions`);
    assert.ok(Object.isFrozen(context), `${name}: context`);
    assert.ok(Object.isFrozen(context.dependencyEdges), `${name}: dependencyEdges`);
    for (const e of context.dependencyEdges) {
      assert.ok(Object.isFrozen(e), `${name}: each edge`);
    }
  }
  assert.throws(() => {
    directImport.context.dependencyEdges.push({
      from: 'x.py',
      to: 'y.py',
      kind: 'imports',
      evidence: 'observed',
    });
  }, TypeError);
});

test('empty repository: no edges and no changed targets', () => {
  assert.deepEqual(emptyRepository.context.dependencyEdges, []);
  assert.deepEqual(emptyRepository.context.unresolvedImports, []);
  assert.equal(emptyRepository.request.activeFile, undefined);
  assert.deepEqual(emptyRepository.request.explicitFileMentions, []);
  assert.equal(emptyRepository.proposedFiles, undefined);
});

test('single file: one changed file and no edges', () => {
  assert.equal(singleFile.request.activeFile, A);
  assert.deepEqual(singleFile.context.dependencyEdges, []);
});

test('direct import: B depends on A, and A is the changed file', () => {
  assert.equal(directImport.request.activeFile, A);
  assert.deepEqual(directImport.context.dependencyEdges, [
    { from: B, to: A, kind: 'imports', evidence: 'observed' },
  ]);
});

test('two-hop chain: C -> B -> A', () => {
  const edges = twoHopChain.context.dependencyEdges;
  assert.equal(twoHopChain.request.activeFile, A);
  assert.equal(edges.length, 2);
  assert.deepEqual(dependantsOf(edges, A), [B]);
  assert.deepEqual(dependantsOf(edges, B), [C]);
  assert.deepEqual(dependantsOf(edges, C), []);
});

test('three-hop chain: D -> C -> B -> A', () => {
  const edges = threeHopChain.context.dependencyEdges;
  assert.equal(threeHopChain.request.activeFile, A);
  assert.equal(edges.length, 3);
  assert.deepEqual(dependantsOf(edges, A), [B]);
  assert.deepEqual(dependantsOf(edges, B), [C]);
  assert.deepEqual(dependantsOf(edges, C), [D]);
  assert.deepEqual(dependantsOf(edges, D), []);
});

test('cycle: A depends on B and B depends on A', () => {
  const edges = cycle.context.dependencyEdges;
  assert.equal(edges.length, 2);
  assert.ok(hasEdge(edges, A, B));
  assert.ok(hasEdge(edges, B, A));
});

test('duplicate edges: exact repeats, and one link with both kinds of evidence', () => {
  const edges = duplicateEdges.context.dependencyEdges;
  const exactRepeats = edges.filter(
    (e) => e.from === B && e.to === A && e.kind === 'imports' && e.evidence === 'observed',
  );
  assert.equal(exactRepeats.length, 3);

  const cToA = edges.filter((e) => e.from === C && e.to === A);
  assert.deepEqual(
    cToA.map((e) => e.evidence),
    ['inferred', 'observed'],
    'the inferred copy comes first, so "observed wins" cannot be an accident of order',
  );
  assert.deepEqual(dependantsOf(edges, A), [B, C]);
});

test('unresolved import: one resolved edge and two unresolved imports', () => {
  const { dependencyEdges, unresolvedImports } = unresolvedImport.context;
  assert.equal(dependencyEdges.length, 1);
  assert.ok(hasEdge(dependencyEdges, B, A));
  assert.deepEqual(unresolvedImports, [
    { file: B, module: 'requests' },
    { file: C, module: 'pkg.missing_module' },
  ]);
  assert.ok(
    !dependencyEdges.some((e) => e.from === C || e.to === C),
    'C appears only as an unresolved importer',
  );
});

test('inferred-only: every link to A is inferred', () => {
  const edges = inferredOnly.context.dependencyEdges;
  assert.ok(edges.length > 0);
  assert.ok(edges.every((e) => e.to === A && e.evidence === 'inferred'));
  assert.deepEqual(edges.map((e) => e.kind).sort(), ['references', 'tests']);
});

test('bad path: absolute and ".." paths sit beside one good edge', () => {
  const edges = badPath.context.dependencyEdges;
  const endpoints = edges.flatMap((e) => [e.from, e.to]);

  assert.ok(endpoints.includes(BAD_PATHS.absolutePosix));
  assert.ok(endpoints.includes(BAD_PATHS.absoluteWindows));
  assert.ok(endpoints.includes(BAD_PATHS.parentInside));
  assert.ok(endpoints.includes(BAD_PATHS.parentLeading));
  assert.ok(isAbsolute(BAD_PATHS.absolutePosix));
  assert.ok(isAbsolute(BAD_PATHS.absoluteWindows));
  assert.ok(hasParentSegment(BAD_PATHS.parentInside));
  assert.ok(hasParentSegment(BAD_PATHS.parentLeading));

  const goodEdges = edges.filter(
    (e) => ![e.from, e.to].some((p) => isAbsolute(p) || hasParentSegment(p)),
  );
  assert.deepEqual(goodEdges, [{ from: B, to: A, kind: 'imports', evidence: 'observed' }]);

  assert.equal(badPath.request.activeFile, A);
  assert.deepEqual(badPath.request.explicitFileMentions, [
    BAD_PATHS.mentionParent,
    BAD_PATHS.mentionAbsolute,
  ]);
  assert.ok(hasParentSegment(BAD_PATHS.mentionParent));
  assert.ok(isAbsolute(BAD_PATHS.mentionAbsolute));
});

test('mini-Flask: the layout matches the brief', () => {
  const P = MINI_FLASK_PATHS;
  assert.deepEqual(miniFlask.context.dependencyEdges, [
    { from: P.app, to: P.helpers, kind: 'imports', evidence: 'observed' },
    { from: P.cli, to: P.app, kind: 'imports', evidence: 'observed' },
    { from: P.testHelpers, to: P.helpers, kind: 'imports', evidence: 'observed' },
    { from: P.testCli, to: P.cli, kind: 'imports', evidence: 'observed' },
    { from: P.docsCli, to: P.cli, kind: 'references', evidence: 'inferred' },
  ]);
  assert.deepEqual(miniFlask.context.dependencyEdges, miniFlaskEdges);
  assert.equal(miniFlask.request.activeFile, P.helpers);
  assert.equal(miniFlask.proposedFiles, undefined);

  const inferred = miniFlask.context.dependencyEdges.filter((e) => e.evidence === 'inferred');
  assert.equal(inferred.length, 1);
  assert.equal(inferred[0]?.from, P.docsCli);

  const knownPaths: string[] = Object.values(P);
  for (const file of miniFlask.context.relevantFiles) {
    assert.ok(knownPaths.includes(file.path), `${file.path} is part of the layout`);
  }
  for (const symbol of miniFlask.context.relevantSymbols) {
    assert.equal(symbol.file, P.helpers);
    assert.ok(symbol.startLine >= 1 && symbol.endLine >= symbol.startLine);
  }
});

test('mini-Flask proposed: same edges, called with two proposed files', () => {
  const P = MINI_FLASK_PATHS;
  assert.deepEqual(miniFlaskProposed.context.dependencyEdges, miniFlask.context.dependencyEdges);
  assert.deepEqual(miniFlaskProposed.proposedFiles, [P.helpers, P.cli]);
  assert.notEqual(miniFlaskProposed.request.requestId, miniFlask.request.requestId);
});
