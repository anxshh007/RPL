import { spawn, type ChildProcess } from 'node:child_process';
import { validateWorkspacePath } from './utils/path-validator';
import { redactSecrets, sanitizeEnvironment } from './utils/redactor';

export interface ExecutionParams {
  workspaceRoot: string;
  pythonExecutable: string;
  testPaths: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ExecutionOutput {
  commandLabel: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
  limitations: string[];
}

export type ProcessRunner = (params: ExecutionParams) => Promise<ExecutionOutput>;

const MAX_OUTPUT_BYTES = 64 * 1024; // 64 KB

/**
 * Validates the exact command shape permitted by TestSheriff:
 * Executable: python / python3 (or virtualenv path)
 * Arguments: ['-m', 'pytest', '-o', 'addopts=', '-p', 'no:cacheprovider', '-q', '-rfE', ...validatedTestPaths]
 * Rejects any arbitrary command strings or non-pytest shapes.
 */
export function validateCommandArguments(
  testPaths: string[],
  workspaceRoot: string
): { validatedPaths: string[]; args: string[] } {
  if (!Array.isArray(testPaths) || testPaths.length === 0) {
    throw new Error('TestSheriff requires at least one test path to execute.');
  }

  const validatedPaths: string[] = [];
  for (const rawPath of testPaths) {
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      throw new Error(`Invalid test path: ${String(rawPath)}`);
    }

    // Must be contained within workspace
    const validated = validateWorkspacePath(workspaceRoot, rawPath);

    // Reject dangerous characters that could attempt subshell or option injection
    if (/[\r\n;&|`$]/.test(validated)) {
      throw new Error(`Disallowed characters in test path: ${validated}`);
    }

    if (validated.startsWith('-')) {
      throw new Error(`Flags are not permitted as test paths: ${validated}`);
    }

    validatedPaths.push(validated);
  }

  // Exactly one command shape: python -m pytest -o addopts= -p no:cacheprovider -q -rfE <paths>
  const args = ['-m', 'pytest', '-o', 'addopts=', '-p', 'no:cacheprovider', '-q', '-rfE', ...validatedPaths];
  return { validatedPaths, args };
}

/**
 * Cross-platform process tree termination.
 * On Windows: spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { shell: false })
 * On Linux/macOS: process.kill(-pid, 'SIGKILL') or child.kill('SIGKILL')
 */
export async function killProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      try {
        const killer = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
          shell: false,
          stdio: 'ignore',
        });
        killer.on('close', () => resolve());
        killer.on('error', () => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Ignored
          }
          resolve();
        });
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignored
        }
        resolve();
      }
    });
  } else {
    try {
      // If spawned in a new process group, kill negative PID
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignored
      }
    }
  }
}

/**
 * Executes pytest in a safe, controlled child process.
 * Never executes shell strings. Enforces exact argument array, timeout, AbortSignal,
 * bounded output buffers, and secret redaction.
 */
export async function executePytest(params: ExecutionParams): Promise<ExecutionOutput> {
  const { workspaceRoot, pythonExecutable, testPaths, timeoutMs = 120000, signal } = params;

  // Validate command shape strictly
  const { validatedPaths, args } = validateCommandArguments(testPaths, workspaceRoot);

  const commandLabel = `python -m pytest -o addopts= -p no:cacheprovider -q -rfE ${validatedPaths.join(' ')}`;
  const limitations: string[] = [];

  // Check if signal is already aborted
  if (signal?.aborted) {
    return {
      commandLabel,
      exitCode: null,
      durationMs: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      cancelled: true,
      truncated: false,
      limitations: ['Verification was cancelled via AbortSignal.'],
    };
  }

  const startTime = Date.now();
  let timedOut = false;
  let cancelled = false;
  let truncated = false;

  let stdoutBytes = 0;
  let stderrBytes = 0;
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  // Clean environment: sanitize secrets + prevent writing .pyc files
  const safeEnv: NodeJS.ProcessEnv = {
    ...sanitizeEnvironment(process.env),
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUNBUFFERED: '1',
    // Plain text output: colour codes around the summary line make the counts unparseable.
    PY_COLORS: '0',
    NO_COLOR: '1',
  };
  delete safeEnv.FORCE_COLOR;

  return new Promise<ExecutionOutput>((resolve) => {
    let child: ChildProcess;
    let timer: NodeJS.Timeout | null = null;
    let finished = false;

    const cleanup = () => {
      finished = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    const getCappedString = (chunks: Buffer[]): string => {
      if (chunks.length === 0) return '';
      const full = Buffer.concat(chunks);
      if (full.length > MAX_OUTPUT_BYTES) {
        return full.subarray(full.length - MAX_OUTPUT_BYTES).toString('utf-8');
      }
      return full.toString('utf-8');
    };

    const abortHandler = () => {
      if (finished) return;
      finished = true;
      cancelled = true;
      limitations.push('Verification was cancelled via AbortSignal.');
      cleanup();
      resolve({
        commandLabel,
        exitCode: null,
        durationMs: Date.now() - startTime,
        stdout: redactSecrets(getCappedString(stdoutChunks)),
        stderr: redactSecrets(getCappedString(stderrChunks)),
        timedOut: false,
        cancelled: true,
        truncated,
        limitations,
      });
      void killProcessTree(child);
    };

    if (signal) {
      signal.addEventListener('abort', abortHandler);
    }

    try {
      // Spawn strictly with argument array and shell: false
      child = spawn(pythonExecutable, args, {
        cwd: workspaceRoot,
        env: safeEnv,
        shell: false,
        detached: process.platform !== 'win32', // Allows process group kill on POSIX
      });
    } catch (err) {
      cleanup();
      return resolve({
        commandLabel,
        exitCode: 127,
        durationMs: 0,
        stdout: '',
        stderr: (err as Error).message,
        timedOut: false,
        cancelled: false,
        truncated: false,
        limitations: [`Failed to spawn test runner process: ${(err as Error).message}`],
      });
    }

    // Set timeout timer
    timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      timedOut = true;
      limitations.push(`Test execution timed out after ${timeoutMs}ms and was terminated.`);
      cleanup();
      resolve({
        commandLabel,
        exitCode: null,
        durationMs: Date.now() - startTime,
        stdout: redactSecrets(getCappedString(stdoutChunks)),
        stderr: redactSecrets(getCappedString(stderrChunks)),
        timedOut: true,
        cancelled: false,
        truncated,
        limitations,
      });
      void killProcessTree(child);
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        truncated = true;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        truncated = true;
      }
      stderrChunks.push(chunk);
    });

    child.on('error', (err) => {
      if (finished || cancelled || timedOut) return;
      finished = true;
      cleanup();
      limitations.push(`Process error: ${err.message}`);
      resolve({
        commandLabel,
        exitCode: null,
        durationMs: Date.now() - startTime,
        stdout: redactSecrets(getCappedString(stdoutChunks)),
        stderr: redactSecrets(getCappedString(stderrChunks)),
        timedOut: false,
        cancelled: false,
        truncated,
        limitations,
      });
    });

    child.on('close', (code) => {
      if (finished || cancelled || timedOut) return;
      finished = true;
      cleanup();

      if (truncated) {
        limitations.push('Output exceeded 64 KB buffer and was truncated.');
      }

      resolve({
        commandLabel,
        exitCode: code,
        durationMs: Date.now() - startTime,
        stdout: redactSecrets(getCappedString(stdoutChunks)),
        stderr: redactSecrets(getCappedString(stderrChunks)),
        timedOut: false,
        cancelled: false,
        truncated,
        limitations,
      });
    });
  });
}
