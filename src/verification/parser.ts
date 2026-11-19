import type { TestCounts, TestFailure, VerificationStatus } from '../shared/contracts';

export interface ParsedPytestResult {
  status: VerificationStatus;
  counts: TestCounts;
  parsingComplete: boolean;
  failures: TestFailure[];
  limitations: string[];
}

/**
 * Categorizes python exception types into grounded, evidence-based descriptions.
 * The category is placed directly in the failure message per contract requirements.
 */
export function categorizeException(errorText: string): string {
  if (errorText.includes('AssertionError')) {
    return '[AssertionError] Test assertion check failed.';
  }
  if (errorText.includes('ImportError') || errorText.includes('ModuleNotFoundError')) {
    return '[ImportError] Missing or unresolvable module import.';
  }
  if (errorText.includes('AttributeError')) {
    return '[AttributeError] Attribute or method not found on target object.';
  }
  if (errorText.includes('TypeError')) {
    return '[TypeError] Incompatible argument or operand type.';
  }
  if (errorText.includes('KeyError') || errorText.includes('IndexError')) {
    return '[LookupError] Key or index lookup out of bounds.';
  }
  if (errorText.includes('TimeoutError')) {
    return '[TimeoutError] Operation or fixture timed out.';
  }
  return '[Failure] Test did not pass.';
}

/**
 * Parses stdout and stderr from a pytest run into structured counts and failures.
 * Never guesses: if the summary line cannot be parsed, counts remain null.
 */
export function parsePytestOutput(params: {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
}): ParsedPytestResult {
  const { stdout, stderr, exitCode, timedOut, cancelled } = params;
  const rawCombined = `${stdout}\n${stderr}`;
  // Strip ANSI colour and formatting escape codes so summary parsing is invariant to terminal color
  const combined = rawCombined.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
  const limitations: string[] = [];

  // Handle timeout
  if (timedOut) {
    return {
      status: 'timed_out',
      counts: { total: null, passed: null, failed: null, skipped: null, errors: null },
      parsingComplete: false,
      failures: [],
      limitations: ['Execution timed out before completion.'],
    };
  }

  // Handle cancellation
  if (cancelled) {
    return {
      status: 'cancelled',
      counts: { total: null, passed: null, failed: null, skipped: null, errors: null },
      parsingComplete: false,
      failures: [],
      limitations: ['Execution was cancelled by the caller.'],
    };
  }

  // Parse pytest summary line: e.g. "=== 2 passed in 0.05s ===" or "2 passed in 0.05s"
  const summaryRegex = /(?:===+\s*)?((?:\d+\s+\w+,\s*)*\d+\s+\w+)\s+in\s+[\d.]+s(?:\s*===+)?/i;
  const summaryMatch = combined.match(summaryRegex);

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let errors = 0;
  let hasSummary = false;

  if (summaryMatch) {
    hasSummary = true;
    const summaryLine = summaryMatch[0];

    const passMatch = summaryLine.match(/(\d+)\s+passed/);
    if (passMatch) passed = parseInt(passMatch[1], 10);

    const failMatch = summaryLine.match(/(\d+)\s+failed/);
    if (failMatch) failed = parseInt(failMatch[1], 10);

    const skipMatch = summaryLine.match(/(\d+)\s+skipped/);
    if (skipMatch) skipped = parseInt(skipMatch[1], 10);

    const errorMatch = summaryLine.match(/(\d+)\s+error/);
    if (errorMatch) errors = parseInt(errorMatch[1], 10);
  }

  // Parse collection or import errors before test execution (e.g. exit code 2 or 4)
  const collectionErrorMatch = combined.match(/ERROR collecting\s+([^\s\n]+)/i);
  if (collectionErrorMatch && !hasSummary) {
    errors = 1;
    hasSummary = true;
    limitations.push(`Pytest encountered a collection error in: ${collectionErrorMatch[1]}`);
  }

  // Extract individual test failures
  const failures: TestFailure[] = [];
  const failureLinesRegex = /FAILED\s+([^\s:]+)(?:::([^\s\-]+))?(?:\s+-\s+(.+))?/g;
  let failMatch: RegExpExecArray | null;

  while ((failMatch = failureLinesRegex.exec(combined)) !== null) {
    const file = failMatch[1];
    const testName = failMatch[2] || failMatch[1];
    const rawError = failMatch[3] || 'Assertion or runtime error';
    const hypothesis = categorizeException(rawError);

    failures.push({
      testName,
      file,
      message: `${hypothesis} ${rawError}`.trim(),
    });
  }

  // If failures were reported in count but individual lines weren't captured by regex, extract from traceback
  if (failed > 0 && failures.length === 0) {
    const tracebackBlockRegex = /_{3,}\s+([^\s_]+)\s+_{3,}([\s\S]*?)(?=(?:_{3,}|\n={3,}|$))/g;
    let tbMatch: RegExpExecArray | null;
    while ((tbMatch = tracebackBlockRegex.exec(combined)) !== null) {
      const testName = tbMatch[1];
      const block = tbMatch[2].trim();
      const lastLine = block.split('\n').filter((l) => l.trim().length > 0).pop() || 'Test failed';
      const hypothesis = categorizeException(lastLine);

      failures.push({
        testName,
        message: `${hypothesis} ${lastLine}`.trim(),
      });
    }
  }

  // If no summary was found, use exit code mapping per AGENTS.md honesty rules:
  // 0 = passed, 1 = failed (counts null), 5 = no tests collected -> not_run
  if (!hasSummary) {
    const counts: TestCounts = { total: null, passed: null, failed: null, skipped: null, errors: null };
    if (exitCode === 0) {
      return {
        status: 'passed',
        counts,
        parsingComplete: false,
        failures: [],
        limitations: [
          ...limitations,
          'Pytest completed with exit code 0 but no summary line was found; counts marked null.',
        ],
      };
    } else if (exitCode === 1) {
      return {
        status: 'failed',
        counts,
        parsingComplete: false,
        failures: failures.length > 0 ? failures : [{
          testName: 'pytest_execution',
          message: `Tests failed with exit code 1. Output: ${combined.slice(0, 500).trim()}`,
        }],
        limitations: [
          ...limitations,
          'Pytest exited with status 1 (tests failed) but no summary line was found; counts marked null.',
        ],
      };
    } else if (exitCode === 5) {
      return {
        status: 'not_run',
        counts,
        parsingComplete: false,
        failures: [],
        limitations: [
          ...limitations,
          'Pytest exit code 5: no tests were collected.',
        ],
      };
    } else {
      return {
        status: 'error',
        counts,
        parsingComplete: false,
        failures: failures.length > 0 ? failures : [{
          testName: 'pytest_execution',
          message: `Process exited with error code ${exitCode}. Output: ${combined.slice(0, 500).trim()}`,
        }],
        limitations: [
          ...limitations,
          `Pytest exited with error code ${exitCode} and no summary line was produced.`,
        ],
      };
    }
  }

  const total = passed + failed + skipped + errors;
  const counts: TestCounts = { total, passed, failed, skipped, errors };

  let status: VerificationStatus = 'passed';
  if (errors > 0) {
    status = 'error';
  } else if (failed > 0 || (exitCode !== 0 && exitCode !== null)) {
    status = 'failed';
  } else if (total === 0) {
    status = 'not_run';
  }

  return {
    status,
    counts,
    parsingComplete: true,
    failures,
    limitations,
  };
}
