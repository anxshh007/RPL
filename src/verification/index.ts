// OWNER: Member 4 — TestSheriff (brief: docs/briefs/04_member4_testsheriff.md)
// STUB: never claims a run. Replace with discovery, selection, safe-process, pytest adapter, parser.
import type { TestCandidate, TestRunRequest, VerificationReport, VerificationService } from '../shared/contracts';

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

export function createVerificationService(): VerificationService {
  return {
    async discoverTests(_changedFiles: string[], candidates: TestCandidate[]): Promise<TestCandidate[]> {
      return candidates;
    },
    async verify(request: TestRunRequest): Promise<VerificationReport> {
      return notRunReport(request.requestId, 'TestSheriff is a stub: no tests were executed.');
    },
  };
}
