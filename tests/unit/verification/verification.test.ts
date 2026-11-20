import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createVerificationService,
  notRunReport,
  createVerificationToolHandlers,
  type ProcessRunner,
} from '../../../src/verification';
import { validateWorkspacePath, SecurityPathError } from '../../../src/verification/utils/path-validator';
import { redactSecrets, sanitizeEnvironment } from '../../../src/verification/utils/redactor';
import { validateCommandArguments } from '../../../src/verification/safe-runner';
import { parsePytestOutput, categorizeException } from '../../../src/verification/parser';
import { isPytestVersionOutput, PROBE_TIMEOUT_MS } from '../../../src/verification/discovery';
import { selectRelevantTests } from '../../../src/verification/selection';
import { discoverWorkspaceTestConfig, detectPytestRunner, clearRunnerCache } from '../../../src/verification/discovery';
import type { TestRunRequest } from '../../../src/shared/contracts';

const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-flask-repo');

const hasLocalPytest = (() => {
  try {
    const probe = spawnSync('python', ['-m', 'pytest', '--version'], { shell: false });
    return probe.status === 0;
  } catch {
    return false;
  }
})();

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

test('command allowlist: allows exactly "python -m pytest -o addopts= -p no:cacheprovider -q -rfE <paths>"', () => {
  const { validatedPaths, args } = validateCommandArguments(
    ['tests/test_cli.py'],
    fixtureRoot
  );

  assert.deepEqual(validatedPaths, ['tests/test_cli.py']);
  assert.deepEqual(args, [
    '-m',
    'pytest',
    '-o',
    'addopts=',
    '-p',
    'no:cacheprovider',
    '-q',
    '-rfE',
    'tests/test_cli.py',
  ]);
});

test('command allowlist: rejects empty test paths, arbitrary flags, and malicious characters', () => {
  assert.throws(() => validateCommandArguments([], fixtureRoot), /at least one test path/);
  assert.throws(() => validateCommandArguments(['-c', 'print(1)'], fixtureRoot), /Flags are not permitted/);
  assert.throws(() => validateCommandArguments(['tests/test_cli.py; rm -rf /'], fixtureRoot), /Disallowed characters/);
});

test('path containment: prevents directory traversal, protected directories, and absolute paths', () => {
  assert.equal(validateWorkspacePath(fixtureRoot, 'tests/test_cli.py'), 'tests/test_cli.py');
  assert.throws(() => validateWorkspacePath(fixtureRoot, '../outside.py'), SecurityPathError);
  assert.throws(() => validateWorkspacePath(fixtureRoot, '.git/config'), SecurityPathError);
  assert.throws(() => validateWorkspacePath(fixtureRoot, '.env'), SecurityPathError);
  assert.throws(() => validateWorkspacePath(fixtureRoot, 'node_modules/pkg/index.js'), SecurityPathError);
  // Rule 8: reject absolute paths
  assert.throws(() => validateWorkspacePath(fixtureRoot, '/etc/passwd'), SecurityPathError);
  assert.throws(() => validateWorkspacePath(fixtureRoot, 'C:\\Windows\\system32'), SecurityPathError);
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

test('pytest parser: falls back to exit codes when summary line is absent', () => {
  // exit code 0 -> passed (counts null)
  const passedResult = parsePytestOutput({
    stdout: 'Just some unformatted output with no summary',
    stderr: '',
    exitCode: 0,
    timedOut: false,
    cancelled: false,
  });
  assert.equal(passedResult.status, 'passed');
  assert.equal(passedResult.parsingComplete, false);
  assert.deepEqual(passedResult.counts, { total: null, passed: null, failed: null, skipped: null, errors: null });

  // exit code 1 -> failed (counts null)
  const failedResult = parsePytestOutput({
    stdout: 'Failure occurred somewhere',
    stderr: '',
    exitCode: 1,
    timedOut: false,
    cancelled: false,
  });
  assert.equal(failedResult.status, 'failed');
  assert.equal(failedResult.parsingComplete, false);
  assert.deepEqual(failedResult.counts, { total: null, passed: null, failed: null, skipped: null, errors: null });

  // exit code 5 -> not_run (no tests collected)
  const notRunResult = parsePytestOutput({
    stdout: 'No tests collected',
    stderr: '',
    exitCode: 5,
    timedOut: false,
    cancelled: false,
  });
  assert.equal(notRunResult.status, 'not_run');
  assert.equal(notRunResult.parsingComplete, false);
  assert.deepEqual(notRunResult.counts, { total: null, passed: null, failed: null, skipped: null, errors: null });
  assert.ok(notRunResult.limitations.some((l) => l.includes('exit code 5')));

  // exit code 2/3/4 -> error
  const errResult = parsePytestOutput({
    stdout: 'Fatal error',
    stderr: '',
    exitCode: 4,
    timedOut: false,
    cancelled: false,
  });
  assert.equal(errResult.status, 'error');
  assert.equal(errResult.parsingComplete, false);
});

test('pytest parser: correctly maps exception categories', () => {
  assert.ok(categorizeException('AssertionError: expected true').includes('[AssertionError]'));
  assert.ok(categorizeException('ModuleNotFoundError: No module named foo').includes('[ImportError]'));
  assert.ok(categorizeException('AttributeError: object has no attribute bar').includes('[AttributeError]'));
  assert.ok(categorizeException('TypeError: unsupported operand').includes('[TypeError]'));
});

test('test discovery: detects configuration and pytest availability asynchronously', async () => {
  clearRunnerCache();
  const config = await discoverWorkspaceTestConfig(fixtureRoot);
  assert.ok(config.configFile === 'pytest.ini' || config.configFile === 'pyproject.toml');
  assert.ok(config.testDirectories.includes('tests'));
  assert.equal(typeof config.hasPytest, 'boolean');

  // Verify caching does not block or throw
  const cachedProbe = await detectPytestRunner(fixtureRoot);
  assert.equal(typeof cachedProbe.executable, config.hasPytest ? 'string' : 'object');
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

  const paths = selection.selectedTests.map((t) => t.path);
  assert.ok(paths.includes('tests/test_helper.py'));
  assert.ok(paths.includes('tests/test_cli.py')); // Conventional match

  const helperItem = selection.selectedTests.find((t) => t.path === 'tests/test_helper.py');
  assert.equal(helperItem?.reason, 'Imports helper module');
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

test('test selection: drops invalid, traversal, absolute, and missing test candidates safely', async () => {
  const selection = await selectRelevantTests({
    workspaceRoot: fixtureRoot,
    changedFiles: [],
    candidateTests: [
      { path: '../../etc/x.py', reason: 'traversal attempt', source: 'impact', confidence: 'high' },
      { path: '/absolute/path.py', reason: 'absolute path', source: 'impact', confidence: 'high' },
      { path: 'tests/non_existent_file.py', reason: 'missing file', source: 'impact', confidence: 'high' },
      { path: 'tests/test_helper.py', reason: 'valid test', source: 'impact', confidence: 'high' },
    ],
  });

  assert.equal(selection.selectedTests.length, 1);
  assert.equal(selection.selectedTests[0].path, 'tests/test_helper.py');
  assert.ok(selection.limitations.some((l) => l.includes('../../etc/x.py')));
  assert.ok(selection.limitations.some((l) => l.includes('/absolute/path.py')));
  assert.ok(selection.limitations.some((l) => l.includes('non_existent_file.py')));
});

test('service invariant: verify() never throws on invalid or malicious candidates', async () => {
  const service = createVerificationService(fixtureRoot);

  // Case A: invalid candidates with no changed files -> drops candidates and returns not_run safely
  const reportA = await service.verify({
    requestId: 'req-safe-a',
    changedFiles: [],
    candidateTests: [
      { path: '../../etc/x.py', reason: 'traversal', source: 'impact', confidence: 'high' },
      { path: '/absolute/path.py', reason: 'absolute', source: 'impact', confidence: 'high' },
    ],
  });
  assert.equal(reportA.status, 'not_run');
  assert.ok(reportA.limitations.some((l) => l.includes('../../etc/x.py')));
  assert.ok(reportA.limitations.some((l) => l.includes('/absolute/path.py')));

  // Case B: invalid candidate with changedFiles -> drops candidate and falls back safely
  const reportB = await service.verify({
    requestId: 'req-safe-b',
    changedFiles: ['../../../etc/evil.py'],
    candidateTests: [
      { path: '../../etc/x.py', reason: 'traversal', source: 'impact', confidence: 'high' },
    ],
  });
  assert.ok(reportB.status === 'failed' || reportB.status === 'passed');
  assert.ok(reportB.limitations.some((l) => l.includes('../../etc/x.py')));
});

test('service invariant: requires workspaceRoot and does not fall back to process.cwd()', async () => {
  const service = createVerificationService('');
  const report = await service.verify({
    requestId: 'req-no-root',
    changedFiles: ['tests/test_helper.py'],
    candidateTests: [],
  });

  assert.equal(report.status, 'not_run');
  assert.ok(report.limitations.some((l) => l.includes('workspaceRoot is required')));
});

test('runner injection: accepts custom ProcessRunner for unit testing without mock switch', async () => {
  const customRunner: ProcessRunner = async (params) => {
    return {
      commandLabel: `custom-runner ${params.testPaths.join(' ')}`,
      exitCode: 0,
      durationMs: 25,
      stdout: '=== 1 passed in 0.05s ===',
      stderr: '',
      timedOut: false,
      cancelled: false,
      truncated: false,
      limitations: [],
    };
  };

  const service = createVerificationService({
    workspaceRoot: fixtureRoot,
    runProcess: customRunner,
  });

  const report = await service.verify({
    requestId: 'req-injected',
    changedFiles: ['tests/test_helper.py'],
    candidateTests: [],
  });

  assert.equal(report.status, 'passed');
  assert.equal(report.counts.passed, 1);
  assert.equal(report.commandLabel, 'custom-runner tests/test_helper.py');
});

test('live execution: executes pytest on sample flask repo test_helper.py and reports passed 1/1', async (t) => {
  if (!hasLocalPytest) {
    t.skip('pytest not installed in environment');
    return;
  }

  const service = createVerificationService(fixtureRoot);
  const report = await service.verify({
    requestId: 'req-live-helper',
    changedFiles: ['tests/test_helper.py'],
    candidateTests: [],
  });

  assert.equal(report.status, 'passed');
  assert.equal(report.runner, 'pytest');
  assert.equal(report.counts.passed, 1);
  assert.equal(report.counts.failed, 0);
  assert.equal(report.counts.total, 1);
  assert.equal(report.exitCode, 0);
  assert.equal(report.parsingComplete, true);
});

test('live execution: parses real counts truthfully when host environment has PY_COLORS or FORCE_COLOR set', async (t) => {
  if (!hasLocalPytest) {
    t.skip('pytest not installed in environment');
    return;
  }

  const origPyColors = process.env.PY_COLORS;
  const origForceColor = process.env.FORCE_COLOR;

  try {
    process.env.PY_COLORS = '1';
    process.env.FORCE_COLOR = '1';

    const service = createVerificationService(fixtureRoot);
    const report = await service.verify({
      requestId: 'req-live-color',
      changedFiles: ['tests/test_helper.py'],
      candidateTests: [],
    });

    assert.equal(report.status, 'passed');
    assert.equal(report.counts.passed, 1);
    assert.equal(report.counts.failed, 0);
    assert.equal(report.counts.total, 1);
    assert.equal(report.parsingComplete, true);
  } finally {
    if (origPyColors !== undefined) {
      process.env.PY_COLORS = origPyColors;
    } else {
      delete process.env.PY_COLORS;
    }
    if (origForceColor !== undefined) {
      process.env.FORCE_COLOR = origForceColor;
    } else {
      delete process.env.FORCE_COLOR;
    }
  }
});

test('live execution: executes failing test and truthfully reports failure', async (t) => {
  if (!hasLocalPytest) {
    t.skip('pytest not installed in environment');
    return;
  }

  const service = createVerificationService(fixtureRoot);
  const report = await service.verify({
    requestId: 'req-live-fail',
    changedFiles: ['tests/test_fail.py'],
    candidateTests: [],
  });

  assert.equal(report.status, 'failed');
  assert.equal(report.counts.failed, 1);
  assert.equal(report.counts.passed, 0);
  assert.ok(report.failures.length > 0);
  assert.ok(report.failures[0].message.includes('[AssertionError]'));
});

test('live execution: fallback suite reports 4 passed, 1 failed in fixture with existing -q config', async (t) => {
  if (!hasLocalPytest) {
    t.skip('pytest not installed in environment');
    return;
  }

  const service = createVerificationService(fixtureRoot);
  const report = await service.verify({
    requestId: 'req-live-fallback',
    changedFiles: ['src/unknown_module.py'],
    candidateTests: [],
  });

  assert.equal(report.status, 'failed');
  assert.equal(report.counts.passed, 4);
  assert.equal(report.counts.failed, 1);
  assert.equal(report.counts.total, 5);
  assert.equal(report.exitCode, 1);
  assert.equal(report.parsingComplete, true);
});

test('live execution: AbortSignal immediately cancels execution', async () => {
  const service = createVerificationService(fixtureRoot);
  const controller = new AbortController();
  controller.abort();

  const report = await service.verify({
    requestId: 'req-cancel',
    changedFiles: ['tests/test_helper.py'],
    candidateTests: [],
  }, controller.signal);

  assert.equal(report.status, 'cancelled');
  assert.deepEqual(report.counts, { total: null, passed: null, failed: null, skipped: null, errors: null });
  assert.ok(report.limitations.some((l) => l.includes('cancelled')));
});

test('live execution: mid-flight AbortSignal after process starts reports status "cancelled" with exitCode null', async (t) => {
  if (!hasLocalPytest) {
    t.skip('pytest not installed in environment');
    return;
  }

  const service = createVerificationService(fixtureRoot);
  const controller = new AbortController();

  // Cancel mid-flight while pytest is actively running the full fixture suite (50 ms is within execution on both Linux and Windows)
  const timer = setTimeout(() => {
    controller.abort();
  }, 50);

  const report = await service.verify({
    requestId: 'req-midflight-cancel',
    changedFiles: ['src/unknown_module.py'],
    candidateTests: [],
  }, controller.signal);

  clearTimeout(timer);

  assert.equal(report.status, 'cancelled');
  assert.equal(report.exitCode, null);
  assert.deepEqual(report.counts, { total: null, passed: null, failed: null, skipped: null, errors: null });
  assert.ok(report.limitations.some((l) => l.toLowerCase().includes('cancelled')));
});

test('MCP tool handlers: createVerificationToolHandlers shares service and returns { ok, value }', async () => {
  const customRunner: ProcessRunner = async () => ({
    commandLabel: 'pytest',
    exitCode: 0,
    durationMs: 10,
    stdout: '=== 1 passed in 0.01s ===',
    stderr: '',
    timedOut: false,
    cancelled: false,
    truncated: false,
    limitations: [],
  });

  const service = createVerificationService({
    workspaceRoot: fixtureRoot,
    runProcess: customRunner,
  });

  const handlers = createVerificationToolHandlers(service);

  const discResult = await handlers.discover_tests({
    changedFiles: ['src/flask/cli.py'],
  });
  assert.equal(discResult.ok, true);
  if (discResult.ok) {
    assert.ok(Array.isArray(discResult.value));
  }

  const runResult = await handlers.run_tests({
    requestId: 'req-tool-share',
    changedFiles: ['tests/test_helper.py'],
    candidateTests: [],
  });
  assert.equal(runResult.ok, true);
  if (runResult.ok) {
    assert.equal(runResult.value.requestId, 'req-tool-share');
    assert.equal(runResult.value.status, 'passed');
  }

  // Verify get_test_results shares the same service and returns the report
  const getResult = await handlers.get_test_results({ requestId: 'req-tool-share' });
  assert.equal(getResult.ok, true);
  if (getResult.ok) {
    assert.ok(getResult.value !== null);
    assert.equal(getResult.value?.requestId, 'req-tool-share');
  }

  const nonExistent = await handlers.get_test_results({ requestId: 'does-not-exist' });
  assert.equal(nonExistent.ok, true);
  if (nonExistent.ok) {
    assert.equal(nonExistent.value, null);
  }
});

test('runner detection: only a clean exit that prints the pytest version counts', () => {
  assert.equal(isPytestVersionOutput(0, 'pytest 9.2.0\n'), true);
  assert.equal(isPytestVersionOutput(0, 'pytest 8.3.4'), true);
  // Windows py launcher pointing at a missing Python: mentions "pytest" but failed
  assert.equal(
    isPytestVersionOutput(101, "Unable to create process using 'C:\\Python314\\python.exe -m pytest --version': The system cannot find the file specified."),
    false,
  );
  assert.equal(isPytestVersionOutput(1, 'No module named pytest'), false);
  assert.equal(isPytestVersionOutput(0, ''), false);
  assert.equal(isPytestVersionOutput(null, 'pytest 9.2.0'), false);
});

test('runner detection: the probe allows a busy machine several seconds', () => {
  assert.ok(PROBE_TIMEOUT_MS >= 10_000);
});
