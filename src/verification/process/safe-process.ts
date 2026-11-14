/**
 * Safe Process Execution Engine
 * Enforces executable allowlisting, non-shell argument arrays, strict workspace scoping,
 * bounded output buffers, timeout enforcement, process cancellation, and secret redaction.
 */

import { spawn, execSync, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { validateSafePath } from "../../shared/utils/path-validator.ts";
import { redactSecrets, sanitizeEnvironment } from "../../shared/utils/redactor.ts";
import { SecurityViolationError, ExecutionTimeoutError, ExecutionCancellationError } from "../errors.ts";
import type { SafeProcessOptions, SafeProcessResult } from "./process-types.ts";

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 300000; // 5 minutes max
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024; // 512 KB

const ALLOWED_EXECUTABLE_NAMES = new Set([
  "python",
  "python.exe",
  "python3",
  "python3.exe",
  "py",
  "py.exe",
  "pytest",
  "pytest.exe",
  "node",
  "node.exe",
  "node.cmd",
]);

const FORBIDDEN_ARG_PATTERNS = [
  /--upgrade/i,
  /\bpip\b/i,
  /\binstall\b/i,
  /\buninstall\b/i,
  /\brm\b/i,
  /\bdel\b/i,
  /\bformat\b/i,
  /\bsudo\b/i,
  /\brunas\b/i,
];

/**
 * Validates executable name or path against the security allowlist.
 */
export function validateExecutable(executable: string, workspaceRoot: string): string {
  if (!executable || typeof executable !== "string") {
    throw new SecurityViolationError("Executable must be a non-empty string");
  }

  const baseName = path.basename(executable).toLowerCase();

  // 1. Is it a standard allowlisted executable name?
  if (ALLOWED_EXECUTABLE_NAMES.has(baseName)) {
    // If it is a relative or absolute path, ensure it's either in PATH or strictly inside workspace
    if (executable.includes("/") || executable.includes("\\")) {
      try {
        return validateSafePath(executable, workspaceRoot);
      } catch {
        // If not in workspace, ensure it's just the base executable name
        return baseName;
      }
    }
    return executable;
  }

  // 2. Is it a workspace virtualenv python (e.g. .venv/Scripts/python.exe)?
  try {
    const safePath = validateSafePath(executable, workspaceRoot);
    if (baseName.startsWith("python") || baseName.startsWith("pytest")) {
      return safePath;
    }
  } catch {
    // Fall through to error
  }

  throw new SecurityViolationError(
    `Executable "${executable}" is rejected by security policy. Only approved test runners are permitted.`
  );
}

/**
 * Validates process arguments to prevent dangerous command flags or package installations.
 */
export function validateArguments(args: string[]): void {
  for (const arg of args) {
    if (typeof arg !== "string") {
      throw new SecurityViolationError("All process arguments must be strings");
    }

    // Check for forbidden arguments like pip, install, sudo
    for (const pattern of FORBIDDEN_ARG_PATTERNS) {
      if (pattern.test(arg)) {
        throw new SecurityViolationError(
          `Argument "${arg}" is prohibited by the test execution security policy.`
        );
      }
    }
  }
}

/**
 * Forcefully terminates a child process and its entire process tree.
 */
export function terminateProcessTree(child: ChildProcess): void {
  if (!child.pid || child.killed) return;

  try {
    child.kill("SIGKILL");
  } catch {
    // Process might already be dead
  }

  if (process.platform === "win32") {
    try {
      execSync(`C:\\Windows\\System32\\taskkill.exe /F /T /PID ${child.pid}`, {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      // Process already terminated
    }
  } else {
    try {
      // Kill entire process group on POSIX
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Ignored
    }
  }
}

/**
 * Executes an allowlisted test process safely inside the workspace.
 */
export async function runSafeProcess(options: SafeProcessOptions): Promise<SafeProcessResult> {
  const { cwd, executable, args, signal } = options;

  // Validate working directory
  const safeCwd = validateSafePath(cwd, cwd);
  // Validate executable
  const safeExecutable = validateExecutable(executable, safeCwd);
  // Validate arguments
  validateArguments(args);

  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 100), MAX_TIMEOUT_MS);
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  // Check cancellation before spawning
  if (signal?.aborted) {
    throw new ExecutionCancellationError();
  }

  const startTime = performance.now();
  let timedOut = false;
  let cancelled = false;
  let truncated = false;

  let stdoutBytes = 0;
  let stderrBytes = 0;
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  // Sanitize environment variables
  const safeEnv = sanitizeEnvironment({
    ...process.env,
    ...(options.env ?? {}),
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
  });

  let spawnExec = safeExecutable;
  let spawnArgs = [...args];

  // Windows Node wrapper handling: resolve node to process.execPath directly
  if (process.platform === "win32") {
    const base = path.basename(safeExecutable).toLowerCase();
    if (base === "node" || base === "node.exe" || base === "node.cmd") {
      spawnExec = process.execPath;
      safeEnv.ELECTRON_RUN_AS_NODE = "1";
    } else if (base.endsWith(".cmd") || base.endsWith(".bat")) {
      spawnExec = process.env.COMSPEC || "cmd.exe";
      spawnArgs = ["/d", "/s", "/c", safeExecutable, ...args];
    }
  }

  return new Promise<SafeProcessResult>((resolve, reject) => {
    let child: ChildProcess;
    let timer: NodeJS.Timeout | null = null;

    try {
      child = spawn(spawnExec, spawnArgs, {
        cwd: safeCwd,
        env: safeEnv,
        shell: false, // CRITICAL: No shell interpolation
        windowsHide: true,
      });
    } catch (err) {
      return reject(err);
    }

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const onAbort = async () => {
      cancelled = true;
      cleanup();
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
      terminateProcessTree(child);
      const durationMs = Math.round(performance.now() - startTime);
      const combined = redactSecrets(
        Buffer.concat([...stdoutChunks, ...stderrChunks]).toString("utf-8")
      );
      resolve({
        exitCode: 130, // SIGINT convention
        stdout: redactSecrets(Buffer.concat(stdoutChunks).toString("utf-8")),
        stderr: redactSecrets(Buffer.concat(stderrChunks).toString("utf-8")),
        combinedOutput: combined,
        durationMs,
        timedOut: false,
        cancelled: true,
        truncated,
      });
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timer = setTimeout(async () => {
      timedOut = true;
      cleanup();
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
      terminateProcessTree(child);
      const durationMs = Math.round(performance.now() - startTime);
      const combined = redactSecrets(
        Buffer.concat([...stdoutChunks, ...stderrChunks]).toString("utf-8")
      );
      resolve({
        exitCode: 124, // Timeout convention
        stdout: redactSecrets(Buffer.concat(stdoutChunks).toString("utf-8")),
        stderr: redactSecrets(Buffer.concat(stderrChunks).toString("utf-8")),
        combinedOutput: combined,
        durationMs,
        timedOut: true,
        cancelled: false,
        truncated,
      });
    }, timeoutMs);
    timer.unref();

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes + chunk.length <= maxOutputBytes) {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      } else {
        truncated = true;
        const remaining = maxOutputBytes - stdoutBytes;
        if (remaining > 0) {
          stdoutChunks.push(chunk.subarray(0, remaining));
          stdoutBytes += remaining;
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes + chunk.length <= maxOutputBytes) {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      } else {
        truncated = true;
        const remaining = maxOutputBytes - stderrBytes;
        if (remaining > 0) {
          stderrChunks.push(chunk.subarray(0, remaining));
          stderrBytes += remaining;
        }
      }
    });

    child.on("error", (err) => {
      cleanup();
      reject(err);
    });

    child.on("close", (exitCode) => {
      cleanup();
      const durationMs = Math.round(performance.now() - startTime);
      const rawStdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const rawStderr = Buffer.concat(stderrChunks).toString("utf-8");

      const stdout = redactSecrets(rawStdout);
      const stderr = redactSecrets(rawStderr);
      const combinedOutput = stdout + (stderr ? `\n--- STDERR ---\n${stderr}` : "");

      resolve({
        exitCode: exitCode ?? (timedOut ? 124 : cancelled ? 130 : 1),
        stdout,
        stderr,
        combinedOutput,
        durationMs,
        timedOut,
        cancelled,
        truncated,
      });
    });
  });
}
