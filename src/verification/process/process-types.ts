/**
 * Process Runner Types & Contracts
 */

export interface SafeProcessOptions {
  /** Executable binary name (must be in allowlist) */
  executable: string;
  /** Explicit array of command line arguments */
  args: string[];
  /** Working directory (must be validated workspace root) */
  cwd: string;
  /** Execution timeout in milliseconds */
  timeoutMs?: number;
  /** Maximum stdout + stderr output length in bytes */
  maxOutputBytes?: number;
  /** AbortSignal for user cancellation */
  signal?: AbortSignal;
  /** Environment variable overrides */
  env?: Record<string, string>;
}

export interface SafeProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
}
