/**
 * A mini-Flask layout: the realistic fixture.
 *
 *   src/flask/helpers.py
 *   src/flask/app.py        imports helpers
 *   src/flask/cli.py        imports app
 *   tests/test_helpers.py   imports helpers
 *   tests/test_cli.py       imports cli
 *   docs/cli.rst            references cli (inferred)
 *
 * Hops from helpers.py: app.py and test_helpers.py are 1, cli.py is 2,
 * test_cli.py and cli.rst are 3.
 */
import type { DependencyEdge } from '../../../src/shared/contracts';
import { deepFreeze, defineFixture, edge } from './helpers';
import type { ImpactFixture } from './helpers';

export const MINI_FLASK_PATHS = {
  helpers: 'src/flask/helpers.py',
  app: 'src/flask/app.py',
  cli: 'src/flask/cli.py',
  testHelpers: 'tests/test_helpers.py',
  testCli: 'tests/test_cli.py',
  docsCli: 'docs/cli.rst',
} as const;

const P = MINI_FLASK_PATHS;

export const miniFlaskEdges: readonly DependencyEdge[] = deepFreeze([
  edge(P.app, P.helpers),
  edge(P.cli, P.app),
  edge(P.testHelpers, P.helpers),
  edge(P.testCli, P.cli),
  edge(P.docsCli, P.cli, 'references', 'inferred'),
]);

const miniFlaskContext = {
  relevantFiles: [
    {
      path: P.helpers,
      reason: 'Active file for the request.',
      score: 1,
      source: 'active_selection' as const,
      excerpts: [{ startLine: 28, endLine: 28, text: 'def get_debug_flag() -> bool:' }],
    },
    {
      path: P.app,
      reason: 'Imports src/flask/helpers.py.',
      score: 0.6,
      source: 'dependency' as const,
      excerpts: [],
    },
  ],
  relevantSymbols: [
    {
      name: 'get_debug_flag',
      kind: 'function' as const,
      file: P.helpers,
      startLine: 28,
      endLine: 36,
    },
  ],
  dependencyEdges: [...miniFlaskEdges],
  tokenEstimate: 420,
};

/** Called before planning: the changed file comes from the request's active file. */
export const miniFlask: ImpactFixture = defineFixture({
  name: 'mini-flask',
  description:
    'Mini-Flask layout with helpers.py as the active file. At the default depth of 2 this ' +
    'reaches app.py, test_helpers.py and cli.py, but not test_cli.py or cli.rst.',
  request: {
    instruction: 'Rename get_debug_flag to is_debug_enabled in src/flask/helpers.py.',
    activeFile: P.helpers,
    explicitSymbolMentions: ['get_debug_flag'],
  },
  context: miniFlaskContext,
});

/** Called again after planning: proposed files take priority over the request. */
export const miniFlaskProposed: ImpactFixture = defineFixture({
  name: 'mini-flask-proposed',
  description:
    'Same layout, called with proposed files helpers.py and cli.py. Adds test_cli.py as a ' +
    'direct dependant and cli.rst as an inferred-only link.',
  request: {
    instruction: 'Rename get_debug_flag to is_debug_enabled in src/flask/helpers.py.',
    activeFile: P.helpers,
    explicitSymbolMentions: ['get_debug_flag'],
  },
  context: miniFlaskContext,
  proposedFiles: [P.helpers, P.cli],
});

export const miniFlaskFixtures: readonly ImpactFixture[] = Object.freeze([
  miniFlask,
  miniFlaskProposed,
]);
