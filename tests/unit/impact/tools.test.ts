import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createImpactAnalyser } from '../../../src/impact';
import {
  IMPACT_TOOL_DEFINITIONS,
  IMPACT_TOOL_INPUT_SCHEMA,
  createImpactToolHandlers,
  handleAnalyseImpact,
  handleGetImpactGraph,
  validateImpactToolInput,
} from '../../../src/impact/tools';
import type { ToolResult } from '../../../src/impact/tools';
import { READ_ONLY_TOOLS, TOOL_NAMES } from '../../../src/mcp/tool-names';
import { RepoPilotError } from '../../../src/shared/contracts';
import type {
  DependencyEdge,
  ImpactAnalyser,
  ImpactReport,
  SafeError,
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
} from '../../fixtures/impact';

const { a: A, b: B } = BASIC_PATHS;
const fixedClock = (): Date => new Date('2026-01-01T00:00:00.000Z');

function newAnalyser(): ReturnType<typeof createImpactAnalyser> {
  return createImpactAnalyser({ now: fixedClock });
}

const validInput = { request: miniFlask.request, context: miniFlask.context };

/** Unwraps a failed result, failing the test if the call succeeded. */
function errorOf(result: ToolResult<unknown>): SafeError {
  assert.equal(result.ok, false, 'expected the tool to return an error');
  if (result.ok) {
    throw new Error('unreachable');
  }
  assert.deepEqual(Object.keys(result.error).sort(), ['kind', 'message', 'retryable']);
  return result.error;
}

/** Unwraps a successful result, failing the test if the call returned an error. */
function valueOf<T>(result: ToolResult<T>): T {
  if (!result.ok) {
    assert.fail(`expected success, got ${result.error.kind}: ${result.error.message}`);
  }
  return result.value;
}

// ───────────────────────── Names and descriptions ─────────────────────────

test('tools: the two tools use the canonical names and are read-only', () => {
  assert.deepEqual(
    IMPACT_TOOL_DEFINITIONS.map((tool) => tool.name),
    [TOOL_NAMES.analyseImpact, TOOL_NAMES.getImpactGraph],
  );
  assert.deepEqual(
    IMPACT_TOOL_DEFINITIONS.map((tool) => tool.name),
    ['analyse_impact', 'get_impact_graph'],
  );
  for (const tool of IMPACT_TOOL_DEFINITIONS) {
    assert.ok(READ_ONLY_TOOLS.has(tool.name), `${tool.name} is in the read-only set`);
    assert.equal(tool.readOnly, true);
    assert.ok(tool.description.length > 40, `${tool.name} has a description`);
    assert.ok(tool.outputDescription.length > 20, `${tool.name} describes its output`);
    assert.equal(tool.inputSchema, IMPACT_TOOL_INPUT_SCHEMA);
  }
  assert.match(IMPACT_TOOL_DEFINITIONS[0]?.description ?? '', /does not prove runtime impact/);
});

test('tools: the input description names the required fields', () => {
  assert.equal(IMPACT_TOOL_INPUT_SCHEMA.type, 'object');
  assert.deepEqual(IMPACT_TOOL_INPUT_SCHEMA.required, ['request', 'context']);
  assert.deepEqual(Object.keys(IMPACT_TOOL_INPUT_SCHEMA.properties), [
    'request',
    'context',
    'proposedFiles',
  ]);
  assert.deepEqual(IMPACT_TOOL_INPUT_SCHEMA.properties.context.required, [
    'requestId',
    'dependencyEdges',
    'unresolvedImports',
  ]);
  assert.deepEqual(
    IMPACT_TOOL_INPUT_SCHEMA.properties.context.properties.dependencyEdges.items.required,
    ['from', 'to', 'kind', 'evidence'],
  );
});

test('tools: createImpactToolHandlers returns one plain function per tool name', () => {
  const handlers = createImpactToolHandlers();
  assert.deepEqual(Object.keys(handlers).sort(), ['analyse_impact', 'get_impact_graph']);
  assert.equal(typeof handlers[TOOL_NAMES.analyseImpact], 'function');
  assert.equal(typeof handlers[TOOL_NAMES.getImpactGraph], 'function');
});

// ───────────────────────── Successful calls ─────────────────────────

test('analyse_impact: valid input returns the same report as the analyser', async () => {
  const expected = await newAnalyser().analyseImpact(miniFlask.request, miniFlask.context);
  const result = await handleAnalyseImpact(newAnalyser(), validInput);
  assert.deepEqual(result, { ok: true, value: expected });
});

test('analyse_impact: proposed files are passed through', async () => {
  const P = MINI_FLASK_PATHS;
  const report = valueOf(
    await handleAnalyseImpact(newAnalyser(), { ...validInput, proposedFiles: [P.cli] }),
  );
  assert.deepEqual(report.changedTargets, [P.cli]);
  assert.deepEqual(
    report.affectedFiles.map((f) => f.path),
    [P.testCli, P.docsCli],
  );
});

test('get_impact_graph: valid input returns the graph part of the report', async () => {
  const report = await newAnalyser().analyseImpact(miniFlask.request, miniFlask.context);
  const result = await handleGetImpactGraph(newAnalyser(), validInput);
  assert.deepEqual(result, {
    ok: true,
    value: {
      requestId: report.requestId,
      generatedAt: report.generatedAt,
      changedTargets: report.changedTargets,
      nodes: report.nodes,
      edges: report.edges,
      warnings: report.warnings,
      incomplete: report.summary.incomplete,
    },
  });
  const graph = valueOf(result);
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.edges.length, 3);
  assert.ok(!('affectedFiles' in graph), 'the per-file explanations are not included');
});

test('tools: every fixture succeeds through both handlers', async () => {
  const handlers = createImpactToolHandlers(newAnalyser());
  for (const fixture of allFixtures) {
    const input = {
      request: fixture.request,
      context: fixture.context,
      ...(fixture.proposedFiles ? { proposedFiles: fixture.proposedFiles } : {}),
    };
    const report = valueOf(await handlers[TOOL_NAMES.analyseImpact](input));
    const graph = valueOf(await handlers[TOOL_NAMES.getImpactGraph](input));
    assert.equal(report.requestId, fixture.request.requestId, fixture.name);
    assert.deepEqual(graph.nodes, report.nodes, fixture.name);
    assert.deepEqual(graph.edges, report.edges, fixture.name);
  }
});

test('tools: bad paths and malformed edges are warnings in the report, not errors', async () => {
  const junk = [edge(B, A), null, { from: 1, to: 2 }] as unknown as DependencyEdge[];
  const input = {
    request: makeRequest('r'),
    context: makeContext('r', { dependencyEdges: junk }),
    proposedFiles: [A, '/etc/passwd', '../outside.py'],
  };
  const report = valueOf(await handleAnalyseImpact(newAnalyser(), input));
  assert.deepEqual(report.changedTargets, [A]);
  assert.deepEqual(
    report.affectedFiles.map((f) => f.path),
    [B],
  );
  assert.equal(report.summary.incomplete, true);
  assert.equal(report.warnings.length, 3);
});

// ───────────────────────── Validation errors ─────────────────────────

test('validation: input that is not an object is rejected', async () => {
  for (const input of [undefined, null, 'analyse', 42, [], [validInput]]) {
    for (const [name, call] of [
      ['analyse_impact', handleAnalyseImpact],
      ['get_impact_graph', handleGetImpactGraph],
    ] as const) {
      const error = errorOf(await call(newAnalyser(), input));
      assert.deepEqual(error, {
        kind: 'validation',
        message: `Invalid input for ${name}: input must be an object with "request" and "context".`,
        retryable: false,
      });
    }
  }
});

test('validation: each wrong or missing field is named', async () => {
  const request = { ...miniFlask.request };
  const context = { ...miniFlask.context };
  const cases: Array<[string, unknown, string]> = [
    ['no request', { context }, 'request must be an object'],
    ['no context', { request }, 'context must be an object'],
    ['request is a string', { request: 'x', context }, 'request must be an object'],
    ['context is a list', { request, context: [] }, 'context must be an object'],
    ['empty requestId', { request: { ...request, requestId: ' ' }, context }, 'request.requestId must be a non-empty string'],
    ['numeric requestId', { request: { ...request, requestId: 7 }, context }, 'request.requestId must be a non-empty string'],
    ['no instruction', { request: { ...request, instruction: undefined }, context }, 'request.instruction must be a string'],
    ['bad mode', { request: { ...request, mode: 'auto' }, context }, 'request.mode must be "inline" or "agent"'],
    ['numeric activeFile', { request: { ...request, activeFile: 5 }, context }, 'request.activeFile must be a string when present'],
    ['mentions not a list', { request: { ...request, explicitFileMentions: 'a.py' }, context }, 'request.explicitFileMentions must be an array of strings'],
    ['mentions with a number', { request: { ...request, explicitFileMentions: ['a.py', 3] }, context }, 'request.explicitFileMentions must be an array of strings'],
    ['symbols missing', { request: { ...request, explicitSymbolMentions: null }, context }, 'request.explicitSymbolMentions must be an array of strings'],
    ['context id missing', { request, context: { ...context, requestId: undefined } }, 'context.requestId must be a string'],
    ['edges missing', { request, context: { ...context, dependencyEdges: undefined } }, 'context.dependencyEdges must be an array'],
    ['edges an object', { request, context: { ...context, dependencyEdges: {} } }, 'context.dependencyEdges must be an array'],
    ['unresolved missing', { request, context: { ...context, unresolvedImports: null } }, 'context.unresolvedImports must be an array'],
    ['proposed not a list', { request, context, proposedFiles: 'a.py' }, 'proposedFiles must be an array of strings when present'],
    ['proposed with a number', { request, context, proposedFiles: ['a.py', 1] }, 'proposedFiles must be an array of strings when present'],
  ];

  for (const [label, input, problem] of cases) {
    const error = errorOf(await handleAnalyseImpact(newAnalyser(), input));
    assert.deepEqual(
      error,
      { kind: 'validation', message: `Invalid input for analyse_impact: ${problem}.`, retryable: false },
      label,
    );
  }
});

test('validation: several problems are reported together', () => {
  const result = validateImpactToolInput(TOOL_NAMES.getImpactGraph, {
    request: { requestId: '', mode: 'x' },
    context: {},
    proposedFiles: 3,
  });
  assert.equal(
    errorOf(result).message,
    'Invalid input for get_impact_graph: request.requestId must be a non-empty string; ' +
      'request.instruction must be a string; request.mode must be "inline" or "agent"; ' +
      'request.explicitFileMentions must be an array of strings; ' +
      'request.explicitSymbolMentions must be an array of strings; ' +
      'context.requestId must be a string; context.dependencyEdges must be an array; ' +
      'context.unresolvedImports must be an array; ' +
      'proposedFiles must be an array of strings when present.',
  );
});

test('validation: the message never echoes input values', async () => {
  const secret = 'SECRET_TOKEN_abc123';
  const input = {
    request: { ...miniFlask.request, mode: secret, activeFile: { key: secret } },
    context: { ...miniFlask.context, dependencyEdges: secret },
    proposedFiles: [secret, 9],
  };
  const error = errorOf(await handleAnalyseImpact(newAnalyser(), input));
  assert.equal(error.kind, 'validation');
  assert.ok(!error.message.includes(secret));
});

test('validation: valid input is returned typed, with optional fields only when given', () => {
  const plain = valueOf(validateImpactToolInput(TOOL_NAMES.analyseImpact, validInput));
  assert.equal(plain.request, miniFlask.request);
  assert.equal(plain.context, miniFlask.context);
  assert.ok(!('proposedFiles' in plain));

  const withFiles = valueOf(
    validateImpactToolInput(TOOL_NAMES.analyseImpact, { ...validInput, proposedFiles: [A], extra: 1 }),
  );
  assert.deepEqual(withFiles.proposedFiles, [A]);
  assert.ok(!('extra' in withFiles), 'unknown fields are dropped');
});

// ───────────────────────── Other errors ─────────────────────────

test('errors: an already cancelled signal returns a "cancelled" error', async () => {
  const controller = new AbortController();
  controller.abort();
  for (const call of [handleAnalyseImpact, handleGetImpactGraph]) {
    const error = errorOf(await call(newAnalyser(), validInput, controller.signal));
    assert.deepEqual(error, { kind: 'cancelled', message: 'Request cancelled.', retryable: false });
  }
});

test('errors: a live signal is passed through to the analyser', async () => {
  const seen: Array<AbortSignal | undefined> = [];
  const spy: ImpactAnalyser = {
    async analyseImpact(request, context, proposedFiles, signal): Promise<ImpactReport> {
      seen.push(signal);
      return newAnalyser().analyseImpact(request, context, proposedFiles, signal);
    },
  };
  const controller = new AbortController();
  valueOf(await handleAnalyseImpact(spy, validInput, controller.signal));
  assert.deepEqual(seen, [controller.signal]);
});

test('errors: an analyser failure becomes a SafeError without leaking details', async () => {
  const failing: ImpactAnalyser = {
    async analyseImpact(): Promise<ImpactReport> {
      throw new Error('boom: API_KEY=sk-secret');
    },
  };
  const error = errorOf(await handleAnalyseImpact(failing, validInput));
  assert.equal(error.kind, 'internal');
  assert.equal(error.retryable, false);
  assert.ok(!error.message.includes('sk-secret'));

  const classified: ImpactAnalyser = {
    async analyseImpact(): Promise<ImpactReport> {
      throw new RepoPilotError('timeout', 'Impact analysis timed out.', true);
    },
  };
  assert.deepEqual(errorOf(await handleGetImpactGraph(classified, validInput)), {
    kind: 'timeout',
    message: 'Impact analysis timed out.',
    retryable: true,
  });
});

test('errors: input that throws when read is handled, not thrown', async () => {
  const hostile = {
    get request(): never {
      throw new Error('trap');
    },
    context: miniFlask.context,
  };
  const error = errorOf(await handleAnalyseImpact(newAnalyser(), hostile));
  assert.equal(error.kind, 'internal');
});

// ───────────────────────── Sharing and purity ─────────────────────────

test('tools: handlers bound to the agent’s analyser share its graph cache', async () => {
  const analyser = newAnalyser();
  const handlers = createImpactToolHandlers(analyser);

  await analyser.analyseImpact(miniFlask.request, miniFlask.context);
  valueOf(await handlers[TOOL_NAMES.analyseImpact](validInput));
  valueOf(await handlers[TOOL_NAMES.getImpactGraph](validInput));
  assert.equal(analyser.invalidate(), 1, 'one graph was built and reused by all three calls');
});

test('tools: the input is not modified and results are deterministic', async () => {
  const input = { request: directImport.request, context: directImport.context, proposedFiles: [A] };
  const before = JSON.stringify(input);
  const handlers = createImpactToolHandlers(newAnalyser());

  const first = await handlers[TOOL_NAMES.analyseImpact](input);
  const second = await handlers[TOOL_NAMES.analyseImpact](input);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(input), before);
});
