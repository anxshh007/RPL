/**
 * Test Runner Interfaces & Framework Abstraction
 */

import type { SafeProcessResult } from "../process/process-types.ts";

export interface RunnerExecutionOptions {
  workspaceRoot: string;
  testPaths: string[];
  timeoutMs?: number;
  pythonPath?: string;
  environment?: Record<string, string>;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface RunnerResult {
  runner: string;
  commandLabel: string;
  testPaths: string[];
  processResult: SafeProcessResult;
}

export interface ITestRunner {
  readonly name: string;
  detect(workspaceRoot: string): Promise<boolean>;
  execute(options: RunnerExecutionOptions): Promise<RunnerResult>;
}
