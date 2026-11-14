/**
 * RepoPilot AI — Layer 2 ImpactLens Contract
 * Integration types consumed from Member 3 (ImpactLens) by TestSheriff (Member 4).
 */

import type { TestCandidate, ConfidenceLevel } from "./verification.ts";

export interface ImpactedFile {
  filePath: string;
  impactType: "direct" | "dependency" | "test";
  confidence: ConfidenceLevel;
  reason: string;
}

export interface ImpactReport {
  requestId: string;
  changedFiles: string[];
  impactedFiles: ImpactedFile[];
  candidateTests: TestCandidate[];
  summary: string;
  timestamp: string;
}
