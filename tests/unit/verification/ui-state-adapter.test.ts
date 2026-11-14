import test from "node:test";
import assert from "node:assert/strict";
import {
  mapReportToUIState,
  createProgressUIState,
  type UIStateView,
  type UIExecutionState,
} from "../../../src/ui/ui-state-adapter.ts";
import type { VerificationReport } from "../../../src/shared/types/verification.ts";

function createMockReport(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    requestId: "test-req-001",
    status: "passed",
    runner: "pytest",
    commandLabel: "python -m pytest tests/test_example.py -q",
    selectedTests: ["tests/test_example.py"],
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    errors: 0,
    durationMs: 150,
    exitCode: 0,
    failures: [],
    testCases: [],
    outputSummary: "1 passed in 0.15s",
    outputTruncated: false,
    limitations: ["Targeted subset executed."],
    ...overrides,
  };
}

test("ui-state-adapter: State 1 - discovering_tests (createProgressUIState)", () => {
  const ui = createProgressUIState("discovering_tests");
  assert.equal(ui.state, "discovering_tests");
  assert.equal(ui.headline, "Inspecting repository and discovering tests...");
  assert.equal(ui.badgeType, "neutral");
  assert.equal(ui.canRetry, false);
  assert.equal(ui.canExpandDetails, false);
  assert.equal(ui.durationLabel, "...");
  assert.equal(ui.selectedTestsCount, 0);
  assert.deepEqual(ui.selectedTests, []);
});

test("ui-state-adapter: State 2 - waiting_for_approval (createProgressUIState)", () => {
  const ui = createProgressUIState("waiting_for_approval");
  assert.equal(ui.state, "waiting_for_approval");
  assert.equal(ui.headline, "Ready to verify. Waiting for execution approval...");
  assert.equal(ui.badgeType, "neutral");
  assert.equal(ui.canRetry, false);
  assert.equal(ui.canExpandDetails, false);
});

test("ui-state-adapter: State 3 - ready_to_execute (mapReportToUIState with not_run)", () => {
  const report = createMockReport({
    status: "not_run",
    runner: "pytest",
    commandLabel: "execution-blocked-by-human-gate",
    total: 0,
    passed: 0,
    failed: 0,
    outputSummary: "Execution blocked by gate",
  });
  const ui = mapReportToUIState(report);
  assert.equal(ui.state, "ready_to_execute");
  assert.equal(ui.headline, "No Tests Executed");
  assert.equal(ui.badgeType, "neutral");
  assert.equal(ui.canRetry, false);
});

test("ui-state-adapter: State 4 - running_tests (createProgressUIState with context)", () => {
  const ui = createProgressUIState("running_tests", {
    commandLabel: "python -m pytest tests/test_cli.py -q",
    selectedTests: ["tests/test_cli.py", "tests/test_api.py"],
  });
  assert.equal(ui.state, "running_tests");
  assert.equal(ui.headline, "Running 2 selected tests (python -m pytest tests/test_cli.py -q)...");
  assert.equal(ui.badgeType, "info");
  assert.equal(ui.selectedTestsCount, 2);
  assert.deepEqual(ui.selectedTests, ["tests/test_cli.py", "tests/test_api.py"]);
  assert.equal(ui.canRetry, false);
});

test("ui-state-adapter: State 5 - tests_passed (mapReportToUIState)", () => {
  const report = createMockReport({
    status: "passed",
    total: 5,
    passed: 5,
    failed: 0,
    durationMs: 420,
    outputSummary: "5 passed in 0.42s",
  });
  const ui = mapReportToUIState(report);
  assert.equal(ui.state, "tests_passed");
  assert.equal(ui.headline, "Verification Passed (5/5 tests passed)");
  assert.equal(ui.badgeType, "success");
  assert.equal(ui.passedCount, 5);
  assert.equal(ui.failedCount, 0);
  assert.equal(ui.durationLabel, "0.42s");
  assert.equal(ui.canRetry, false);
  assert.equal(ui.canExpandDetails, true);
});

test("ui-state-adapter: State 6 - tests_failed (mapReportToUIState with failure hypotheses)", () => {
  const report = createMockReport({
    status: "failed",
    total: 3,
    passed: 2,
    failed: 1,
    durationMs: 250,
    failures: [
      {
        testName: "tests/test_cli.py::test_flag",
        file: "tests/test_cli.py",
        message: "AssertionError: Expected False, got True",
        hypothesis: "[Hypothesis] (AssertionError) Flag default value mismatch.",
        errorDetails: "def test_flag():\n> assert flag == False\nE AssertionError",
      },
    ],
    outputSummary: "1 failed, 2 passed in 0.25s",
  });
  const ui = mapReportToUIState(report);
  assert.equal(ui.state, "tests_failed");
  assert.equal(ui.headline, "Verification Failed (1 failed, 2 passed)");
  assert.equal(ui.badgeType, "danger");
  assert.equal(ui.canRetry, true);
  assert.equal(ui.failedCount, 1);
  assert.equal(ui.failures.length, 1);
  assert.equal(ui.failures[0].title, "tests/test_cli.py::test_flag");
  assert.equal(ui.failures[0].location, "tests/test_cli.py");
  assert.equal(ui.failures[0].summary, "AssertionError: Expected False, got True");
  assert.equal(ui.failures[0].hypothesis, "[Hypothesis] (AssertionError) Flag default value mismatch.");
  assert.ok(ui.failures[0].details?.includes("assert flag == False"));
});

test("ui-state-adapter: State 7 - execution_timed_out (mapReportToUIState)", () => {
  const report = createMockReport({
    status: "timed_out",
    total: 1,
    passed: 0,
    failed: 0,
    durationMs: 30000,
    exitCode: 124,
    outputSummary: "Execution exceeded timeout of 30000ms.",
  });
  const ui = mapReportToUIState(report);
  assert.equal(ui.state, "execution_timed_out");
  assert.equal(ui.headline, "Test Execution Timed Out after 30.00s");
  assert.equal(ui.badgeType, "warning");
  assert.equal(ui.canRetry, true);
});

test("ui-state-adapter: State 8 - execution_cancelled (mapReportToUIState)", () => {
  const report = createMockReport({
    status: "cancelled",
    total: 0,
    passed: 0,
    failed: 0,
    outputSummary: "Verification cancelled via AbortSignal.",
  });
  const ui = mapReportToUIState(report);
  assert.equal(ui.state, "execution_cancelled");
  assert.equal(ui.headline, "Test Execution Cancelled");
  assert.equal(ui.badgeType, "neutral");
  assert.equal(ui.canRetry, false);
});

test("ui-state-adapter: State 9 - verification_incomplete (mapReportToUIState error or unknown)", () => {
  const reportError = createMockReport({
    status: "error",
    failures: [
      {
        testName: "ImportError in test_module.py",
        message: "ModuleNotFoundError: No module named 'flask'",
      },
    ],
    outputSummary: "Pytest collection failure.",
  });
  const uiError = mapReportToUIState(reportError);
  assert.equal(uiError.state, "verification_incomplete");
  assert.equal(uiError.headline, "Verification Error (ImportError in test_module.py)");
  assert.equal(uiError.badgeType, "danger");
  assert.equal(uiError.canRetry, true);

  // Fallback for unknown status
  const reportUnknown = createMockReport({
    status: "unrecognized_status" as any,
  });
  const uiUnknown = mapReportToUIState(reportUnknown);
  assert.equal(uiUnknown.state, "verification_incomplete");
  assert.equal(uiUnknown.headline, "Verification Status Unknown");
  assert.equal(uiUnknown.badgeType, "warning");
});

test("ui-state-adapter: State 10 - unsupported_test_framework (mapReportToUIState with runner unsupported)", () => {
  const report = createMockReport({
    status: "not_run",
    runner: "unsupported",
    outputSummary: "No supported test runner found in repository.",
  });
  const ui = mapReportToUIState(report);
  assert.equal(ui.state, "unsupported_test_framework");
  assert.equal(ui.headline, "Unsupported Test Framework");
  assert.equal(ui.badgeType, "neutral");
  assert.equal(ui.canRetry, false);
});

test("ui-state-adapter: duration formatting and output summary truncation edge cases", () => {
  // Undefined durationMs -> "N/A"
  const reportNoDuration = createMockReport({ durationMs: undefined });
  const uiNoDuration = mapReportToUIState(reportNoDuration);
  assert.equal(uiNoDuration.durationLabel, "N/A");

  // Output summary > 300 characters is capped at 300
  const longSummary = "x".repeat(500);
  const reportLongSummary = createMockReport({ outputSummary: longSummary });
  const uiLongSummary = mapReportToUIState(reportLongSummary);
  assert.equal(uiLongSummary.summary.length, 300);

  // Empty summary disables canExpandDetails
  const reportEmptySummary = createMockReport({ outputSummary: "" });
  const uiEmptySummary = mapReportToUIState(reportEmptySummary);
  assert.equal(uiEmptySummary.canExpandDetails, false);
});
