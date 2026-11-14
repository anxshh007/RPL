/**
 * OWNER: Member 4 — TestSheriff (brief: docs/briefs/04_member4_testsheriff.md)
 * Layer 3 Automated Test Discovery, Safe Pytest Execution & Truthful Verification.
 */

import type { VerificationService } from '../shared/contracts';
import { VerificationServiceImpl, notRunReport } from './verification-service';

export function createVerificationService(workspaceRoot?: string): VerificationService {
  return new VerificationServiceImpl(workspaceRoot);
}

export { VerificationServiceImpl, notRunReport };
export * from './tools';
