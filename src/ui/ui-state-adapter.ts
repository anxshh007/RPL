/**
 * UI State Adapter
 * Translates TestSheriff verification lifecycle and reports into structured,
 * developer-friendly UI state objects for Member 5's UI implementation.
 */

import type { VerificationReport, TestRunStatus } from "../shared/types/verification.ts";

export type UIExecutionState =
  | "discovering_tests"
  | "waiting_for_approval"
  | "ready_to_execute"
  | "running_tests"
  | "tests_passed"
  | "tests_failed"
  | "execution_timed_out"
  | "execution_cancelled"
  | "verification_incomplete"
  | "unsupported_test_framework";

export interface UIStateView {
  state: UIExecutionState;
  headline: string;
  badgeType: "success" | "warning" | "danger" | "info" | "neutral";
  selectedTestsCount: number;
  selectedTests: string[];
  summary: string;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  errorCount: number;
  durationLabel: string;
  failures: Array<{
    title: string;
    location?: string;
    summary: string;
    hypothesis?: string;
    details?: string;
  }>;
  limitations: string[];
  canRetry: boolean;
  canExpandDetails: boolean;
}

/**
 * Maps a completed VerificationReport to Member 5's UI presentation state.
 */
export function mapReportToUIState(report: VerificationReport): UIStateView {
  const durationLabel = report.durationMs !== undefined ? `${(report.durationMs / 1000).toFixed(2)}s` : "N/A";
  let state: UIExecutionState;
  let headline = "";
  let badgeType: UIStateView["badgeType"] = "info";

  switch (report.status) {
    case "passed":
      state = "tests_passed";
      headline = `Verification Passed (${report.passed}/${report.total} tests passed)`;
      badgeType = "success";
      break;

    case "failed":
      state = "tests_failed";
      headline = `Verification Failed (${report.failed} failed, ${report.passed} passed)`;
      badgeType = "danger";
      break;

    case "timed_out":
      state = "execution_timed_out";
      headline = `Test Execution Timed Out after ${durationLabel}`;
      badgeType = "warning";
      break;

    case "cancelled":
      state = "execution_cancelled";
      headline = "Test Execution Cancelled";
      badgeType = "neutral";
      break;

    case "error":
      state = "verification_incomplete";
      headline = `Verification Error (${report.failures[0]?.testName || "Runner Error"})`;
      badgeType = "danger";
      break;

    case "not_run":
      state = report.runner === "unsupported" ? "unsupported_test_framework" : "ready_to_execute";
      headline = report.runner === "unsupported"
        ? "Unsupported Test Framework"
        : "No Tests Executed";
      badgeType = "neutral";
      break;

    default:
      state = "verification_incomplete";
      headline = "Verification Status Unknown";
      badgeType = "warning";
  }

  const failures = report.failures.map((f) => ({
    title: f.testName,
    location: f.file,
    summary: f.message,
    hypothesis: f.hypothesis,
    details: f.errorDetails,
  }));

  return {
    state,
    headline,
    badgeType,
    selectedTestsCount: report.selectedTests.length,
    selectedTests: report.selectedTests,
    summary: report.outputSummary.slice(0, 300),
    passedCount: report.passed,
    failedCount: report.failed,
    skippedCount: report.skipped,
    errorCount: report.errors,
    durationLabel,
    failures,
    limitations: report.limitations,
    canRetry: state === "tests_failed" || state === "execution_timed_out" || state === "verification_incomplete",
    canExpandDetails: Boolean(report.outputSummary && report.outputSummary.length > 0),
  };
}

/**
 * Creates an in-progress UI state for test discovery or execution phases.
 */
export function createProgressUIState(
  state: "discovering_tests" | "waiting_for_approval" | "running_tests",
  context: { commandLabel?: string; selectedTests?: string[] } = {}
): UIStateView {
  const selectedTests = context.selectedTests || [];
  const headlines: Record<typeof state, string> = {
    discovering_tests: "Inspecting repository and discovering tests...",
    waiting_for_approval: "Ready to verify. Waiting for execution approval...",
    running_tests: `Running ${selectedTests.length} selected tests (${context.commandLabel || "pytest"})...`,
  };

  return {
    state,
    headline: headlines[state],
    badgeType: state === "running_tests" ? "info" : "neutral",
    selectedTestsCount: selectedTests.length,
    selectedTests,
    summary: "Verification in progress...",
    passedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    durationLabel: "...",
    failures: [],
    limitations: [],
    canRetry: false,
    canExpandDetails: false,
  };
}
