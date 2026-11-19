import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { normalizePosixPath } from './utils/path-validator';

export interface DiscoveredConfig {
  configFile?: string;
  hasPytest: boolean;
  pythonExecutable: string | null;
  testDirectories: string[];
  limitations: string[];
}

const CONFIG_FILES = [
  'pytest.ini',
  'pyproject.toml',
  'setup.cfg',
  'tox.ini',
];

const TEST_DIR_CANDIDATES = [
  'tests',
  'test',
];

const runnerCache = new Map<string, Promise<{ executable: string | null; error?: string }>>();

export function clearRunnerCache(): void {
  runnerCache.clear();
}

async function probeCandidate(
  candidate: string,
  signal?: AbortSignal
): Promise<boolean> {
  if (signal?.aborted) return false;
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(candidate, ['-m', 'pytest', '--version'], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let timer: NodeJS.Timeout | null = null;
      let resolved = false;

      const finish = (result: boolean) => {
        if (resolved) return;
        resolved = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      };

      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignored
        }
        finish(false);
      }, 2500);

      let output = '';
      child.stdout?.on('data', (d: Buffer) => { output += d.toString('utf-8'); });
      child.stderr?.on('data', (d: Buffer) => { output += d.toString('utf-8'); });

      child.on('error', () => finish(false));
      child.on('close', (code) => {
        finish(code === 0 || output.includes('pytest'));
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Checks if a python executable is available and can run pytest.
 * Non-blocking, caches per workspace, checks abort signal first.
 */
export async function detectPytestRunner(
  workspaceRoot: string,
  signal?: AbortSignal
): Promise<{ executable: string | null; error?: string }> {
  if (signal?.aborted) {
    return { executable: null, error: 'Cancelled' };
  }

  const normalizedRoot = path.resolve(workspaceRoot);
  const cached = runnerCache.get(normalizedRoot);
  if (cached) {
    return cached;
  }

  const probePromise = (async () => {
    // Check virtualenv in workspace first (Windows and Linux/macOS paths)
    const venvCandidates = [
      path.join(normalizedRoot, '.venv', 'Scripts', 'python.exe'),
      path.join(normalizedRoot, 'venv', 'Scripts', 'python.exe'),
      path.join(normalizedRoot, '.venv', 'bin', 'python'),
      path.join(normalizedRoot, 'venv', 'bin', 'python'),
    ];

    for (const candidate of venvCandidates) {
      if (signal?.aborted) {
        return { executable: null, error: 'Cancelled' };
      }
      try {
        await fs.access(candidate);
      } catch {
        continue; // File does not exist, skip spawn
      }
      if (await probeCandidate(candidate, signal)) {
        return { executable: candidate };
      }
    }

    // Check system python/python3
    const systemCandidates = process.platform === 'win32'
      ? ['python', 'py']
      : ['python3', 'python'];

    for (const cmd of systemCandidates) {
      if (signal?.aborted) {
        return { executable: null, error: 'Cancelled' };
      }
      if (await probeCandidate(cmd, signal)) {
        return { executable: cmd };
      }
    }

    return {
      executable: null,
      error: 'Test runner (pytest) was not found in the environment. TestSheriff never installs packages automatically.',
    };
  })();

  runnerCache.set(normalizedRoot, probePromise);
  return probePromise;
}

/**
 * Discovers existing test configuration and test directories in the workspace.
 */
export async function discoverWorkspaceTestConfig(
  workspaceRoot: string,
  signal?: AbortSignal
): Promise<DiscoveredConfig> {
  const limitations: string[] = [];
  let foundConfigFile: string | undefined;

  for (const cfg of CONFIG_FILES) {
    const fullPath = path.join(workspaceRoot, cfg);
    try {
      await fs.access(fullPath);
      foundConfigFile = cfg;
      break;
    } catch {
      // Not found, check next
    }
  }

  const testDirectories: string[] = [];
  for (const td of TEST_DIR_CANDIDATES) {
    const fullPath = path.join(workspaceRoot, td);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        testDirectories.push(td);
      }
    } catch {
      // Directory does not exist
    }
  }

  const runnerProbe = await detectPytestRunner(workspaceRoot, signal);
  if (!runnerProbe.executable) {
    limitations.push(runnerProbe.error || 'Pytest runner not available.');
  }

  return {
    configFile: foundConfigFile,
    hasPytest: runnerProbe.executable !== null,
    pythonExecutable: runnerProbe.executable,
    testDirectories,
    limitations,
  };
}

/**
 * Recursively lists all test files within a directory (.py files matching test_* or *_test).
 */
export async function findTestFiles(dir: string, baseRoot: string): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__pycache__' && entry.name !== '.pytest_cache' && entry.name !== 'node_modules') {
          results.push(...await findTestFiles(full, baseRoot));
        }
      } else if (entry.isFile() && entry.name.endsWith('.py')) {
        if (entry.name.startsWith('test_') || entry.name.endsWith('_test.py')) {
          const rel = path.relative(baseRoot, full);
          results.push(normalizePosixPath(rel));
        }
      }
    }
  } catch {
    // Return empty if directory cannot be read
  }

  return results.sort();
}
