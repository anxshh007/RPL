/**
 * OWNER: Member 4 — TestSheriff (brief: docs/briefs/04_member4_testsheriff.md)
 * Layer 3 Automated Test Discovery, Safe Pytest Execution & Truthful Verification.
 */

import type { VerificationService } from '../shared/contracts';
import {
  VerificationServiceImpl,
  notRunReport,
  type VerificationServiceOptions,
} from './verification-service';
import type { ProcessRunner } from './safe-runner';

export function createVerificationService(
  workspaceRoot: string,
  options?: VerificationServiceOptions
): VerificationService;
export function createVerificationService(
  options: { workspaceRoot: string; runProcess?: ProcessRunner }
): VerificationService;
export function createVerificationService(
  workspaceRootOrOptions?: string | { workspaceRoot?: string; runProcess?: ProcessRunner },
  options?: VerificationServiceOptions
): VerificationService;
export function createVerificationService(
  workspaceRootOrOptions?: string | { workspaceRoot?: string; runProcess?: ProcessRunner },
  options?: VerificationServiceOptions
): VerificationService {
  if (typeof workspaceRootOrOptions === 'object' && workspaceRootOrOptions !== null) {
    return new VerificationServiceImpl(workspaceRootOrOptions.workspaceRoot, {
      runProcess: workspaceRootOrOptions.runProcess ?? options?.runProcess,
    });
  }
  return new VerificationServiceImpl(workspaceRootOrOptions, options);
}

export {
  VerificationServiceImpl,
  notRunReport,
  type VerificationServiceOptions,
  type ProcessRunner,
};
export * from './tools';
