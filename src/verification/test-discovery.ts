/**
 * Test Discovery Engine
 * Scans workspace to detect test framework configurations, test directories,
 * and test file candidates.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { normalizePath, validateSafePath } from "../shared/utils/path-validator.ts";
import type { TestDiscoveryResult } from "../shared/types/verification.ts";

const CONFIG_FILES = [
  "pytest.ini",
  "pyproject.toml",
  "tox.ini",
  "setup.cfg",
];

const TEST_DIR_NAMES = ["tests", "test", "testing"];

/**
 * Scans for conftest.py files in test directories and workspace root.
 */
export function scanConftestFiles(workspaceRoot: string): string[] {
  const safeRoot = validateSafePath(workspaceRoot, workspaceRoot);
  const conftestList: string[] = [];

  function search(dir: string, depth: number = 0) {
    if (depth > 4 || !fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "venv" || entry.name === ".venv") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          search(full, depth + 1);
        } else if (entry.isFile() && entry.name === "conftest.py") {
          conftestList.push(path.relative(safeRoot, full).replace(/\\/g, "/"));
        }
      }
    } catch {
      // Ignore
    }
  }

  search(safeRoot);
  return conftestList.sort();
}

/**
 * Inspects doc files (README.md, CONTRIBUTING.md, etc.) for existing test instructions.
 */
export function extractTestInstructions(workspaceRoot: string): string[] {
  const safeRoot = validateSafePath(workspaceRoot, workspaceRoot);
  const docCandidates = ["README.md", "CONTRIBUTING.md", "DEVELOPMENT.md", "TESTING.md"];
  const instructions: string[] = [];

  for (const doc of docCandidates) {
    const full = path.join(safeRoot, doc);
    if (fs.existsSync(full)) {
      try {
        const content = fs.readFileSync(full, "utf-8");
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (
            (trimmed.includes("pytest") || trimmed.includes("tox") || trimmed.includes("python -m unittest")) &&
            (trimmed.startsWith("$") || trimmed.startsWith("`") || trimmed.startsWith(">") || trimmed.startsWith("run "))
          ) {
            instructions.push(`[${doc}] ${trimmed.replace(/[`$]/g, "").trim()}`);
          }
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  return instructions.slice(0, 5); // Keep top 5 concise instructions
}
export function scanTestFiles(dirPath: string, workspaceRoot: string, maxDepth: number = 5): string[] {
  const results: string[] = [];
  const normalizedRoot = normalizePath(workspaceRoot);

  function walk(currentDir: string, currentDepth: number) {
    if (currentDepth > maxDepth) return;
    if (!fs.existsSync(currentDir)) return;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // Skip hidden directories, virtualenvs, cache folders
      if (entry.name.startsWith(".") || entry.name === "__pycache__" || entry.name === "node_modules" || entry.name === "venv" || entry.name === ".venv") {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath, currentDepth + 1);
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        if ((lower.startsWith("test_") || lower.endsWith("_test.py")) && lower.endsWith(".py")) {
          const relative = path.relative(normalizedRoot, fullPath).replace(/\\/g, "/");
          results.push(relative);
        }
      }
    }
  }

  walk(dirPath, 0);
  return results.sort();
}

/**
 * Discovers test configuration and test files in the workspace.
 */
export async function discoverTests(workspaceRoot: string): Promise<TestDiscoveryResult> {
  const safeRoot = validateSafePath(workspaceRoot, workspaceRoot);
  const detectedConfigs: string[] = [];
  const reasons: string[] = [];
  const testDirectories: string[] = [];

  // 1. Inspect test configuration files
  for (const configFile of CONFIG_FILES) {
    const fullPath = path.join(safeRoot, configFile);
    if (fs.existsSync(fullPath)) {
      if (configFile === "pyproject.toml") {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          if (content.includes("[tool.pytest") || content.includes("pytest")) {
            detectedConfigs.push(configFile);
            reasons.push(`Detected pytest configuration in ${configFile}`);
          }
        } catch {
          // Ignore
        }
      } else if (configFile === "pytest.ini") {
        detectedConfigs.push(configFile);
        reasons.push(`Detected dedicated pytest configuration file: ${configFile}`);
      } else {
        detectedConfigs.push(configFile);
        reasons.push(`Detected Python configuration file: ${configFile}`);
      }
    }
  }

  // 2. Discover test directories
  for (const dirName of TEST_DIR_NAMES) {
    const fullDir = path.join(safeRoot, dirName);
    if (fs.existsSync(fullDir)) {
      try {
        const stat = fs.statSync(fullDir);
        if (stat.isDirectory()) {
          testDirectories.push(dirName);
          reasons.push(`Found test directory: ${dirName}/`);
        }
      } catch {
        // Ignore
      }
    }
  }

  // 3. Scan for test files in test directories and root
  const allTestFiles = new Set<string>();
  if (testDirectories.length > 0) {
    for (const dirName of testDirectories) {
      const files = scanTestFiles(path.join(safeRoot, dirName), safeRoot);
      files.forEach((f) => allTestFiles.add(f));
    }
  } else {
    // If no explicit tests/ dir, scan root lightly
    const rootFiles = scanTestFiles(safeRoot, safeRoot, 2);
    rootFiles.forEach((f) => allTestFiles.add(f));
  }

  const conftestFiles = scanConftestFiles(safeRoot);
  if (conftestFiles.length > 0) {
    reasons.push(`Detected ${conftestFiles.length} conftest.py fixture definition file(s)`);
  }

  const testInstructions = extractTestInstructions(safeRoot);
  if (testInstructions.length > 0) {
    reasons.push(`Found documented test instructions: ${testInstructions[0]}`);
  }

  const isConfigured = detectedConfigs.length > 0 || testDirectories.length > 0 || conftestFiles.length > 0;
  const runner = isConfigured || allTestFiles.size > 0 ? "pytest" : "unsupported";

  return {
    workspaceRoot: safeRoot,
    runner,
    detectedConfigs,
    testFiles: Array.from(allTestFiles).sort(),
    testDirectories,
    conftestFiles,
    testInstructions,
    isConfigured,
    reasons,
  };
}
