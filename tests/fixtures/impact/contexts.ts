/**
 * The basic ImpactLens fixtures: one small repository shape per case.
 *
 * Edge direction follows the shared contract: `from` depends on `to`.
 * In every fixture below that has a changed file, the changed file is A.
 */
import { defineFixture, edge } from './helpers';
import type { ImpactFixture } from './helpers';

/** The file names shared by the basic fixtures. */
export const BASIC_PATHS = {
  a: 'src/pkg/a.py',
  b: 'src/pkg/b.py',
  c: 'src/pkg/c.py',
  d: 'src/pkg/d.py',
  guide: 'docs/guide.rst',
  testA: 'tests/test_a.py',
} as const;

const { a: A, b: B, c: C, d: D, guide: GUIDE, testA: TEST_A } = BASIC_PATHS;

/** Bad paths used by the bad-path fixture, named so tests can refer to them. */
export const BAD_PATHS = {
  absolutePosix: '/abs/elsewhere/c.py',
  absoluteWindows: 'C:\\Users\\someone\\d.py',
  parentInside: 'src/pkg/../../escape.py',
  parentLeading: '../outside/lib.py',
  mentionParent: '../outside/secrets.py',
  mentionAbsolute: '/etc/hosts',
} as const;

export const emptyRepository: ImpactFixture = defineFixture({
  name: 'empty-repository',
  description:
    'No files, no edges and no changed targets. Expect a valid empty report with a warning.',
});

export const singleFile: ImpactFixture = defineFixture({
  name: 'single-file',
  description: 'One changed file that nothing depends on. Expect no affected files.',
  request: { activeFile: A },
});

export const directImport: ImpactFixture = defineFixture({
  name: 'direct-import',
  description: 'B imports A. Changing A affects B directly (one hop).',
  request: { activeFile: A },
  context: { dependencyEdges: [edge(B, A)] },
});

export const twoHopChain: ImpactFixture = defineFixture({
  name: 'two-hop-chain',
  description: 'C imports B, B imports A. Changing A reaches B at one hop and C at two.',
  request: { activeFile: A },
  context: { dependencyEdges: [edge(B, A), edge(C, B)] },
});

export const threeHopChain: ImpactFixture = defineFixture({
  name: 'three-hop-chain',
  description:
    'D imports C, C imports B, B imports A. D is three hops from A, beyond the default depth of 2.',
  request: { activeFile: A },
  context: { dependencyEdges: [edge(B, A), edge(C, B), edge(D, C)] },
});

export const cycle: ImpactFixture = defineFixture({
  name: 'cycle',
  description: 'A imports B and B imports A. Traversal must terminate; changing A affects B only.',
  request: { activeFile: A },
  context: { dependencyEdges: [edge(A, B), edge(B, A)] },
});

export const duplicateEdges: ImpactFixture = defineFixture({
  name: 'duplicate-edges',
  description:
    'B imports A is listed three times. C imports A is listed as both inferred and observed. ' +
    'Each pair must collapse to a single edge.',
  request: { activeFile: A },
  context: {
    dependencyEdges: [
      edge(B, A),
      edge(B, A),
      edge(B, A),
      edge(C, A, 'imports', 'inferred'),
      edge(C, A, 'imports', 'observed'),
    ],
  },
});

export const unresolvedImport: ImpactFixture = defineFixture({
  name: 'unresolved-import',
  description:
    'B imports A. B also has an import that could not be resolved, and so does C, which has no ' +
    'resolved edges at all. The analysis is partial and must say so.',
  request: { activeFile: A },
  context: {
    dependencyEdges: [edge(B, A)],
    unresolvedImports: [
      { file: B, module: 'requests' },
      { file: C, module: 'pkg.missing_module' },
    ],
  },
});

export const inferredOnly: ImpactFixture = defineFixture({
  name: 'inferred-only',
  description:
    'A doc references A and a test is linked to A by naming convention. Both links are inferred; ' +
    'no observed link reaches A.',
  request: { activeFile: A },
  context: {
    dependencyEdges: [
      edge(GUIDE, A, 'references', 'inferred'),
      edge(TEST_A, A, 'tests', 'inferred'),
    ],
  },
});

export const badPath: ImpactFixture = defineFixture({
  name: 'bad-path',
  description:
    'One good edge (B imports A) among edges with absolute paths and paths containing "..". ' +
    'The request also mentions two bad paths. Each bad path is rejected with a warning; ' +
    'the good edge is still analysed.',
  request: {
    activeFile: A,
    explicitFileMentions: [BAD_PATHS.mentionParent, BAD_PATHS.mentionAbsolute],
  },
  context: {
    dependencyEdges: [
      edge(B, A),
      edge(BAD_PATHS.absolutePosix, A),
      edge(BAD_PATHS.absoluteWindows, A),
      edge(BAD_PATHS.parentInside, A),
      edge(B, BAD_PATHS.parentLeading),
    ],
  },
});

/** The basic fixtures, in a fixed order. */
export const basicFixtures: readonly ImpactFixture[] = Object.freeze([
  emptyRepository,
  singleFile,
  directImport,
  twoHopChain,
  threeHopChain,
  cycle,
  duplicateEdges,
  unresolvedImport,
  inferredOnly,
  badPath,
]);
