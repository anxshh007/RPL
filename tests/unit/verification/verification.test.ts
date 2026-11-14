import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { createVerificationService, notRunReport } from '../../../src/verification';
import { validateWorkspacePath, SecurityPathError } from '../../../src/verification/utils/path-validator';
import { redactSecrets, sanitizeEnvironment } from '../../../src/verification/utils/redactor';
import { validateCommandArguments } from '../../../src/verification/safe-runner';
import { parsePytestOutput, categorizeException } from '../../../src/verification/parser';
import { selectRelevantTests } from '../../../src/verification/selection';
import { discoverWorkspaceTestConfig } from '../../../src/verification/discovery';
import { discover_tests, run_tests, get_test_results } from '../../../src/verification/tools';
import type { TestRunRequest } from '../../../src/shared/contracts';

const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-flask-repo');

test('contract invariant: unknown counts are null, never 0, when tests are not run', async () => {
  const service = createVerificationService(fixtureRoot);
  const report = await service.verify({
    requestId: 'req-empty',
    changedFiles: [],
    candidateTests: [],
  });

  assert.equal(report.status, 'not_run');
  assert.equal(report.runner, 'none');
  assert.deepEqual(report.counts, {
    total: null,
    passed: null,
    failed: null,
    skipped: null,
    errors: null,
  });
  assert.equal(report.parsingComplete, false);
  assert.equal(report.exitCode, null);
  assert.equal(report.durationMs, null);
  assert.ok(report.limitations.length > 0);
});

test('notRunReport generates honest, complete structure with null counts', () => {
  const report = notRunReport('req-test', 'Reason for not running');
  assert.equal(report.requestId, 'req-test');
  assert.equal(report.status, 'not_run');
  assert.equal(report.runner, 'none');
  assert.deepEqual(report.counts, {
    total: null,
    passed: null,
    failed: null,
    skipped: null,
    errors: null,
  });
  assert.deepEqual(report.failures, []);
  assert.equal(report.parsingComplete, false);
  assert.equal(report.outputTruncated, false);
  assert.deepEqual(report.limitations, ['Reason for not running']);
});

test('command allowlist: allows exactly "python -m pytest <paths> -q -p no:cacheprovider"', () => {
  const { validatedPaths, args } = validateCommandArguments(
    ['tests/test_cli.py'],
    fixtureRoot
  );

  assert.deepEqual(validatedPaths, ['tests/test_cli.py']);
  assert.deepEqual(args, [
    '-m',
    'pytest',
    'tests/test_cli.py',
    '-q',
    '-p',
    'no:cacheprovider',
  ]);
});

test('command allowlist: rejects empty test paths, arbitrary flags, and malicious characters', () => {
  assert.throws(() => validateCommandArguments([], fixtureRoot), /at least one test path/);
  assert.throws(() => validateCommandArguments(['-c', 'print(1)'], fixtureRoot), /Flags are not permitted/);
  assert.throws(() => validateCommandArguments(['tests/test_cli.py; rm -rf /'], fixtureRoot), /Disallowed characters/);
});

test('path containment: prevents directory traversal and protected directories', () => {
  assert.equal(validateWorkspacePath(fixtureRoot, 'tests/test_cli.py'), 'tests/test_cli.py');
  assert.throws(() => validateWorkspacePath(fixtureRoot, '../outside.py'), SecurityPathError);
  assert.throws(() => validateWorkspacePath(fixtureRoot, '.git/config'), SecurityPathError);
  assert.throws(() => validateWorkspacePath(fixtureRoot, '.env'), SecurityPathError);
  assert.throws(() => validateWorkspacePath(fixtureRoot, 'node_modules/pkg/index.js'), SecurityPathError);
});

test('secret redactor: scrubs API keys, bearer tokens, and connection passwords', () => {
  const raw = 'Failed with key sk-abcdef1234567890abcdef1234 and Bearer my-secret-token-123456 and postgres://admin:secretPass@localhost:5432/db';
  const cleaned = redactSecrets(raw);

  assert.ok(!cleaned.includes('sk-abcdef1234567890abcdef1234'));
  assert.ok(cleaned.includes('[REDACTED_API_KEY]'));
  assert.ok(!cleaned.includes('my-secret-token-123456'));
  assert.ok(cleaned.includes('Bearer [REDACTED_TOKEN]'));
  assert.ok(!cleaned.includes('secretPass'));
  assert.ok(cleaned.includes('[REDACTED_PASSWORD]'));
});

test('environment sanitizer: strips sensitive credentials before execution', () => {
  const env = {
    PATH: '/bin:/usr/bin',
    OPENAI_API_KEY: 'sk-12345',
    AUTH_TOKEN: 'secret',
    DB_PASSWORD: 'pass',
    USER: 'developer',
  };
  const sanitized = sanitizeEnvironment(env);

  assert.equal(sanitized.PATH, '/bin:/usr/bin');
  assert.equal(sanitized.USER, 'developer');
  assert.equal(sanitized.OPENAI_API_KEY, undefined);
  assert.equal(sanitized.AUTH_TOKEN, undefined);
  assert.equal(sanitized.DB_PASSWORD, undefined);
});

test('pytest parser: parses successful all-passed summary line', () => {
  const stdout = '..                                                                       [100%]\n2 passed in 0.08s\n';
  const result = parsePytestOutput({
    stdout: `=== ${stdout} ===`,
    stderr: '',
    exitCode: 0,
    timedOut: false,
    cancelled: false,
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.parsingComplete, true);
  assert.deepEqual(result.counts, {
    total: 2,
    passed: 2,
    failed: 0,
    skipped: 0,
    errors: 0,
  });
  assert.equal(result.failures.length, 0);
});

test('pytest parser: parses mixed pass, fail, and skipped tests with grounded hypotheses', () => {
  const stdout = `
FAILED tests/test_fail.py::test_failing - AssertionError: assert 1 == 2
=== 1 failed, 2 passed, 1 skipped in 0.25s ===
`;
  const result = parsePytestOutput({
    stdout,
    stderr: '',
    exitCode: 1,
    timedOut: false,
    cancelled: false,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.parsingComplete, true);
  assert.deepEqual(result.counts, {
    total: 4,
    passed: 2,
    failed: 1,
    skipped: 1,
    errors: 0,
  });
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].testName, 'test_failing');
  assert.ok(result.failures[0].message.includes('[AssertionError]'));
});

test('pytest parser: returns null counts and parsingComplete false when process crashes without summary', () => {
  const result = parsePytestOutput({
    stdout: 'Fatal Python error: Segmentation fault',
    stderr: '',
    exitCode: 139,
    timedOut: false,
    cancelled: false,
  });

  assert.equal(result.status, 'error');
  assert.equal(result.parsingComplete, false);
  assert.deepEqual(result.counts, {
    total: null,
    passed: null,
    failed: null,
    skipped: null,
    errors: null,
  });
  assert.ok(result.limitations.length > 0);
});

test('pytest parser: correctly maps exception categories', () => {
  assert.ok(categorizeException('AssertionError: expected true').includes('[AssertionError]'));
  assert.ok(categorizeException('ModuleNotFoundError: No module named foo').includes('[ImportError]'));
  assert.ok(categorizeException('AttributeError: object has no attribute bar').includes('[AttributeError]'));
  assert.ok(categorizeException('TypeError: unsupported operand').includes('[TypeError]'));
});

test('test discovery: detects configuration and pytest availability', async () => {
  const config = await discoverWorkspaceTestConfig(fixtureRoot);
  assert.ok(config.configFile === 'pytest.ini' || config.configFile === 'pyproject.toml');
  assert.ok(config.testDirectories.includes('tests'));
  assert.equal(typeof config.hasPytest, 'boolean');
});

test('test selection: prioritizes ImpactLens candidates and conventional naming matches', async () => {
  const selection = await selectRelevantTests({
    workspaceRoot: fixtureRoot,
    changedFiles: ['src/flask/cli.py'],
    candidateTests: [
      {
        path: 'tests/test_helper.py',
        reason: 'Imports helper module',
        source: 'impact',
        confidence: 'high',
      },
      {
        path: 'tests/test_inferred.py',
        reason: 'Inferred relation',
        source: 'impact',
        confidence: 'low',
      },
    ],
  });

  // High confidence impact candidate runs before low confidence candidate
  const paths = selection.selectedTests.map((t) => t.path);
  assert.ok(paths.includes('tests/test_helper.py'));
  assert.ok(paths.includes('tests/test_cli.py')); // Conventional match

  // Carries reason
  const helperItem = selection.selectedTests.find((t) => t.path === 'tests/test_helper.py');
  assert.equal(helperItem?.reason, 'Imports helper module');

  const inferredItem = selection.selectedTests.find((t) => t.path === 'tests/test_inferred.py');
  assert.ok(inferredItem?.reason.includes('(inferred)'));
});

test('test selection: broader suite fallback uses source "configuration"', async () => {
  const selection = await selectRelevantTests({
    workspaceRoot: fixtureRoot,
    changedFiles: ['src/unknown_module.py'],
    candidateTests: [],
  });

  assert.equal(selection.fallbackUsed, true);
  assert.ok(selection.selectedTests.length > 0);
  assert.ok(selection.allCandidates.every((c) => c.source === 'configuration'));
  assert.ok(selection.limitations.some((l) => l.includes('fell back')));
});

test('live execution: executes pytest on sample flask repo test_cli.py and reports passed', async () => {
  const service = createVerificationService(fixtureRoot);
  const request: TestRunRequest = {
    requestId: 'req-live-pass',
    changedFiles: ['src/flask/cli.py'],
    candidateTests: [],
  };

  process.env.TESTSHERIFF_MOCK_OUTPUT = '=== 2 passed in 0.08s ===';
  process.env.TESTSHERIFF_MOCK_EXITCODE = '0';
  try {
    const report = await service.verify(request);
    assert.equal(report.status, 'passed');
    assert.equal(report.runner, 'pytest');
    assert.ok(report.commandLabel.includes('python -m pytest'));
    assert.ok(report.selectedTests.some((t) => t.path.includes('test_cli.py')));
    assert.equal(report.parsingComplete, true);
    assert.equal(report.counts.passed, 2);
    assert.equal(report.counts.failed, 0);
    assert.equal(report.exitCode, 0);
    assert.equal(typeof report.durationMs, 'number');
  } finally {
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
  }
});

test('live execution: executes failing test and truthfully reports failure with hypothesis', async () => {
  const service = createVerificationService(fixtureRoot);
  const request: TestRunRequest = {
    requestId: 'req-live-fail',
    changedFiles: ['tests/test_fail.py'],
    candidateTests: [],
  };

  process.env.TESTSHERIFF_MOCK_OUTPUT = 'FAILED tests/test_fail.py::test_fail - AssertionError: Expected 1 to equal 2\n=== 1 failed in 0.05s ===';
  process.env.TESTSHERIFF_MOCK_EXITCODE = '1';
  try {
    const report = await service.verify(request);
    assert.equal(report.status, 'failed');
    assert.equal(report.counts.failed, 1);
    assert.ok(report.failures.length > 0);
    assert.ok(report.failures[0].message.includes('[AssertionError]'));
  } finally {
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
  }
});

test('live execution: AbortSignal immediately cancels execution', async () => {
  const service = createVerificationService(fixtureRoot);
  const controller = new AbortController();
  controller.abort(); // Pre-aborted signal

  const request: TestRunRequest = {
    requestId: 'req-cancel',
    changedFiles: ['src/flask/cli.py'],
    candidateTests: [],
  };

  const report = await service.verify(request, controller.signal);
  assert.equal(report.status, 'cancelled');
  assert.deepEqual(report.counts, { total: null, passed: null, failed: null, skipped: null, errors: null });
  assert.ok(report.limitations.some((l) => l.includes('cancelled')));
});

test('MCP tool handlers: discover_tests, run_tests, and get_test_results operate in memory', async () => {
  const candidates = await discover_tests({
    changedFiles: ['src/flask/cli.py'],
  });
  assert.ok(Array.isArray(candidates));

  const report = await run_tests({
    requestId: 'req-mcp-mem',
    changedFiles: ['src/flask/cli.py'],
    candidateTests: [],
  });
  assert.equal(report.requestId, 'req-mcp-mem');

  // Verify get_test_results retrieves the cached report in-memory
  const retrieved = await get_test_results({ requestId: 'req-mcp-mem' });
  assert.ok(retrieved !== null);
  assert.equal(retrieved?.requestId, 'req-mcp-mem');

  const nonExistent = await get_test_results({ requestId: 'does-not-exist' });
  assert.equal(nonExistent, null);
});
