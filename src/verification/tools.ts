/**
 * Plain MCP tool handlers for TestSheriff (Member 4).
 * Handlers wrap the shared VerificationService instance and return
 * { ok: true, value } | { ok: false, error: SafeError } without throwing.
 */

import type {
  SafeError,
  TestCandidate,
  TestRunRequest,
  VerificationReport,
  VerificationService,
} from '../shared/contracts';
import { toSafeError } from '../shared/contracts';
import type { VerificationServiceImpl } from './verification-service';

export interface VerificationToolHandlers {
  discover_tests(args: {
    changedFiles?: string[];
    candidateTests?: TestCandidate[];
  }): Promise<{ ok: true; value: TestCandidate[] } | { ok: false; error: SafeError }>;

  run_tests(
    request: TestRunRequest,
    signal?: AbortSignal
  ): Promise<{ ok: true; value: VerificationReport } | { ok: false; error: SafeError }>;

  get_test_results(args: {
    requestId: string;
  }): Promise<{ ok: true; value: VerificationReport | null } | { ok: false; error: SafeError }>;
}

/**
 * Creates MCP tool handlers bound to the provided VerificationService instance.
 * Shares the central agent's service instance so cached reports are accessible.
 */
export function createVerificationToolHandlers(service: VerificationService): VerificationToolHandlers {
  return {
    async discover_tests(args: {
      changedFiles?: string[];
      candidateTests?: TestCandidate[];
    }) {
      try {
        const changedFiles = args?.changedFiles ?? [];
        const candidateTests = args?.candidateTests ?? [];
        const value = await service.discoverTests(changedFiles, candidateTests);
        return { ok: true, value };
      } catch (err) {
        return { ok: false, error: toSafeError(err) };
      }
    },

    async run_tests(request: TestRunRequest, signal?: AbortSignal) {
      try {
        const value = await service.verify(request, signal);
        return { ok: true, value };
      } catch (err) {
        return { ok: false, error: toSafeError(err) };
      }
    },

    async get_test_results(args: { requestId: string }) {
      try {
        if (!args || !args.requestId) {
          return { ok: true, value: null };
        }
        const svc = service as VerificationServiceImpl;
        const report = typeof svc.getReport === 'function' ? svc.getReport(args.requestId) ?? null : null;
        return { ok: true, value: report };
      } catch (err) {
        return { ok: false, error: toSafeError(err) };
      }
    },
  };
}
