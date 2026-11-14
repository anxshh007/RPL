/**
 * Plain MCP tool handlers for TestSheriff (Member 4).
 * Exported here and registered by Member 1 in src/mcp/ (docs/DECISIONS.md D-07).
 */

import type { TestCandidate, TestRunRequest, VerificationReport } from '../shared/contracts';
import { VerificationServiceImpl } from './verification-service';

// Shared service instance
const defaultService = new VerificationServiceImpl();

/**
 * Handler for discover_tests MCP tool.
 * Discovers candidate tests for a given list of changed files.
 */
export async function discover_tests(args: {
  changedFiles?: string[];
  candidateTests?: TestCandidate[];
}): Promise<TestCandidate[]> {
  const changedFiles = args?.changedFiles ?? [];
  const candidateTests = args?.candidateTests ?? [];
  return defaultService.discoverTests(changedFiles, candidateTests);
}

/**
 * Handler for run_tests MCP tool.
 * Executes relevant tests safely through pytest with timeout and AbortSignal support.
 */
export async function run_tests(
  request: TestRunRequest,
  signal?: AbortSignal
): Promise<VerificationReport> {
  return defaultService.verify(request, signal);
}

/**
 * Handler for get_test_results MCP tool.
 * Retrieves in-memory cached VerificationReport by requestId.
 */
export async function get_test_results(args: {
  requestId: string;
}): Promise<VerificationReport | null> {
  if (!args || !args.requestId) {
    return null;
  }
  return defaultService.getReport(args.requestId) ?? null;
}
