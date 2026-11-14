/**
 * Pytest Output Parser & Verification Analyzer
 * Robustly parses test counts (passed, failed, skipped, errors), failure details,
 * assertion failures, collection errors, runner errors, and timeouts.
 * Strictly avoids hallucinated explanations and preserves limitations.
 */

import * as path from "node:path";
import { redactSecrets } from "../shared/utils/redactor.ts";
import type {
  TestCaseResult,
  TestFailureDetail,
  TestRunStatus,
  VerificationReport,
} from "../shared/types/verification.ts";
import type { SafeProcessResult } from "./process/process-types.ts";

export interface ParseResultOptions {
  requestId: string;
  runner: string;
  commandLabel: string;
  selectedTests: string[];
  processResult: SafeProcessResult;
  selectionLimitations?: string[];
  startedAt?: string;
}

export interface ParsedSummaryCounts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  parsingIncomplete: boolean;
}

/**
 * Extracts count metrics from standard pytest summary line:
 * e.g., "5 passed, 2 failed, 1 skipped, 1 error in 0.42s"
 * or "2 failed in 0.12s"
 * or "=== 1 passed in 0.05s ==="
 */
export function parsePytestSummaryCounts(output: string): ParsedSummaryCounts {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let errors = 0;
  let foundSummary = false;

  // Search from bottom up for the final summary line
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];

    // Look for lines containing "passed", "failed", "error", or "skipped"
    if (
      line.includes("passed") ||
      line.includes("failed") ||
      line.includes("skipped") ||
      line.includes("error") ||
      line.includes("no tests ran")
    ) {
      const passedMatch = line.match(/(\d+)\s+passed/);
      const failedMatch = line.match(/(\d+)\s+failed/);
      const skippedMatch = line.match(/(\d+)\s+skipped/);
      const errorsMatch = line.match(/(\d+)\s+error/);

      if (passedMatch || failedMatch || skippedMatch || errorsMatch) {
        if (passedMatch) passed = parseInt(passedMatch[1], 10);
        if (failedMatch) failed = parseInt(failedMatch[1], 10);
        if (skippedMatch) skipped = parseInt(skippedMatch[1], 10);
        if (errorsMatch) errors = parseInt(errorsMatch[1], 10);
        foundSummary = true;
        break;
      }

      if (line.includes("no tests ran")) {
        foundSummary = true;
        break;
      }
    }
  }

  // Count short test summary info lines if final summary line was absent or truncated
  if (!foundSummary) {
    const failedSummaryLines = lines.filter((l) => l.startsWith("FAILED "));
    const errorSummaryLines = lines.filter((l) => l.startsWith("ERROR "));
    if (failedSummaryLines.length > 0 || errorSummaryLines.length > 0) {
      failed = failedSummaryLines.length;
      errors = errorSummaryLines.length;
      foundSummary = true;
    }
  }

  const total = passed + failed + skipped + errors;

  return {
    total,
    passed,
    failed,
    skipped,
    errors,
    parsingIncomplete: !foundSummary,
  };
}

/**
 * Generates an evidence-backed hypothesis based strictly on the parsed exception or error type.
 * Never invents diagnosis out of thin air.
 */
export function generateFailureHypothesis(message: string, errorDetails?: string): string {
  const fullText = `${message}\n${errorDetails ?? ""}`;

  if (fullText.includes("AssertionError") || fullText.includes("assert ")) {
    return "[Hypothesis] (AssertionError) The test failed an assertion check: expected value did not match actual value. Review the assertion diff in the error details.";
  }
  if (fullText.includes("ImportError") || fullText.includes("ModuleNotFoundError")) {
    return "[Hypothesis] (ImportError) A required module or import was not found in the Python environment. Verify virtualenv packages or PYTHONPATH.";
  }
  if (fullText.includes("AttributeError")) {
    return "[Hypothesis] (AttributeError) An attribute or method was accessed on an object that does not define it. Possible API signature or return type mismatch.";
  }
  if (fullText.includes("TypeError")) {
    return "[Hypothesis] (TypeError) A function or constructor was called with invalid arguments, unexpected types, or mismatched parameter count.";
  }
  if (fullText.includes("KeyError")) {
    return "[Hypothesis] (KeyError) A dictionary or mapping key was missing when accessed. Check configuration dictionary keys.";
  }
  if (fullText.includes("IndexError")) {
    return "[Hypothesis] (IndexError) A sequence index was accessed out of range. Check list or tuple bounds.";
  }
  if (fullText.includes("PermissionError")) {
    return "[Hypothesis] (PermissionError) File system or resource permission was denied during execution.";
  }
  if (fullText.includes("FileNotFoundError")) {
    return "[Hypothesis] (FileNotFoundError) A file or path expected by the test does not exist in the working directory.";
  }

  return "[Hypothesis] Test execution encountered an unhandled exception. Review traceback and failure message for details.";
}

/**
 * Parses individual test failure blocks from pytest output.
 */
export function parsePytestFailures(output: string): TestFailureDetail[] {
  const failures: TestFailureDetail[] = [];
  const lines = output.split(/\r?\n/);

  // 1. Look for FAILED short test summary lines:
  // e.g., "FAILED tests/test_cli.py::test_command_version - AssertionError: assert 1 == 2"
  const failedSummaryRegex = /^FAILED\s+([^:]+)::([^\s\-]+)(?:\s+-\s+(.+))?$/;
  // e.g., "ERROR tests/test_bad.py - ImportError: ..."
  const errorSummaryRegex = /^ERROR\s+([^:]+)(?:\s+-\s+(.+))?$/;

  for (const line of lines) {
    const trimmed = line.trim();
    const failMatch = trimmed.match(failedSummaryRegex);
    if (failMatch) {
      const file = failMatch[1].trim();
      const testName = failMatch[2].trim();
      const message = failMatch[3]?.trim() || "Test failed during execution";
      failures.push({
        testName,
        file,
        message: redactSecrets(message),
        hypothesis: generateFailureHypothesis(message),
      });
      continue;
    }

    const errMatch = trimmed.match(errorSummaryRegex);
    if (errMatch) {
      const file = errMatch[1].trim();
      const message = errMatch[2]?.trim() || "Collection or runner error";
      failures.push({
        testName: `[Collection Error] ${file}`,
        file,
        message: redactSecrets(message),
        hypothesis: generateFailureHypothesis(message),
      });
    }
  }

  // 2. If short summary was absent (e.g. truncated or different pytest flag),
  // extract from FAILURES or ERRORS headers
  if (failures.length === 0) {
    const failureHeaderRegex = /^_{5,}\s+(.*?)\s+_{5,}$/;
    let currentTestName = "";
    let currentMessageLines: string[] = [];

    for (const line of lines) {
      const headerMatch = line.match(failureHeaderRegex);
      if (headerMatch) {
        if (currentTestName) {
          const msg = currentMessageLines.join("\n").trim() || "Test failure";
          failures.push({
            testName: currentTestName,
            message: redactSecrets(msg.slice(0, 500)),
            errorDetails: redactSecrets(msg),
            hypothesis: generateFailureHypothesis(msg),
          });
          currentMessageLines = [];
        }
        currentTestName = headerMatch[1].trim();
      } else if (currentTestName) {
        if (line.startsWith("=") || line.startsWith("FAILED ")) {
          // End of failure block
          const msg = currentMessageLines.join("\n").trim() || "Test failure";
          failures.push({
            testName: currentTestName,
            message: redactSecrets(msg.slice(0, 500)),
            errorDetails: redactSecrets(msg),
            hypothesis: generateFailureHypothesis(msg),
          });
          currentTestName = "";
          currentMessageLines = [];
        } else {
          currentMessageLines.push(line);
        }
      }
    }

    if (currentTestName) {
      const msg = currentMessageLines.join("\n").trim() || "Test failure";
      failures.push({
        testName: currentTestName,
        message: redactSecrets(msg.slice(0, 500)),
        errorDetails: redactSecrets(msg),
        hypothesis: generateFailureHypothesis(msg),
      });
    }
  }

  return failures;
}

/**
 * Parses individual test case outcomes from pytest stdout.
 */
export function parseIndividualTestCases(
  output: string,
  selectedTests: string[]
): TestCaseResult[] {
  const cases: TestCaseResult[] = [];
  const lines = output.split(/\r?\n/);

  const verboseRegex = /^([^\s:]+)::([^\s]+)\s+(PASSED|FAILED|SKIPPED|ERROR)/i;
  const failedSummaryRegex = /^FAILED\s+([^:]+)::([^\s\-]+)(?:\s+-\s+(.+))?$/;
  const errorSummaryRegex = /^ERROR\s+([^:]+)(?:\s+-\s+(.+))?$/;

  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();

    const verbMatch = trimmed.match(verboseRegex);
    if (verbMatch) {
      const file = verbMatch[1];
      const name = verbMatch[2];
      const statusStr = verbMatch[3].toLowerCase() as "passed" | "failed" | "skipped" | "error";
      const key = `${file}::${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        cases.push({
          id: key,
          file,
          name,
          status: statusStr,
        });
      }
      continue;
    }

    const failMatch = trimmed.match(failedSummaryRegex);
    if (failMatch) {
      const file = failMatch[1];
      const name = failMatch[2];
      const msg = failMatch[3] || "Assertion or execution failure";
      const key = `${file}::${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        cases.push({
          id: key,
          file,
          name,
          status: "failed",
          message: redactSecrets(msg),
        });
      }
      continue;
    }

    const errMatch = trimmed.match(errorSummaryRegex);
    if (errMatch) {
      const file = errMatch[1];
      const msg = errMatch[2] || "Collection or execution error";
      const key = `ERROR::${file}`;
      if (!seen.has(key)) {
        seen.add(key);
        cases.push({
          id: key,
          file,
          name: `[Error] ${file}`,
          status: "error",
          message: redactSecrets(msg),
        });
      }
    }
  }

  // Synthesize entries for quiet output if all passed
  if (cases.length === 0 && selectedTests.length > 0) {
    const counts = parsePytestSummaryCounts(output);
    if (counts.passed > 0 && counts.failed === 0 && counts.errors === 0) {
      selectedTests.forEach((file) => {
        cases.push({
          id: `${file}::suite`,
          file,
          name: path.basename(file),
          status: "passed",
        });
      });
    }
  }

  return cases;
}

/**
 * Builds a canonical VerificationReport from execution results.
 */
export function buildVerificationReport(options: ParseResultOptions): VerificationReport {
  const {
    requestId,
    runner,
    commandLabel,
    selectedTests,
    processResult,
    selectionLimitations = [],
    startedAt = new Date().toISOString(),
  } = options;

  const completedAt = new Date().toISOString();
  const limitations = [...selectionLimitations];

  const rawOutput = processResult.combinedOutput;
  const sanitizedOutput = redactSecrets(rawOutput);

  // Handle timeout
  if (processResult.timedOut) {
    limitations.push("Execution timed out: exceeded configured timeout limit and was terminated.");
    return {
      requestId,
      status: "timed_out",
      runner,
      commandLabel,
      selectedTests,
      total: selectedTests.length,
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: 1,
      durationMs: processResult.durationMs,
      exitCode: processResult.exitCode,
      failures: [
        {
          testName: "ExecutionTimeout",
          message: `Process timed out after ${processResult.durationMs}ms`,
          hypothesis: "[Hypothesis] The test suite took longer than allowed or encountered an infinite loop or hanging I/O operation.",
        },
      ],
      outputSummary: sanitizedOutput.slice(0, 2000),
      outputTruncated: processResult.truncated,
      startedAt,
      completedAt,
      limitations,
    };
  }

  // Handle cancellation
  if (processResult.cancelled) {
    limitations.push("Execution was cancelled before completion.");
    return {
      requestId,
      status: "cancelled",
      runner,
      commandLabel,
      selectedTests,
      total: selectedTests.length,
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: 0,
      durationMs: processResult.durationMs,
      exitCode: processResult.exitCode,
      failures: [],
      outputSummary: "Execution cancelled by request.",
      outputTruncated: processResult.truncated,
      startedAt,
      completedAt,
      limitations,
    };
  }

  // Parse counts and failures
  const counts = parsePytestSummaryCounts(rawOutput);
  const failures = parsePytestFailures(rawOutput);
  const testCases = parseIndividualTestCases(rawOutput, selectedTests);

  if (counts.parsingIncomplete) {
    limitations.push("Output format could not be fully parsed into standard pytest counts. Review raw output summary.");
  }

  if (processResult.truncated) {
    limitations.push("Output exceeded maximum buffer size and was truncated; some failure tracebacks may be incomplete.");
  }

  // Determine overall status
  let status: TestRunStatus = "error";

  if (processResult.exitCode === 0 && counts.failed === 0 && counts.errors === 0 && counts.total > 0) {
    status = "passed";
  } else if (counts.failed > 0) {
    status = "failed";
  } else if (counts.errors > 0 || processResult.exitCode !== 0) {
    status = "error";
    if (failures.length === 0 && processResult.exitCode !== 0) {
      failures.push({
        testName: "ProcessExecutionError",
        message: processResult.stderr || `Runner process exited with non-zero exit code: ${processResult.exitCode}`,
        hypothesis: "[Hypothesis] The test runner failed before running tests (e.g. missing package, syntax error, or invalid arguments).",
      });
    }
  } else if (counts.total === 0) {
    status = "not_run";
    limitations.push("No tests were collected or executed by the runner.");
  }

  // Build clean output summary (last 20 lines or 2000 chars)
  const outputLines = sanitizedOutput.split(/\r?\n/).filter(Boolean);
  const summarySnippet = outputLines.slice(-25).join("\n").slice(0, 2500);

  return {
    requestId,
    status,
    runner,
    commandLabel,
    selectedTests,
    total: counts.total,
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    errors: counts.errors,
    durationMs: processResult.durationMs,
    exitCode: processResult.exitCode,
    failures,
    testCases,
    outputSummary: summarySnippet || "(No output captured)",
    outputTruncated: processResult.truncated,
    startedAt,
    completedAt,
    limitations,
  };
}
