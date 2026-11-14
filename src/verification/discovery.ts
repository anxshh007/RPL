import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
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

/**
 * Checks if a python executable is available and can run pytest.
 */
export function detectPytestRunner(workspaceRoot: string): { executable: string | null; error?: string } {
  if (process.env.TESTSHERIFF_MOCK_OUTPUT !== undefined) {
    return { executable: 'python' };
  }

  // Check virtualenv in workspace first (Windows and Linux/macOS paths)
  const venvCandidates = [
    path.join(workspaceRoot, '.venv', 'Scripts', 'python.exe'),
    path.join(workspaceRoot, 'venv', 'Scripts', 'python.exe'),
    path.join(workspaceRoot, '.venv', 'bin', 'python'),
    path.join(workspaceRoot, 'venv', 'bin', 'python'),
  ];

  for (const candidate of venvCandidates) {
    try {
      const probe = spawnSync(candidate, ['-m', 'pytest', '--version'], {
        encoding: 'utf-8',
        timeout: 5000,
        shell: false,
      });
      if (probe.status === 0 || (probe.stdout && probe.stdout.includes('pytest'))) {
        return { executable: candidate };
      }
    } catch {
      // Continue checking next candidate
    }
  }

  // Check system python/python3
  const systemCandidates = process.platform === 'win32'
    ? ['python', 'py']
    : ['python3', 'python'];

  for (const cmd of systemCandidates) {
    try {
      const probe = spawnSync(cmd, ['-m', 'pytest', '--version'], {
        encoding: 'utf-8',
        timeout: 5000,
        shell: false,
      });
      if (probe.status === 0 && ((probe.stdout && probe.stdout.includes('pytest')) || (probe.stderr && probe.stderr.includes('pytest')))) {
        return { executable: cmd };
      }
    } catch {
      // Continue checking
    }
  }

  return {
    executable: null,
    error: 'Test runner (pytest) was not found in the environment. TestSheriff never installs packages automatically.',
  };
}

/**
 * Discovers existing test configuration and test directories in the workspace.
 */
export async function discoverWorkspaceTestConfig(workspaceRoot: string): Promise<DiscoveredConfig> {
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

  const runnerProbe = detectPytestRunner(workspaceRoot);
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
