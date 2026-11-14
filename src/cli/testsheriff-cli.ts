/**
 * TestSheriff Unified Command Line Interface (CLI)
 * Provides a developer-friendly terminal interface for test discovery,
 * safe execution, benchmark validation, and starting the MCP server.
 */

import { parseArgs } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  discoverTests,
  selectTests,
  verifyChanges,
  TestSheriffMcpServer,
  generateVerificationWidgetHtml,
  mapReportToUIState,
} from "../verification/index.ts";

const HELP_TEXT = `
RepoPilot AI — TestSheriff CLI (Layer 3 Automated Verification)
Version 1.0.0

USAGE:
  testsheriff <command> [options]

COMMANDS:
  discover    Inspect workspace, detect test frameworks, and select tests
  verify      Safely execute relevant tests and generate a VerificationReport
  mcp         Start the standard JSON-RPC 2.0 Model Context Protocol server over stdio
  benchmark   Run the Flask challenge competition validation suite
  help        Show this help message

OPTIONS:
  -w, --workspace <path>     Workspace root directory (default: current working directory)
  -c, --changed <files...>   List of changed source files (comma-separated or multiple flags)
  -t, --timeout <ms>         Execution timeout in milliseconds (default: 30000)
  --html <output-path>       Generate standalone interactive HTML dashboard
  --json                     Output raw JSON instead of formatted terminal text
  -v, --version              Show version information
  -h, --help                 Show help information

EXAMPLES:
  testsheriff discover -w ./my-repo -c src/flask/cli.py
  testsheriff verify -w ./my-repo -c src/flask/cli.py --html ./report.html
  testsheriff mcp
`;

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help") || argv[0] === "help") {
    console.log(HELP_TEXT);
    return 0;
  }

  if (argv.includes("-v") || argv.includes("--version")) {
    console.log("repopilot-testsheriff v1.0.0");
    return 0;
  }

  const command = argv[0];
  const commandArgs = argv.slice(1);

  if (command === "mcp") {
    const server = new TestSheriffMcpServer();
    server.listenStdio();
    return 0;
  }

  const { values, positionals } = parseArgs({
    args: commandArgs,
    options: {
      workspace: { type: "string", short: "w", default: process.cwd() },
      changed: { type: "string", short: "c" },
      timeout: { type: "string", short: "t", default: "30000" },
      html: { type: "string" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const workspaceRoot = path.resolve(values.workspace || process.cwd());
  const changedFiles = values.changed
    ? values.changed.split(",").map((s) => s.trim()).filter(Boolean)
    : positionals;
  const timeoutMs = parseInt(values.timeout || "30000", 10);

  switch (command) {
    case "discover": {
      const discovery = await discoverTests(workspaceRoot);
      const selection = await selectTests({
        workspaceRoot,
        changedFiles,
      });

      if (values.json) {
        console.log(JSON.stringify({ discovery, selection }, null, 2));
        return 0;
      }

      console.log("\n=======================================================");
      console.log("       TESTSHERIFF DISCOVERY & SELECTION RESULTS       ");
      console.log("=======================================================");
      console.log(`Workspace: ${workspaceRoot}`);
      console.log(`Runner:    ${discovery.runner.toUpperCase()}`);
      console.log(`Configs:   ${discovery.detectedConfigs.join(", ") || "(none)"}`);
      console.log(`Test Dirs: ${discovery.testDirectories.join(", ") || "(none)"}`);
      console.log(`Discovered Test Files (${discovery.testFiles.length}):`);
      for (const tf of discovery.testFiles) {
        console.log(`  * ${tf}`);
      }

      console.log(`\nSelected Tests for Changed Files (${selection.selectedTests.length}):`);
      for (const cand of selection.candidates) {
        console.log(`  * [${cand.source.toUpperCase()}] ${cand.path}`);
        console.log(`    Reason: ${cand.reason} (Confidence: ${cand.confidence})`);
      }

      if (selection.limitations.length > 0) {
        console.log("\nLimitations / Boundaries:");
        for (const lim of selection.limitations) {
          console.log(`  ! ${lim}`);
        }
      }
      console.log("=======================================================\n");
      return 0;
    }

    case "verify": {
      const requestId = `cli-verify-${Date.now()}`;
      const report = await verifyChanges({
        requestId,
        workspaceRoot,
        changedFiles,
        timeoutMs,
      });

      if (values.html) {
        const html = generateVerificationWidgetHtml(report);
        const outPath = path.resolve(values.html);
        fs.writeFileSync(outPath, html, "utf-8");
        console.log(`[TestSheriff] Standalone HTML dashboard generated: ${outPath}`);
      }

      if (values.json) {
        console.log(JSON.stringify(report, null, 2));
        return report.status === "passed" ? 0 : 1;
      }

      const uiView = mapReportToUIState(report);

      console.log("\n=======================================================");
      console.log("            TESTSHERIFF VERIFICATION REPORT            ");
      console.log("=======================================================");
      console.log(`Request ID:  ${report.requestId}`);
      console.log(`Status:      ${report.status.toUpperCase()}`);
      console.log(`Command:     ${report.commandLabel}`);
      console.log(`Duration:    ${uiView.durationLabel}`);
      console.log(`Metrics:     Total: ${report.total} | Passed: ${report.passed} | Failed: ${report.failed} | Skipped: ${report.skipped} | Errors: ${report.errors}`);
      console.log(`Headline:    "${uiView.headline}"`);

      if (report.failures.length > 0) {
        console.log("\nFailures Analyzed:");
        for (const [idx, f] of report.failures.entries()) {
          console.log(`  [${idx + 1}] ${f.testName} (${f.file || "unknown"})`);
          console.log(`      Error: ${f.message}`);
          if (f.hypothesis) {
            console.log(`      ${f.hypothesis}`);
          }
        }
      }

      if (report.limitations.length > 0) {
        console.log("\nDisclosed Limitations:");
        for (const lim of report.limitations) {
          console.log(`  ! ${lim}`);
        }
      }
      console.log("=======================================================\n");

      return report.status === "passed" ? 0 : 1;
    }

    case "benchmark": {
      const benchmarkScript = path.resolve("scripts/run-flask-challenge.js");
      const { spawnSync } = await import("node:child_process");
      const res = spawnSync(process.execPath, ["--no-warnings", "--experimental-transform-types", benchmarkScript], {
        stdio: "inherit",
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });
      return res.status ?? 0;
    }

    default: {
      console.error(`Unknown command: "${command}". Run "testsheriff --help" for available commands.`);
      return 1;
    }
  }
}

// Auto-run when executed directly from node
if (process.argv[1]?.includes("testsheriff")) {
  runCli().then((code) => {
    if (code !== 0 && !process.argv.includes("mcp")) {
      process.exit(code);
    }
  });
}
