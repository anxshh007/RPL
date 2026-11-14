/**
 * Central Verification Service
 * Orchestrates test discovery, selection, safe process execution, result parsing,
 * and VerificationReport generation.
 */

import { validateSafePath } from "../shared/utils/path-validator.ts";
import { logger } from "../shared/utils/logger.ts";
import { ValidationError, RunnerNotFoundError } from "./errors.ts";
import { discoverTests } from "./test-discovery.ts";
import { selectTests } from "./test-selection.ts";
import { PytestRunner } from "./runner/pytest-runner.ts";
import { buildVerificationReport } from "./result-parser.ts";
import type {
  TestRunRequest,
  VerificationReport,
  TestDiscoveryResult,
  TestSelectionResult,
} from "../shared/types/verification.ts";
import type { SafeProcessResult } from "./process/process-types.ts";

export class VerificationService {
  private readonly reportsCache = new Map<string, VerificationReport>();
  private readonly pytestRunner = new PytestRunner();

  /**
   * Validates a TestRunRequest against the schema and safety rules.
   */
  public validateRequest(request: TestRunRequest): void {
    if (!request) {
      throw new ValidationError("TestRunRequest must not be empty");
    }
    if (!request.requestId || typeof request.requestId !== "string") {
      throw new ValidationError("requestId is required and must be a string");
    }
    if (!request.workspaceRoot || typeof request.workspaceRoot !== "string") {
      throw new ValidationError("workspaceRoot is required and must be a string");
    }
    if (!Array.isArray(request.changedFiles)) {
      throw new ValidationError("changedFiles must be an array of file path strings");
    }
    if (request.timeoutMs !== undefined) {
      if (typeof request.timeoutMs !== "number" || request.timeoutMs <= 0 || request.timeoutMs > 300000) {
        throw new ValidationError("timeoutMs must be a positive number up to 300000 (5 minutes)");
      }
    }
    // Verify workspace path doesn't escape
    validateSafePath(request.workspaceRoot, request.workspaceRoot);
  }

  /**
   * Discovers tests and selects candidate tests for the given changed files.
   */
  public async discoverAndSelect(
    workspaceRoot: string,
    changedFiles: string[] = [],
    candidateTests = []
  ): Promise<{ discovery: TestDiscoveryResult; selection: TestSelectionResult }> {
    const safeRoot = validateSafePath(workspaceRoot, workspaceRoot);
    const discovery = await discoverTests(safeRoot);
    const selection = await selectTests({
      workspaceRoot: safeRoot,
      changedFiles,
      candidateTests,
    });
    return { discovery, selection };
  }

  /**
   * Main verification entry point: verifies approved changes by discovering,
   * executing, and analyzing relevant tests.
   */
  public async verifyChanges(
    request: TestRunRequest,
    signal?: AbortSignal
  ): Promise<VerificationReport> {
    const startedAt = new Date().toISOString();
    logger.info(`Beginning verification for request ${request.requestId}`, {
      workspaceRoot: request.workspaceRoot,
      changedCount: request.changedFiles?.length,
    });

    try {
      this.validateRequest(request);
    } catch (err) {
      logger.error(`Validation failed for request ${request.requestId}: ${(err as Error).message}`);
      const errReport: VerificationReport = {
        requestId: request.requestId || "invalid-request",
        status: "error",
        runner: "none",
        commandLabel: "none",
        selectedTests: [],
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        errors: 1,
        durationMs: 0,
        exitCode: 1,
        failures: [
          {
            testName: "ValidationError",
            message: (err as Error).message,
            hypothesis: "[Hypothesis] The verification request contained invalid arguments or violated security boundaries.",
          },
        ],
        outputSummary: `Request validation error: ${(err as Error).message}`,
        outputTruncated: false,
        startedAt,
        completedAt: new Date().toISOString(),
        limitations: ["Verification was rejected before execution due to validation errors."],
      };
      this.reportsCache.set(request.requestId, errReport);
      return errReport;
    }

    const { workspaceRoot, changedFiles, candidateTests, timeoutMs, environment, pythonPath, maxOutputBytes } = request;

    // Step 1: Select relevant tests
    const { selection } = await this.discoverAndSelect(workspaceRoot, changedFiles, candidateTests);

    if (selection.selectedTests.length === 0) {
      logger.warn(`No tests found or selected for workspace: ${workspaceRoot}`);
      const emptyReport: VerificationReport = {
        requestId: request.requestId,
        status: "not_run",
        runner: "pytest",
        commandLabel: "no-tests-executed",
        selectedTests: [],
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        errors: 0,
        durationMs: 0,
        exitCode: 0,
        failures: [],
        outputSummary: "No relevant tests were discovered or selected for the approved changes.",
        outputTruncated: false,
        startedAt,
        completedAt: new Date().toISOString(),
        limitations: [
          ...selection.limitations,
          "No automated tests were executed. Changes remain unverified.",
        ],
      };
      this.reportsCache.set(request.requestId, emptyReport);
      return emptyReport;
    }

    // Step 2: Execute pytest via safe runner
    let runnerResult;
    try {
      runnerResult = await this.pytestRunner.execute({
        workspaceRoot,
        testPaths: selection.selectedTests,
        timeoutMs,
        pythonPath,
        environment,
        maxOutputBytes,
        signal,
      });
    } catch (err) {
      logger.error(`Runner execution failed: ${(err as Error).message}`);
      const isMissingRunner = err instanceof RunnerNotFoundError;
      const failedProcessResult: SafeProcessResult = {
        exitCode: 127,
        stdout: "",
        stderr: (err as Error).message,
        combinedOutput: (err as Error).message,
        durationMs: 0,
        timedOut: false,
        cancelled: false,
        truncated: false,
      };

      const fallbackReport = buildVerificationReport({
        requestId: request.requestId,
        runner: "pytest",
        commandLabel: `python -m pytest ${selection.selectedTests.join(" ")} -q`,
        selectedTests: selection.selectedTests,
        processResult: failedProcessResult,
        selectionLimitations: [
          ...selection.limitations,
          isMissingRunner
            ? "Python or pytest is not installed or accessible in the environment. Tests could not be run."
            : `Process execution error: ${(err as Error).message}`,
        ],
        startedAt,
      });

      this.reportsCache.set(request.requestId, fallbackReport);
      return fallbackReport;
    }

    // Step 3: Parse and analyze results
    const report = buildVerificationReport({
      requestId: request.requestId,
      runner: runnerResult.runner,
      commandLabel: runnerResult.commandLabel,
      selectedTests: runnerResult.testPaths,
      processResult: runnerResult.processResult,
      selectionLimitations: selection.limitations,
      startedAt,
    });

    this.reportsCache.set(request.requestId, report);
    logger.info(`Verification completed for ${request.requestId}: status=${report.status}, passed=${report.passed}/${report.total}`);
    return report;
  }

  /**
   * Retrieves a previously cached verification report by requestId.
   */
  public getReport(requestId: string): VerificationReport | null {
    return this.reportsCache.get(requestId) || null;
  }

  /**
   * Clears report cache (useful in tests).
   */
  public clearCache(): void {
    this.reportsCache.clear();
  }
}

export const verificationService = new VerificationService();

export async function verifyChanges(request: TestRunRequest, signal?: AbortSignal): Promise<VerificationReport> {
  return verificationService.verifyChanges(request, signal);
}

export function getVerificationReport(requestId: string): VerificationReport | null {
  return verificationService.getReport(requestId);
}
