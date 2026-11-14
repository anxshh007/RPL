/**
 * RepoPilot AI — Shared MCP Contract
 * Defines tool definitions, JSON schemas, and protocol structures
 * for Member 1 (Central Agent Orchestrator) to register TestSheriff tools.
 */

import type { VerificationReport, TestCandidate } from "./verification.ts";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface RunTestsInput {
  requestId: string;
  workspaceRoot: string;
  changedFiles: string[];
  candidateTests?: TestCandidate[];
  approvedRunner?: "pytest";
  timeoutMs?: number;
  environment?: Record<string, string>;
  pythonPath?: string;
  maxOutputBytes?: number;
}

export interface GetTestResultsInput {
  requestId: string;
}

export interface DiscoverTestsInput {
  workspaceRoot: string;
  changedFiles?: string[];
  candidateTests?: TestCandidate[];
}

export interface DiscoverTestsOutput {
  workspaceRoot: string;
  runner: string;
  detectedConfigs: string[];
  candidateTests: TestCandidate[];
  selectedTests: string[];
  summary: string;
}

export interface McpToolResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
