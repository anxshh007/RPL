import type {
  TestCandidate,
  TestRunRequest,
  VerificationReport,
  VerificationService,
} from '../shared/contracts';
import { discoverWorkspaceTestConfig } from './discovery';
import { selectRelevantTests } from './selection';
import { executePytest } from './safe-runner';
import { parsePytestOutput } from './parser';

export function notRunReport(requestId: string, reason: string): VerificationReport {
  return {
    requestId,
    status: 'not_run',
    runner: 'none',
    commandLabel: '',
    selectedTests: [],
    counts: { total: null, passed: null, failed: null, skipped: null, errors: null },
    parsingComplete: false,
    exitCode: null,
    durationMs: null,
    failures: [],
    stdoutTail: '',
    stderrTail: '',
    outputTruncated: false,
    limitations: [reason],
  };
}

export class VerificationServiceImpl implements VerificationService {
  private readonly reportsCache = new Map<string, VerificationReport>();
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Retrieves a previously cached verification report by request ID.
   * Stored purely in memory — never writes to disk.
   */
  public getReport(requestId: string): VerificationReport | undefined {
    return this.reportsCache.get(requestId);
  }

  /**
   * Discovers and selects test candidates based on changed files and hints.
   */
  public async discoverTests(changedFiles: string[] = [], candidates: TestCandidate[] = []): Promise<TestCandidate[]> {
    const selection = await selectRelevantTests({
      workspaceRoot: this.workspaceRoot,
      changedFiles,
      candidateTests: candidates,
    });
    return selection.allCandidates;
  }

  /**
   * Runs relevant tests safely and returns a complete, truthful VerificationReport.
   */
  public async verify(request: TestRunRequest, signal?: AbortSignal): Promise<VerificationReport> {
    const startedAt = new Date().toISOString();

    if (!request || !request.requestId) {
      return notRunReport('unknown', 'Invalid request: missing requestId.');
    }

    const { requestId, changedFiles = [], candidateTests = [], timeoutMs } = request;

    // Check for empty request
    if (changedFiles.length === 0 && candidateTests.length === 0) {
      const report = notRunReport(requestId, 'No changed files or test candidates provided.');
      report.startedAt = startedAt;
      report.completedAt = new Date().toISOString();
      this.reportsCache.set(requestId, report);
      return report;
    }

    // Check if signal is already aborted
    if (signal?.aborted) {
      const report: VerificationReport = {
        requestId,
        status: 'cancelled',
        runner: 'pytest',
        commandLabel: '',
        selectedTests: [],
        counts: { total: null, passed: null, failed: null, skipped: null, errors: null },
        parsingComplete: false,
        exitCode: null,
        durationMs: 0,
        failures: [],
        stdoutTail: '',
        stderrTail: '',
        outputTruncated: false,
        limitations: ['Verification was cancelled via AbortSignal before execution began.'],
        startedAt,
        completedAt: new Date().toISOString(),
      };
      this.reportsCache.set(requestId, report);
      return report;
    }

    // Step 1: Detect pytest runner in the workspace/environment
    const config = await discoverWorkspaceTestConfig(this.workspaceRoot);
    if (!config.hasPytest || !config.pythonExecutable) {
      const report = notRunReport(
        requestId,
        'Test runner (pytest) was not found in the environment. TestSheriff never installs packages automatically.'
      );
      report.startedAt = startedAt;
      report.completedAt = new Date().toISOString();
      report.limitations.push(...config.limitations);
      this.reportsCache.set(requestId, report);
      return report;
    }

    // Step 2: Select relevant tests based on conventions and ImpactLens candidates
    const selection = await selectRelevantTests({
      workspaceRoot: this.workspaceRoot,
      changedFiles,
      candidateTests,
    });

    if (selection.selectedTests.length === 0) {
      const report = notRunReport(requestId, 'No matching tests were found for the specified changed files.');
      report.startedAt = startedAt;
      report.completedAt = new Date().toISOString();
      report.limitations.push(...selection.limitations);
      this.reportsCache.set(requestId, report);
      return report;
    }

    // Step 3: Execute pytest using restricted process runner
    const testPathsToRun = selection.selectedTests.map((t) => t.path);
    const execution = await executePytest({
      workspaceRoot: this.workspaceRoot,
      pythonExecutable: config.pythonExecutable,
      testPaths: testPathsToRun,
      timeoutMs: timeoutMs ?? 120000,
      signal,
    });

    // Step 4: Parse actual output into counts and failure details
    const parsed = parsePytestOutput({
      stdout: execution.stdout,
      stderr: execution.stderr,
      exitCode: execution.exitCode,
      timedOut: execution.timedOut,
      cancelled: execution.cancelled,
    });

    const limitations = [
      ...selection.limitations,
      ...execution.limitations,
      ...parsed.limitations,
    ];

    if (selection.fallbackUsed) {
      limitations.push('Targeted subset could not be isolated; executed broader discovered suite.');
    }

    const report: VerificationReport = {
      requestId,
      status: parsed.status,
      runner: 'pytest',
      commandLabel: execution.commandLabel,
      selectedTests: selection.selectedTests,
      counts: parsed.counts,
      parsingComplete: parsed.parsingComplete,
      exitCode: execution.exitCode,
      durationMs: execution.durationMs,
      startedAt,
      completedAt: new Date().toISOString(),
      failures: parsed.failures,
      stdoutTail: execution.stdout,
      stderrTail: execution.stderr,
      outputTruncated: execution.truncated,
      limitations: Array.from(new Set(limitations)),
    };

    // Keep purely in-memory for subsequent MCP tool queries
    this.reportsCache.set(requestId, report);
    return report;
  }
}
