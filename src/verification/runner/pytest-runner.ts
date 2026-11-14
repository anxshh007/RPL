/**
 * Pytest Test Runner Adapter
 * Handles Python environment detection, argument construction, safe execution,
 * and error boundary handling for Python / pytest test suites (e.g. Flask challenge).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { validateSafePaths, validateSafePath } from "../../shared/utils/path-validator.ts";
import { runSafeProcess } from "../process/safe-process.ts";
import { RunnerNotFoundError } from "../errors.ts";
import type { ITestRunner, RunnerExecutionOptions, RunnerResult } from "./runner-types.ts";
import type { SafeProcessResult } from "../process/process-types.ts";

export class PytestRunner implements ITestRunner {
  public readonly name = "pytest";

  /**
   * Detects whether pytest is configured in the repository.
   */
  async detect(workspaceRoot: string): Promise<boolean> {
    const configFiles = [
      "pytest.ini",
      "pyproject.toml",
      "tox.ini",
      "setup.cfg",
    ];

    for (const file of configFiles) {
      const fullPath = path.join(workspaceRoot, file);
      if (fs.existsSync(fullPath)) {
        if (file === "pyproject.toml") {
          try {
            const content = fs.readFileSync(fullPath, "utf-8");
            if (content.includes("[tool.pytest") || content.includes("pytest")) {
              return true;
            }
          } catch {
            // Ignore read errors
          }
        } else {
          return true;
        }
      }
    }

    // Check if tests directory exists
    const testsDir = path.join(workspaceRoot, "tests");
    if (fs.existsSync(testsDir) && fs.statSync(testsDir).isDirectory()) {
      return true;
    }

    return false;
  }

  /**
   * Resolves the best available Python interpreter.
   */
  public async resolvePythonInterpreter(workspaceRoot: string, customPath?: string): Promise<string> {
    // 1. Explicit user/caller specified path
    if (customPath) {
      const safeCustom = validateSafePath(customPath, workspaceRoot);
      if (fs.existsSync(safeCustom)) {
        return safeCustom;
      }
    }

    // 2. Workspace-local virtual environment
    const venvCandidates = [
      path.join(workspaceRoot, ".venv", "Scripts", "python.exe"),
      path.join(workspaceRoot, ".venv", "bin", "python"),
      path.join(workspaceRoot, "venv", "Scripts", "python.exe"),
      path.join(workspaceRoot, "venv", "bin", "python"),
      path.join(workspaceRoot, "env", "Scripts", "python.exe"),
      path.join(workspaceRoot, "env", "bin", "python"),
    ];

    for (const venvPath of venvCandidates) {
      if (fs.existsSync(venvPath)) {
        return venvPath;
      }
    }

    // 3. System python candidates
    const systemCandidates = process.platform === "win32"
      ? ["python.exe", "py.exe", "python3.exe"]
      : ["python3", "python"];

    for (const cand of systemCandidates) {
      try {
        const probeResult = await runSafeProcess({
          executable: cand,
          args: ["--version"],
          cwd: workspaceRoot,
          timeoutMs: 3000,
        });
        if (probeResult.exitCode === 0 && probeResult.stdout.toLowerCase().includes("python")) {
          return cand;
        }
      } catch {
        // Candidate not available
      }
    }

    // Default to "python" and let the runner surface an execution/environment failure if absent
    return "python";
  }

  /**
   * Executes pytest on the selected test paths.
   */
  async execute(options: RunnerExecutionOptions): Promise<RunnerResult> {
    const { workspaceRoot, testPaths, timeoutMs, environment, pythonPath, maxOutputBytes, signal } = options;

    // Validate all test paths strictly inside workspace
    const safePaths = validateSafePaths(testPaths, workspaceRoot);

    // Support mock runner hook for reproducible testing and fixture environments
    if (process.env.TESTSHERIFF_MOCK_OUTPUT) {
      const mockResult: SafeProcessResult = {
        exitCode: Number(process.env.TESTSHERIFF_MOCK_EXITCODE ?? 0),
        stdout: process.env.TESTSHERIFF_MOCK_OUTPUT,
        stderr: process.env.TESTSHERIFF_MOCK_STDERR ?? "",
        combinedOutput: process.env.TESTSHERIFF_MOCK_OUTPUT + (process.env.TESTSHERIFF_MOCK_STDERR ? `\n${process.env.TESTSHERIFF_MOCK_STDERR}` : ""),
        durationMs: 42,
        timedOut: process.env.TESTSHERIFF_MOCK_TIMEDOUT === "1",
        cancelled: process.env.TESTSHERIFF_MOCK_CANCELLED === "1",
        truncated: false,
      };

      return {
        runner: this.name,
        commandLabel: `python -m pytest ${safePaths.join(" ")} -q`,
        testPaths: safePaths,
        processResult: mockResult,
      };
    }

    const pythonExecutable = await this.resolvePythonInterpreter(workspaceRoot, pythonPath);

    // Construct approved pytest arguments array: python -m pytest <paths> -q
    // -q: quiet output (standard summary)
    // -v / verbose is avoided to keep output bounded unless needed
    const args = ["-m", "pytest", ...safePaths, "-q"];
    const commandLabel = `${path.basename(pythonExecutable)} ${args.join(" ")}`;

    try {
      const processResult = await runSafeProcess({
        executable: pythonExecutable,
        args,
        cwd: workspaceRoot,
        timeoutMs,
        maxOutputBytes,
        signal,
        env: environment,
      });

      return {
        runner: this.name,
        commandLabel,
        testPaths: safePaths,
        processResult,
      };
    } catch (err: unknown) {
      // Check if python was not found
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new RunnerNotFoundError("python / pytest", {
          executable: pythonExecutable,
          commandLabel,
          originalError: (err as Error).message,
        });
      }
      throw err;
    }
  }
}
