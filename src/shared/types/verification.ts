/**
 * RepoPilot AI — Layer 3 TestSheriff Canonical Verification Types
 * Shared contracts agreed with Member 1 (Central Agent), Member 3 (ImpactLens), and Member 5 (UI).
 */

export type TestRunStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "error"
  | "not_run";

export type CandidateSource = "explicit" | "impact" | "convention" | "import" | "configuration";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface TestCandidate {
  /** Relative or absolute file path to the test */
  path: string;
  /** Human-readable explanation of why this test was selected */
  reason: string;
  /** Origin source of the candidate */
  source: CandidateSource;
  /** Confidence score for this test's relevance */
  confidence: ConfidenceLevel;
}

export interface TestRunRequest {
  /** Unique request identifier */
  requestId: string;
  /** Absolute path to the opened workspace root */
  workspaceRoot: string;
  /** List of changed file paths relative to workspace root */
  changedFiles: string[];
  /** Optional candidate test hints supplied by ImpactLens or user */
  candidateTests?: TestCandidate[];
  /** Approved runner framework (default: "pytest") */
  approvedRunner?: "pytest";
  /** Execution timeout in milliseconds (default: 30000ms, max 300000ms) */
  timeoutMs?: number;
  /** Optional isolated environment overrides */
  environment?: Record<string, string>;
  /** Optional specific Python executable or virtualenv python path */
  pythonPath?: string;
  /** Maximum stdout/stderr output bytes captured before truncation (default: 524288 / 512KB) */
  maxOutputBytes?: number;
}

export interface TestCaseResult {
  id?: string;
  name: string;
  file?: string;
  status: "passed" | "failed" | "skipped" | "error";
  message?: string;
  durationMs?: number;
}

export interface TestFailureDetail {
  testName: string;
  file?: string;
  message: string;
  errorDetails?: string;
  /** Clearly labelled hypothesis for why the test failed — never presented as an absolute fact */
  hypothesis?: string;
}

export interface VerificationReport {
  /** Unique identifier matching the initial TestRunRequest */
  requestId: string;
  /** Overall execution status */
  status: TestRunStatus;
  /** Runner framework used (e.g. "pytest") */
  runner: string;
  /** Safe command label for display (e.g. "python -m pytest tests/test_cli.py -q") */
  commandLabel: string;
  /** File paths of all tests selected for execution */
  selectedTests: string[];
  /** Total number of tests discovered/run */
  total: number;
  /** Number of tests that passed */
  passed: number;
  /** Number of tests that failed */
  failed: number;
  /** Number of tests skipped */
  skipped: number;
  /** Number of collection/import/runtime errors */
  errors: number;
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Process exit code */
  exitCode?: number;
  /** Detailed breakdown of all test failures */
  failures: TestFailureDetail[];
  /** Optional individual test case outcomes */
  testCases?: TestCaseResult[];
  /** Redacted summary of test output */
  outputSummary: string;
  /** Flag indicating whether the captured output was truncated due to size limits */
  outputTruncated: boolean;
  /** ISO timestamp when the test execution began */
  startedAt?: string;
  /** ISO timestamp when verification completed */
  completedAt?: string;
  /** Disclosed limitations of this verification run */
  limitations: string[];
}

export interface TestDiscoveryResult {
  workspaceRoot: string;
  runner: "pytest" | "unsupported";
  detectedConfigs: string[];
  testFiles: string[];
  testDirectories: string[];
  conftestFiles?: string[];
  testInstructions?: string[];
  isConfigured: boolean;
  reasons: string[];
}

export interface TestSelectionResult {
  selectedTests: string[];
  candidates: TestCandidate[];
  fallbackToFullSuite: boolean;
  reasons: string[];
  limitations: string[];
}
