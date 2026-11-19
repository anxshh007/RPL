import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { createImpactAnalyser } from '../../../src/impact';
import type {
  ChangeRequest,
  DependencyEdge,
  ImpactAnalyser,
  ImpactReport,
  RepositoryContext,
} from '../../../src/shared/contracts';
import {
  BASIC_PATHS,
  MINI_FLASK_PATHS,
  allFixtures,
  directImport,
  edge,
  makeContext,
  makeRequest,
  miniFlask,
  miniFlaskProposed,
} from '../../fixtures/impact';

const { a: A, b: B } = BASIC_PATHS;
const FIXED_TIME = '2026-01-01T00:00:00.000Z';
const fixedClock = (): Date => new Date(FIXED_TIME);

function affectedPaths(report: ImpactReport): string[] {
  return report.affectedFiles.map((file) => file.path);
}

function assertValidShape(report: ImpactReport, label: string): void {
  for (const key of [
    'changedTargets',
    'affectedFiles',
    'testCandidates',
    'nodes',
    'edges',
    'warnings',
    'limitations',
  ] as const) {
    assert.ok(Array.isArray(report[key]), `${label}: ${key} is an array`);
  }
  assert.equal(typeof report.requestId, 'string', `${label}: requestId`);
  assert.ok(!Number.isNaN(Date.parse(report.generatedAt)), `${label}: generatedAt is a date`);
  assert.equal(typeof report.summary.incomplete, 'boolean', `${label}: incomplete`);
  assert.equal(
    report.limitations[0],
    'Static analysis only; does not prove runtime impact.',
    `${label}: limitation`,
  );
}

// ───────────────────────── The public entry ─────────────────────────

test('createImpactAnalyser: takes no arguments and returns the ImpactAnalyser service', async () => {
  const analyser: ImpactAnalyser = createImpactAnalyser();
  assert.equal(typeof analyser.analyseImpact, 'function');

  const pending = analyser.analyseImpact(directImport.request, directImport.context);
  assert.ok(pending instanceof Promise);
  const report = await pending;
  assert.equal(report.requestId, directImport.request.requestId);
  assert.deepEqual(report.changedTargets, [A]);
  assert.deepEqual(affectedPaths(report), [B]);
  assertValidShape(report, 'direct import');
});

test('analyseImpact: before planning, the changed file comes from the request', async () => {
  const P = MINI_FLASK_PATHS;
  // The agent passes [] and a signal on its first call.
  const report = await createImpactAnalyser().analyseImpact(
    miniFlask.request,
    miniFlask.context,
    [],
    new AbortController().signal,
  );
  assert.deepEqual(report.changedTargets, [P.helpers]);
  assert.deepEqual(
    report.affectedFiles.map((f) => [f.path, f.risk, f.confidence, f.matchedRule]),
    [
      [P.app, 'high', 'high', 'direct-dependency'],
      [P.testHelpers, 'high', 'high', 'direct-dependency'],
      [P.cli, 'high', 'medium', 'entry-or-config'],
    ],
  );
  assert.deepEqual(
    report.testCandidates.map((c) => c.path),
    [P.testHelpers],
  );
  assert.equal(report.summary.incomplete, false);
  assert.deepEqual(report.warnings, []);
});

test('analyseImpact: called again with proposed files, those replace the request', async () => {
  const P = MINI_FLASK_PATHS;
  const report = await createImpactAnalyser().analyseImpact(
    miniFlaskProposed.request,
    miniFlaskProposed.context,
    miniFlaskProposed.proposedFiles,
  );
  assert.deepEqual(report.changedTargets, [P.cli, P.helpers]);
  assert.deepEqual(
    report.affectedFiles.map((f) => [f.path, f.risk]),
    [
      [P.app, 'high'],
      [P.testCli, 'high'],
      [P.testHelpers, 'high'],
      [P.docsCli, 'low'],
    ],
  );
  assert.deepEqual(
    report.testCandidates.map((c) => c.path),
    [P.testCli, P.testHelpers],
  );
});

// ───────────────────────── Options ─────────────────────────

test('options: generatedAt uses the injected clock, or the real time by default', async () => {
  const fixed = await createImpactAnalyser({ now: fixedClock }).analyseImpact(
    directImport.request,
    directImport.context,
  );
  assert.equal(fixed.generatedAt, FIXED_TIME);

  const live = await createImpactAnalyser().analyseImpact(directImport.request, directImport.context);
  assert.ok(Math.abs(Date.parse(live.generatedAt) - Date.now()) < 60_000);
  assert.equal(new Date(live.generatedAt).toISOString(), live.generatedAt, 'ISO 8601');

  const broken = await createImpactAnalyser({
    now: () => {
      throw new Error('clock failed');
    },
  }).analyseImpact(directImport.request, directImport.context);
  assert.deepEqual(affectedPaths(broken), [B], 'a failing clock does not lose the analysis');
});

test('options: maxDepth and maxVisitedFiles are applied', async () => {
  const P = MINI_FLASK_PATHS;
  const deep = await createImpactAnalyser({ maxDepth: 3 }).analyseImpact(
    miniFlask.request,
    miniFlask.context,
  );
  assert.deepEqual(affectedPaths(deep), [P.app, P.testHelpers, P.cli, P.testCli, P.docsCli]);
  assert.ok(deep.limitations.includes('Only files within 3 hops of a changed file are reported.'));

  const capped = await createImpactAnalyser({ maxVisitedFiles: 2 }).analyseImpact(
    miniFlask.request,
    miniFlask.context,
  );
  assert.equal(capped.summary.affectedCount, 2);
  assert.equal(capped.summary.incomplete, true);
  assert.ok(capped.warnings.some((w) => w.includes('limit of 2 affected files')));
});

// ───────────────────────── Determinism ─────────────────────────

test('determinism: same input and clock give an identical report, in the same order', async () => {
  const analyser = createImpactAnalyser({ now: fixedClock });
  for (const fixture of allFixtures) {
    const first = await analyser.analyseImpact(fixture.request, fixture.context, fixture.proposedFiles);
    const second = await analyser.analyseImpact(fixture.request, fixture.context, fixture.proposedFiles);
    assert.deepEqual(second, first, fixture.name);
    assert.equal(JSON.stringify(second), JSON.stringify(first), `${fixture.name}: same key and item order`);
  }
});

test('determinism: without a fixed clock, only generatedAt can differ', async () => {
  const analyser = createImpactAnalyser();
  const first = await analyser.analyseImpact(miniFlask.request, miniFlask.context);
  const second = await analyser.analyseImpact(miniFlask.request, miniFlask.context);
  assert.deepEqual({ ...second, generatedAt: '' }, { ...first, generatedAt: '' });
});

// ───────────────────── Never a crash, always a report ─────────────────────

test('robustness: every fixture resolves to a valid report', async () => {
  const analyser = createImpactAnalyser({ now: fixedClock });
  for (const fixture of allFixtures) {
    const report = await analyser.analyseImpact(fixture.request, fixture.context, fixture.proposedFiles);
    assertValidShape(report, fixture.name);
    assert.equal(report.requestId, fixture.request.requestId, fixture.name);
  }
});

test('robustness: a cancelled signal resolves with a partial report, it does not reject', async () => {
  const controller = new AbortController();
  controller.abort();
  const report = await createImpactAnalyser().analyseImpact(
    miniFlask.request,
    miniFlask.context,
    [],
    controller.signal,
  );
  assertValidShape(report, 'cancelled');
  assert.deepEqual(report.affectedFiles, []);
  assert.equal(report.summary.incomplete, true);
  assert.deepEqual(report.warnings, [
    'Analysis was cancelled before it finished; the results are partial.',
  ]);
});

test('robustness: a missing context or request gives a valid partial report', async () => {
  const analyser = createImpactAnalyser();
  const nothing = undefined as unknown as RepositoryContext;
  const noRequest = null as unknown as ChangeRequest;

  const noContext = await analyser.analyseImpact(directImport.request, nothing);
  assertValidShape(noContext, 'no context');
  assert.equal(noContext.requestId, directImport.request.requestId);
  assert.deepEqual(noContext.changedTargets, [A]);
  assert.equal(noContext.summary.incomplete, true);
  assert.ok(noContext.warnings.length > 0);

  const requestMissing = await analyser.analyseImpact(noRequest, directImport.context);
  assertValidShape(requestMissing, 'no request');
  assert.equal(requestMissing.requestId, directImport.context.requestId, 'falls back to the context id');
  assert.deepEqual(requestMissing.affectedFiles, []);

  const neither = await analyser.analyseImpact(noRequest, nothing);
  assertValidShape(neither, 'neither');
  assert.equal(neither.requestId, 'unknown');
  assert.equal(neither.summary.incomplete, true);
});

test('robustness: malformed edges and proposed files produce warnings, not a crash', async () => {
  const junkEdges = [edge(B, A), null, 7, { from: 1, to: 2 }, 'x'] as unknown as DependencyEdge[];
  const context = makeContext('r', { dependencyEdges: junkEdges });
  const proposed = [A, '/etc/passwd', '../../x', 5] as unknown as string[];

  const report = await createImpactAnalyser().analyseImpact(makeRequest('r'), context, proposed);
  assertValidShape(report, 'junk');
  assert.deepEqual(report.changedTargets, [A]);
  assert.deepEqual(affectedPaths(report), [B]);
  assert.equal(report.summary.incomplete, true);
  assert.ok(report.warnings.length >= 4);
});

test('robustness: an unexpected failure gives an empty, incomplete report with a safe message', async () => {
  const hostile = {
    requestId: 'r-hostile',
    get dependencyEdges(): DependencyEdge[] {
      throw new Error('boom: SECRET_TOKEN=abc123');
    },
  } as unknown as RepositoryContext;

  const report = await createImpactAnalyser({ now: fixedClock }).analyseImpact(
    directImport.request,
    hostile,
  );
  assertValidShape(report, 'hostile');
  assert.deepEqual(report.affectedFiles, []);
  assert.equal(report.summary.incomplete, true);
  assert.equal(report.warnings.length, 1);
  assert.ok(report.warnings[0]?.startsWith('ImpactLens could not complete the analysis:'));
  assert.ok(!JSON.stringify(report).includes('SECRET_TOKEN'), 'error details are not leaked');
});

test('honesty: with the repository stub context, the report is incomplete with a warning', async () => {
  // Mirrors the shared honesty test in tests/unit/shared/contracts.test.ts of the team repository:
  // a request with no files, and the context returned by the repository stub.
  const request: ChangeRequest = {
    requestId: 'req-1',
    instruction: 'add flask config command',
    mode: 'agent',
    explicitFileMentions: [],
    explicitSymbolMentions: [],
  };
  const stubContext: RepositoryContext = {
    requestId: 'req-1',
    relevantFiles: [],
    relevantSymbols: [],
    dependencyEdges: [],
    unresolvedImports: [],
    tokenEstimate: 0,
    tokenBudget: 16000,
    budgetConflicts: [],
    warnings: ['Repository intelligence is a stub: no files were retrieved.'],
  };
  const report = await createImpactAnalyser().analyseImpact(request, stubContext);
  assert.equal(report.summary.incomplete, true);
  assert.ok(report.warnings.length > 0);
  for (const key of ['affectedFiles', 'testCandidates', 'nodes', 'edges'] as const) {
    assert.ok(Array.isArray(report[key]));
  }
});

// ───────────────────────── Refresh ─────────────────────────

test('refresh: repeated calls reuse one cached graph and give identical reports', async () => {
  const analyser = createImpactAnalyser({ now: fixedClock });
  const before = await analyser.analyseImpact(miniFlask.request, miniFlask.context);
  // The agent's second call: same context, now with the proposed files.
  await analyser.analyseImpact(miniFlask.request, miniFlask.context, [MINI_FLASK_PATHS.cli]);
  const again = await analyser.analyseImpact(miniFlask.request, miniFlask.context);

  assert.deepEqual(again, before);
  assert.equal(analyser.invalidate(), 1, 'three calls with one context left one cached graph');
});

test('refresh: a changed context is analysed afresh, never from a stale graph', async () => {
  const P = MINI_FLASK_PATHS;
  const analyser = createImpactAnalyser({ now: fixedClock });
  const before = await analyser.analyseImpact(miniFlask.request, miniFlask.context);

  const extra = 'src/flask/blueprints.py';
  const changedContext = makeContext(miniFlask.context.requestId, {
    dependencyEdges: [...miniFlask.context.dependencyEdges, edge(extra, P.helpers)],
  });
  const after = await analyser.analyseImpact(miniFlask.request, changedContext);

  assert.ok(!affectedPaths(before).includes(extra));
  assert.ok(affectedPaths(after).includes(extra), 'the new dependant is found');
  assert.deepEqual(
    after,
    await createImpactAnalyser({ now: fixedClock }).analyseImpact(miniFlask.request, changedContext),
    'same as a service with an empty cache',
  );
});

test('refresh: invalidate(paths) clears the matching graphs and analysis still works', async () => {
  const P = MINI_FLASK_PATHS;
  const analyser = createImpactAnalyser({ now: fixedClock });
  const before = await analyser.analyseImpact(miniFlask.request, miniFlask.context);
  await analyser.analyseImpact(directImport.request, directImport.context);

  assert.equal(analyser.invalidate(['src/unrelated/file.py']), 0);
  assert.equal(analyser.invalidate([P.helpers]), 1, 'only the mini-Flask graph contains helpers.py');
  assert.equal(analyser.invalidate([P.helpers]), 0, 'already cleared');

  const after = await analyser.analyseImpact(miniFlask.request, miniFlask.context);
  assert.deepEqual(after, before, 'rebuilt, with the same result');
  assert.equal(analyser.invalidate(), 2, 'no argument clears everything that is left');
});

test('refresh: each service has its own cache', async () => {
  const first = createImpactAnalyser();
  const second = createImpactAnalyser();
  await first.analyseImpact(miniFlask.request, miniFlask.context);
  assert.equal(second.invalidate(), 0);
  assert.equal(first.invalidate(), 1);
});

// ───────────────────────── Module boundaries ─────────────────────────

test('purity: src/impact imports nothing that edits files, runs commands or uses the network', () => {
  // Compiled tests run from out/tests/unit/impact; the sources are four levels up.
  const sourceDir = resolve(__dirname, '../../../../src/impact');
  const files = readdirSync(sourceDir).filter((name) => name.endsWith('.ts'));
  assert.ok(files.includes('index.ts'), 'found the ImpactLens sources');

  const forbidden: Array<[RegExp, string]> = [
    [/from\s+['"]vscode['"]|require\(\s*['"]vscode['"]\s*\)/, 'vscode'],
    [/['"](?:node:)?(?:fs|fs\/promises|child_process|http|https|http2|net|dgram|tls|worker_threads)['"]/, 'a Node I/O module'],
    [/\bfetch\s*\(|XMLHttpRequest|WebSocket/, 'a network call'],
    [/process\.env/, 'environment variables'],
    [/openai|anthropic|generativelanguage|googleapis/i, 'a model provider'],
  ];
  const allowedRelativeImports = new Set(['../shared/contracts', '../mcp/tool-names']);

  for (const name of files) {
    const text = readFileSync(join(sourceDir, name), 'utf8');
    for (const [pattern, what] of forbidden) {
      assert.ok(!pattern.test(text), `${name} must not use ${what}`);
    }
    for (const match of text.matchAll(/from\s+['"](\.\.\/[^'"]+)['"]/g)) {
      const target = match[1] ?? '';
      assert.ok(allowedRelativeImports.has(target), `${name} imports ${target} from outside the module`);
    }
  }
});
