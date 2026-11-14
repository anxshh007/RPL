import { spawn, type ChildProcess } from 'node:child_process';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { validateWorkspacePath } from './utils/path-validator';
import { redactSecrets, sanitizeEnvironment } from './utils/redactor';

const execAsync = promisify(exec);

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

const MAX_OUTPUT_BYTES = 64 * 1024; // 64 KB

/**
 * Validates the exact command shape permitted by TestSheriff:
 * Executable: python / python3 (or virtualenv path)
 * Arguments: ['-m', 'pytest', ...validatedTestPaths, '-q', '-p', 'no:cacheprovider']
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

  // Exactly one command shape: python -m pytest <paths> -q -p no:cacheprovider
  const args = ['-m', 'pytest', ...validatedPaths, '-q', '-p', 'no:cacheprovider'];
  return { validatedPaths, args };
}

/**
 * Cross-platform process tree termination.
 * On Windows: taskkill /F /T /PID <pid>
 * On Linux/macOS: process.kill(-pid, 'SIGKILL') or child.kill('SIGKILL')
 */
export async function killProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;

  if (process.platform === 'win32') {
    try {
      await execAsync(`taskkill /F /T /PID ${child.pid}`);
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignored if already terminated
      }
    }
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

  const commandLabel = `python -m pytest ${validatedPaths.join(' ')} -q`;
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

  // Support mock runner hook for reproducible testing across environments without pytest
  if (process.env.TESTSHERIFF_MOCK_OUTPUT !== undefined) {
    const mockExit = process.env.TESTSHERIFF_MOCK_EXITCODE !== undefined
      ? parseInt(process.env.TESTSHERIFF_MOCK_EXITCODE, 10)
      : 0;
    const mockTimedOut = process.env.TESTSHERIFF_MOCK_TIMEDOUT === '1';
    const mockCancelled = process.env.TESTSHERIFF_MOCK_CANCELLED === '1';

    return {
      commandLabel,
      exitCode: mockTimedOut || mockCancelled ? null : mockExit,
      durationMs: 42,
      stdout: redactSecrets(process.env.TESTSHERIFF_MOCK_OUTPUT),
      stderr: redactSecrets(process.env.TESTSHERIFF_MOCK_STDERR || ''),
      timedOut: mockTimedOut,
      cancelled: mockCancelled,
      truncated: false,
      limitations: mockTimedOut
        ? [`Test execution timed out after ${timeoutMs}ms and was terminated.`]
        : mockCancelled
        ? ['Verification was cancelled via AbortSignal.']
        : [],
    };
  }

  const startTime = Date.now();
  let timedOut = false;
  let cancelled = false;
  let truncated = false;

  let stdoutBuffer = '';
  let stderrBuffer = '';

  // Clean environment: sanitize secrets + prevent writing .pyc files
  const safeEnv: NodeJS.ProcessEnv = {
    ...sanitizeEnvironment(process.env),
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUNBUFFERED: '1',
  };

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

    const abortHandler = async () => {
      if (finished) return;
      cancelled = true;
      limitations.push('Verification was cancelled via AbortSignal.');
      await killProcessTree(child);
      cleanup();
      resolve({
        commandLabel,
        exitCode: null,
        durationMs: Date.now() - startTime,
        stdout: redactSecrets(stdoutBuffer),
        stderr: redactSecrets(stderrBuffer),
        timedOut: false,
        cancelled: true,
        truncated,
        limitations,
      });
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
    timer = setTimeout(async () => {
      if (finished) return;
      timedOut = true;
      limitations.push(`Test execution timed out after ${timeoutMs}ms and was terminated.`);
      await killProcessTree(child);
      cleanup();
      resolve({
        commandLabel,
        exitCode: null,
        durationMs: Date.now() - startTime,
        stdout: redactSecrets(stdoutBuffer),
        stderr: redactSecrets(stderrBuffer),
        timedOut: true,
        cancelled: false,
        truncated,
        limitations,
      });
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutBuffer.length + chunk.length > MAX_OUTPUT_BYTES) {
        truncated = true;
        stdoutBuffer = (stdoutBuffer + chunk.toString('utf-8')).slice(-MAX_OUTPUT_BYTES);
      } else {
        stdoutBuffer += chunk.toString('utf-8');
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBuffer.length + chunk.length > MAX_OUTPUT_BYTES) {
        truncated = true;
        stderrBuffer = (stderrBuffer + chunk.toString('utf-8')).slice(-MAX_OUTPUT_BYTES);
      } else {
        stderrBuffer += chunk.toString('utf-8');
      }
    });

    child.on('error', (err) => {
      if (finished) return;
      cleanup();
      limitations.push(`Process error: ${err.message}`);
      resolve({
        commandLabel,
        exitCode: null,
        durationMs: Date.now() - startTime,
        stdout: redactSecrets(stdoutBuffer),
        stderr: redactSecrets(stderrBuffer),
        timedOut: false,
        cancelled: false,
        truncated,
        limitations,
      });
    });

    child.on('close', (code) => {
      if (finished) return;
      cleanup();

      if (truncated) {
        limitations.push('Output exceeded 64 KB buffer and was truncated.');
      }

      resolve({
        commandLabel,
        exitCode: code,
        durationMs: Date.now() - startTime,
        stdout: redactSecrets(stdoutBuffer),
        stderr: redactSecrets(stderrBuffer),
        timedOut: false,
        cancelled: false,
        truncated,
        limitations,
      });
    });
  });
}
