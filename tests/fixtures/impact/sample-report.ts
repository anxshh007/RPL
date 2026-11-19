/**
 * A complete sample ImpactReport, for the UI module to build and test against
 * before the live analysis is connected.
 *
 * It is the real output of ImpactLens for the mini-Flask fixture with
 * src/flask/helpers.py as the changed file. A unit test regenerates the report
 * and fails if this file drifts from what the analyser produces.
 *
 * The depth is 3 here (the default is 2) so that the sample contains every
 * value the UI has to handle:
 *   risk        high, medium, low
 *   confidence  high, medium, low
 *   highlight   changed, affected   ("none" marks a file that is on a path but
 *               is neither changed nor affected; it does not occur in this sample)
 *   node kind   file, test
 *   edge kind   imports, references
 *   evidence    observed, inferred
 *
 * All of these are semantic values. The UI maps them to its own (light) theme;
 * the report contains no colours or styles.
 *
 * Graph notes: a node id is its path; an edge id is `${source}→${target}:${kind}`;
 * an edge runs from the dependant (source) to the file it depends on (target).
 */
import type { ImpactReport } from '../../../src/shared/contracts';

/** The fixed clock value used to generate the sample. */
export const SAMPLE_REPORT_GENERATED_AT = '2026-01-01T00:00:00.000Z';

/** The analyser options used to generate the sample. */
export const SAMPLE_REPORT_OPTIONS = { maxDepth: 3 } as const;

export const sampleReport: ImpactReport = {
  requestId: 'fixture-mini-flask',
  generatedAt: SAMPLE_REPORT_GENERATED_AT,
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
      risk: 'high',
      reasons: [
        'is an entry point or configuration file (name matches "cli.py")',
        'is two hops from the change: imports src/flask/app.py, which imports src/flask/helpers.py, which is being changed',
      ],
      relationshipPath: ['src/flask/helpers.py', 'src/flask/app.py', 'src/flask/cli.py'],
      confidence: 'medium',
      relatedSymbols: [],
      matchedRule: 'entry-or-config',
    },
    {
      path: 'tests/test_cli.py',
      risk: 'medium',
      reasons: [
        'is a test file linked to the change',
        'is 3 hops from the change: imports src/flask/cli.py, which imports src/flask/app.py, which imports src/flask/helpers.py, which is being changed',
      ],
      relationshipPath: [
        'src/flask/helpers.py',
        'src/flask/app.py',
        'src/flask/cli.py',
        'tests/test_cli.py',
      ],
      confidence: 'low',
      relatedSymbols: [],
      matchedRule: 'linked-test-or-doc',
    },
    {
      path: 'docs/cli.rst',
      risk: 'low',
      reasons: [
        'appears to reference src/flask/cli.py, which imports src/flask/app.py, which imports src/flask/helpers.py, which is being changed (the path includes an inferred link, not observed in source)',
        'is a documentation file linked to the change',
      ],
      relationshipPath: [
        'src/flask/helpers.py',
        'src/flask/app.py',
        'src/flask/cli.py',
        'docs/cli.rst',
      ],
      confidence: 'low',
      relatedSymbols: [],
      matchedRule: 'inferred-only',
    },
  ],
  testCandidates: [
    {
      path: 'tests/test_helpers.py',
      reason: 'Depends directly on src/flask/helpers.py, which is being changed.',
      source: 'impact',
      confidence: 'high',
    },
    {
      path: 'tests/test_cli.py',
      reason: 'Depends on src/flask/helpers.py, which is being changed, through 3 hops.',
      source: 'impact',
      confidence: 'low',
    },
  ],
  nodes: [
    {
      id: 'src/flask/helpers.py',
      label: 'helpers.py',
      kind: 'file',
      path: 'src/flask/helpers.py',
      highlight: 'changed',
    },
    {
      id: 'src/flask/app.py',
      label: 'app.py',
      kind: 'file',
      path: 'src/flask/app.py',
      highlight: 'affected',
      risk: 'high',
    },
    {
      id: 'tests/test_helpers.py',
      label: 'test_helpers.py',
      kind: 'test',
      path: 'tests/test_helpers.py',
      highlight: 'affected',
      risk: 'high',
    },
    {
      id: 'src/flask/cli.py',
      label: 'cli.py',
      kind: 'file',
      path: 'src/flask/cli.py',
      highlight: 'affected',
      risk: 'high',
    },
    {
      id: 'tests/test_cli.py',
      label: 'test_cli.py',
      kind: 'test',
      path: 'tests/test_cli.py',
      highlight: 'affected',
      risk: 'medium',
    },
    {
      id: 'docs/cli.rst',
      label: 'cli.rst',
      kind: 'file',
      path: 'docs/cli.rst',
      highlight: 'affected',
      risk: 'low',
    },
  ],
  edges: [
    {
      id: 'docs/cli.rst→src/flask/cli.py:references',
      source: 'docs/cli.rst',
      target: 'src/flask/cli.py',
      kind: 'references',
      evidence: 'inferred',
    },
    {
      id: 'src/flask/app.py→src/flask/helpers.py:imports',
      source: 'src/flask/app.py',
      target: 'src/flask/helpers.py',
      kind: 'imports',
      evidence: 'observed',
    },
    {
      id: 'src/flask/cli.py→src/flask/app.py:imports',
      source: 'src/flask/cli.py',
      target: 'src/flask/app.py',
      kind: 'imports',
      evidence: 'observed',
    },
    {
      id: 'tests/test_cli.py→src/flask/cli.py:imports',
      source: 'tests/test_cli.py',
      target: 'src/flask/cli.py',
      kind: 'imports',
      evidence: 'observed',
    },
    {
      id: 'tests/test_helpers.py→src/flask/helpers.py:imports',
      source: 'tests/test_helpers.py',
      target: 'src/flask/helpers.py',
      kind: 'imports',
      evidence: 'observed',
    },
  ],
  summary: {
    analysedFiles: 6,
    affectedCount: 5,
    high: 3,
    medium: 1,
    low: 1,
    incomplete: false,
  },
  warnings: [],
  limitations: [
    'Static analysis only; does not prove runtime impact.',
    'Risk levels and confidence are rule-based estimates, not measured probabilities.',
    'Only files within 3 hops of a changed file are reported.',
    'Only relationships supplied in the repository context are considered; unresolved imports are not followed.',
  ],
};
