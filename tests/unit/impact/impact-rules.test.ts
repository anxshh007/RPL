import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDependencyGraph } from '../../../src/impact/dependency-graph';
import { resolveChangedTargets, traceImpact } from '../../../src/impact/impact-analyser';
import type { ImpactTrace, TraversalOptions } from '../../../src/impact/impact-analyser';
import {
  ENTRY_OR_CONFIG_PATTERNS,
  IMPACT_RULES,
  classifyImpact,
  entryOrConfigPattern,
  isDocFile,
  isTestFile,
} from '../../../src/impact/impact-rules';
import type { ImpactClassification } from '../../../src/impact/impact-rules';
import type { DependencyEdge } from '../../../src/shared/contracts';
import {
  BASIC_PATHS,
  MINI_FLASK_PATHS,
  allFixtures,
  directImport,
  edge,
  inferredOnly,
  miniFlask,
  miniFlaskProposed,
  threeHopChain,
  twoHopChain,
} from '../../fixtures/impact';
import type { ImpactFixture } from '../../fixtures/impact';

const { a: A, b: B, c: C, d: D, guide: GUIDE, testA: TEST_A } = BASIC_PATHS;
const X = 'src/pkg/x.py';
const Y = 'src/pkg/y.py';

function tracesFor(fixture: ImpactFixture, options?: TraversalOptions): readonly ImpactTrace[] {
  const graph = buildDependencyGraph(fixture.context);
  const { targets } = resolveChangedTargets(fixture.request, fixture.proposedFiles);
  return traceImpact(graph, targets, options).traces;
}

function tracesFrom(
  edges: DependencyEdge[],
  targets: string[],
  options?: TraversalOptions,
): readonly ImpactTrace[] {
  const graph = buildDependencyGraph({ dependencyEdges: edges, unresolvedImports: [] });
  return traceImpact(graph, targets, options).traces;
}

/** Classifies one file, using traces produced by the real analyser. */
function classify(traces: readonly ImpactTrace[], path: string): ImpactClassification {
  const trace = traces.find((t) => t.path === path);
  assert.ok(trace !== undefined, `${path} should be among the affected files`);
  return classifyImpact(trace);
}

/** [path, risk, confidence, matchedRule] for each trace. */
function table(traces: readonly ImpactTrace[]): unknown[] {
  return traces.map((trace) => {
    const c = classifyImpact(trace);
    return [trace.path, c.risk, c.confidence, c.matchedRule];
  });
}

// ───────────────────────── The rule table ─────────────────────────

test('rules: the table lists seven rules in checking order with fixed risks', () => {
  assert.deepEqual(
    IMPACT_RULES.map((rule) => [rule.name, rule.risk]),
    [
      ['inferred-only', 'low'],
      ['multiple-direct-links', 'high'],
      ['direct-dependency', 'high'],
      ['entry-or-config', 'high'],
      ['linked-test-or-doc', 'medium'],
      ['two-hop', 'medium'],
      ['distant', 'low'],
    ],
  );
  for (const rule of IMPACT_RULES) {
    assert.ok(rule.summary.length > 0, `${rule.name} has a summary`);
  }
  assert.deepEqual(ENTRY_OR_CONFIG_PATTERNS, ['__init__.py', 'app.py', 'cli.py', 'config*', 'settings*']);
});

// ───────────────────────── One test per rule ─────────────────────────

test('rule direct-dependency: imports a changed file directly (high risk, high confidence)', () => {
  assert.deepEqual(classify(tracesFor(directImport), B), {
    risk: 'high',
    confidence: 'high',
    matchedRule: 'direct-dependency',
    reasons: ['imports src/pkg/a.py, which is being changed'],
  });
});

test('rule multiple-direct-links: observed links to two changed files (high risk)', () => {
  const traces = tracesFrom([edge(X, A), edge(X, B)], [A, B]);
  assert.deepEqual(classify(traces, X), {
    risk: 'high',
    confidence: 'high',
    matchedRule: 'multiple-direct-links',
    reasons: [
      'has direct links to 2 changed files: src/pkg/a.py, src/pkg/b.py',
      'imports src/pkg/a.py, which is being changed',
    ],
  });
});

test('rule multiple-direct-links: an inferred second link does not count', () => {
  const traces = tracesFrom([edge(X, A), edge(X, B, 'references', 'inferred')], [A, B]);
  assert.deepEqual(classify(traces, X), {
    risk: 'high',
    confidence: 'high',
    matchedRule: 'direct-dependency',
    reasons: [
      'imports src/pkg/a.py, which is being changed',
      'also appears to reference src/pkg/b.py directly (inferred, not observed in source)',
    ],
  });
});

test('rule multiple-direct-links: two kinds of link to one changed file do not count', () => {
  const traces = tracesFrom([edge(X, A, 'imports'), edge(X, A, 'tests')], [A]);
  const result = classify(traces, X);
  assert.equal(result.matchedRule, 'direct-dependency');
  assert.deepEqual(result.reasons, ['imports src/pkg/a.py, which is being changed']);
});

test('rule entry-or-config: an entry point two hops away is high risk, medium confidence', () => {
  assert.deepEqual(classify(tracesFor(miniFlask), MINI_FLASK_PATHS.cli), {
    risk: 'high',
    confidence: 'medium',
    matchedRule: 'entry-or-config',
    reasons: [
      'is an entry point or configuration file (name matches "cli.py")',
      'is two hops from the change: imports src/flask/app.py, which imports src/flask/helpers.py, ' +
        'which is being changed',
    ],
  });
});

test('rule entry-or-config: every pattern matches, and near-misses do not', () => {
  const matching: Array<[string, string]> = [
    ['src/pkg/sub/__init__.py', '__init__.py'],
    ['src/web/app.py', 'app.py'],
    ['src/web/cli.py', 'cli.py'],
    ['src/web/config.py', 'config*'],
    ['src/web/config_loader.py', 'config*'],
    ['src/web/settings.py', 'settings*'],
    ['src/web/settings_dev.yaml', 'settings*'],
    ['src/web/Settings.py', 'settings*'],
  ];
  for (const [path, pattern] of matching) {
    const result = classify(tracesFrom([edge(path, B), edge(B, A)], [A]), path);
    assert.equal(result.matchedRule, 'entry-or-config', path);
    assert.equal(result.risk, 'high', path);
    assert.equal(
      result.reasons[0],
      `is an entry point or configuration file (name matches "${pattern}")`,
      path,
    );
  }

  for (const path of ['src/web/myapp.py', 'src/web/reconfig.py', 'src/web/conftest.py', 'src/web/client.py']) {
    const result = classify(tracesFrom([edge(path, B), edge(B, A)], [A]), path);
    assert.equal(result.matchedRule, 'two-hop', path);
    assert.equal(result.risk, 'medium', path);
  }
});

test('rule two-hop: two observed hops (medium risk, medium confidence)', () => {
  assert.deepEqual(classify(tracesFor(twoHopChain), C), {
    risk: 'medium',
    confidence: 'medium',
    matchedRule: 'two-hop',
    reasons: [
      'is two hops from the change: imports src/pkg/b.py, which imports src/pkg/a.py, ' +
        'which is being changed',
    ],
  });
});

test('rule linked-test-or-doc: a test two hops away (medium risk)', () => {
  const testFile = 'tests/test_b.py';
  const traces = tracesFrom([edge(testFile, B), edge(B, A)], [A]);
  assert.deepEqual(classify(traces, testFile), {
    risk: 'medium',
    confidence: 'medium',
    matchedRule: 'linked-test-or-doc',
    reasons: [
      'is a test file linked to the change',
      'is two hops from the change: imports src/pkg/b.py, which imports src/pkg/a.py, ' +
        'which is being changed',
    ],
  });
});

test('rule linked-test-or-doc: a doc three observed hops away stays medium, with low confidence', () => {
  const traces = tracesFrom(
    [edge(GUIDE, C, 'references', 'observed'), edge(C, B), edge(B, A)],
    [A],
    { maxDepth: 3 },
  );
  assert.deepEqual(classify(traces, GUIDE), {
    risk: 'medium',
    confidence: 'low',
    matchedRule: 'linked-test-or-doc',
    reasons: [
      'is a documentation file linked to the change',
      'is 3 hops from the change: references src/pkg/c.py, which imports src/pkg/b.py, ' +
        'which imports src/pkg/a.py, which is being changed',
    ],
  });
});

test('rule linked-test-or-doc: a test that imports the change directly is direct-dependency', () => {
  assert.deepEqual(classify(tracesFor(miniFlask), MINI_FLASK_PATHS.testHelpers), {
    risk: 'high',
    confidence: 'high',
    matchedRule: 'direct-dependency',
    reasons: [
      'imports src/flask/helpers.py, which is being changed',
      'is a test file linked to the change',
    ],
  });
});

test('rule inferred-only: only inferred links (low risk, low confidence)', () => {
  assert.deepEqual(classify(tracesFor(miniFlaskProposed), MINI_FLASK_PATHS.docsCli), {
    risk: 'low',
    confidence: 'low',
    matchedRule: 'inferred-only',
    reasons: [
      'appears to reference src/flask/cli.py, which is being changed (inferred, not observed in source)',
      'is a documentation file linked to the change',
    ],
  });
  assert.deepEqual(classify(tracesFor(inferredOnly), TEST_A), {
    risk: 'low',
    confidence: 'low',
    matchedRule: 'inferred-only',
    reasons: [
      'appears to test src/pkg/a.py, which is being changed (inferred, not observed in source)',
      'is a test file linked to the change',
    ],
  });
});

test('rule inferred-only: overrides every other rule', () => {
  // An entry-point name, reached only by inference.
  const config = 'src/pkg/config.py';
  const entry = classify(tracesFrom([edge(config, A, 'references', 'inferred')], [A]), config);
  assert.equal(entry.matchedRule, 'inferred-only');
  assert.equal(entry.risk, 'low');
  assert.equal(entry.reasons[1], 'is an entry point or configuration file (name matches "config*")');

  // Inferred links to two changed files are not "multiple direct links".
  const both = classify(
    tracesFrom([edge(X, A, 'references', 'inferred'), edge(X, B, 'references', 'inferred')], [A, B]),
    X,
  );
  assert.equal(both.matchedRule, 'inferred-only');
  assert.equal(both.risk, 'low');
  assert.equal(both.reasons.length, 1);
});

test('rule inferred-only: an inferred link anywhere on the path counts', () => {
  // Y imports X; X is linked to A only by inference within two hops of Y.
  const edges = [edge(X, A, 'references', 'inferred'), edge(X, B), edge(B, A), edge(Y, X)];
  assert.deepEqual(classify(tracesFrom(edges, [A]), Y), {
    risk: 'low',
    confidence: 'low',
    matchedRule: 'inferred-only',
    reasons: [
      'imports src/pkg/x.py, which appears to reference src/pkg/a.py, which is being changed ' +
        '(the path includes an inferred link, not observed in source)',
    ],
  });
});

test('rule distant: three or more observed hops (low risk, low confidence)', () => {
  assert.deepEqual(classify(tracesFor(threeHopChain, { maxDepth: 3 }), D), {
    risk: 'low',
    confidence: 'low',
    matchedRule: 'distant',
    reasons: [
      'is 3 hops from the change: imports src/pkg/c.py, which imports src/pkg/b.py, ' +
        'which imports src/pkg/a.py, which is being changed',
    ],
  });
});

// ───────────────────────── Across the rules ─────────────────────────

test('rules: an observed path with an inferred shortcut is classified by the observed path', () => {
  const edges = [edge(X, A, 'references', 'inferred'), edge(X, B), edge(B, A)];
  assert.deepEqual(classify(tracesFrom(edges, [A]), X), {
    risk: 'medium',
    confidence: 'medium',
    matchedRule: 'two-hop',
    reasons: [
      'is two hops from the change: imports src/pkg/b.py, which imports src/pkg/a.py, ' +
        'which is being changed',
      'also appears to reference src/pkg/a.py directly (inferred, not observed in source)',
    ],
  });
});

test('rules: confidence follows evidence and hop count, independent of risk', () => {
  const chain = [edge(B, A), edge(C, B), edge(D, C)];
  const observed = tracesFrom(chain, [A], { maxDepth: 3 });
  assert.deepEqual(
    [B, C, D].map((path) => classify(observed, path).confidence),
    ['high', 'medium', 'low'],
  );

  const inferredChain = [edge(B, A, 'imports', 'inferred'), edge(C, B)];
  const inferred = tracesFrom(inferredChain, [A]);
  assert.deepEqual(
    [B, C].map((path) => classify(inferred, path).confidence),
    ['low', 'low'],
  );
});

test('rules: mini-Flask classifications', () => {
  const P = MINI_FLASK_PATHS;
  assert.deepEqual(table(tracesFor(miniFlask)), [
    [P.app, 'high', 'high', 'direct-dependency'],
    [P.cli, 'high', 'medium', 'entry-or-config'],
    [P.testHelpers, 'high', 'high', 'direct-dependency'],
  ]);
  assert.deepEqual(table(tracesFor(miniFlaskProposed)), [
    [P.docsCli, 'low', 'low', 'inferred-only'],
    [P.app, 'high', 'high', 'direct-dependency'],
    [P.testCli, 'high', 'high', 'direct-dependency'],
    [P.testHelpers, 'high', 'high', 'direct-dependency'],
  ]);
  assert.deepEqual(table(tracesFor(miniFlask, { maxDepth: 3 })), [
    [P.docsCli, 'low', 'low', 'inferred-only'],
    [P.app, 'high', 'high', 'direct-dependency'],
    [P.cli, 'high', 'medium', 'entry-or-config'],
    [P.testCli, 'medium', 'low', 'linked-test-or-doc'],
    [P.testHelpers, 'high', 'high', 'direct-dependency'],
  ]);
});

test('rules: every affected file on every fixture gets a complete, valid classification', () => {
  const riskByRule = new Map(IMPACT_RULES.map((rule) => [rule.name, rule.risk]));
  const certainty = /\b(will|definitely|certainly|guaranteed|always|must)\b/i;
  let checked = 0;

  for (const fixture of allFixtures) {
    for (const maxDepth of [1, 2, 3, 4]) {
      for (const trace of tracesFor(fixture, { maxDepth })) {
        const result = classifyImpact(trace);
        const label = `${fixture.name} depth ${maxDepth}: ${trace.path}`;
        assert.ok(riskByRule.has(result.matchedRule), `${label}: known rule`);
        assert.equal(result.risk, riskByRule.get(result.matchedRule), `${label}: risk matches rule`);
        assert.ok(['high', 'medium', 'low'].includes(result.confidence), `${label}: confidence`);
        assert.ok(result.reasons.length >= 1, `${label}: at least one reason`);
        for (const reason of result.reasons) {
          assert.ok(reason.trim().length > 0, `${label}: reasons are not blank`);
          assert.ok(!certainty.test(reason), `${label}: "${reason}" must not claim certainty`);
        }
        assert.equal(
          new Set(result.reasons).size,
          result.reasons.length,
          `${label}: no repeated reasons`,
        );
        if (trace.pathEvidence === 'inferred') {
          assert.equal(result.matchedRule, 'inferred-only', `${label}: inferred path`);
          assert.equal(result.confidence, 'low', `${label}: inferred means low confidence`);
        }
        checked += 1;
      }
    }
  }
  assert.ok(checked > 30, `expected a meaningful number of traces, checked ${checked}`);
});

test('rules: deterministic, and the trace is not modified', () => {
  for (const fixture of allFixtures) {
    for (const trace of tracesFor(fixture, { maxDepth: 3 })) {
      const before = JSON.stringify(trace);
      const first = classifyImpact(trace);
      const second = classifyImpact(trace);
      assert.deepEqual(second, first, `${fixture.name}: ${trace.path}`);
      assert.notEqual(second.reasons, first.reasons, 'each call returns its own reasons array');
      assert.equal(JSON.stringify(trace), before, 'the trace is unchanged');
    }
  }
});

// ───────────────────────── File kinds ─────────────────────────

test('file kinds: test files', () => {
  for (const path of [
    'tests/test_cli.py',
    'tests/unit/helpers.py',
    'src/pkg/tests/conftest.py',
    'src/pkg/test_utils.py',
    'src/pkg/utils_test.py',
  ]) {
    assert.equal(isTestFile(path), true, path);
  }
  for (const path of ['src/pkg/testing.py', 'src/pkg/contest.py', 'src/latest.py', 'tests.py', 'src/test_data.json']) {
    assert.equal(isTestFile(path), false, path);
  }
});

test('file kinds: documentation files', () => {
  for (const path of ['docs/cli.rst', 'docs/api/index.html', 'README.md', 'src/pkg/NOTES.MD', 'CHANGES.rst']) {
    assert.equal(isDocFile(path), true, path);
  }
  for (const path of ['src/pkg/docs.py', 'src/pkg/a.py', 'src/readme.txt']) {
    assert.equal(isDocFile(path), false, path);
  }
});

test('file kinds: entry-point and configuration patterns', () => {
  assert.equal(entryOrConfigPattern('src/flask/__init__.py'), '__init__.py');
  assert.equal(entryOrConfigPattern('app.py'), 'app.py');
  assert.equal(entryOrConfigPattern('src/flask/cli.py'), 'cli.py');
  assert.equal(entryOrConfigPattern('src/flask/config.py'), 'config*');
  assert.equal(entryOrConfigPattern('settings/base.py'), undefined, 'the directory name is not matched');
  assert.equal(entryOrConfigPattern('src/flask/helpers.py'), undefined);
});
