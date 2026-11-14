import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import {
  verifyChanges,
  getVerificationReport,
  dispatchMcpTool,
  mapReportToUIState,
} from "../../src/verification/index.ts";

const FIXTURE_ROOT = path.resolve("tests/fixtures/sample-flask-repo");

function hashDirectoryFiles(dir: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  const entries = fs.readdirSync(dir, { recursive: true, withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile()) {
      const fullPath = path.join(entry.parentPath || dir, entry.name);
      const content = fs.readFileSync(fullPath);
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      hashes[path.relative(dir, fullPath).replace(/\\/g, "/")] = hash;
    }
  }
  return hashes;
}

test("integration: Scenario 1 - successful pytest execution on Flask challenge edit", async () => {
  process.env.TESTSHERIFF_MOCK_OUTPUT = `
tests/test_cli.py ..                                                      [100%]
============================== 2 passed in 0.14s ===============================
`;
  process.env.TESTSHERIFF_MOCK_EXITCODE = "0";

  try {
    const report = await verifyChanges({
      requestId: "integration-flask-inline-edit",
      workspaceRoot: FIXTURE_ROOT,
      changedFiles: ["src/flask/cli.py"],
    });

    assert.equal(report.requestId, "integration-flask-inline-edit");
    assert.equal(report.status, "passed");
    assert.equal(report.runner, "pytest");
    assert.ok(report.commandLabel.includes("pytest"));
    assert.ok(report.selectedTests.includes("tests/test_cli.py"));
    assert.equal(report.total, 2);
    assert.equal(report.passed, 2);
    assert.equal(report.failed, 0);
    assert.equal(report.errors, 0);
    assert.equal(report.failures.length, 0);
    assert.ok(report.limitations.length > 0); // Truthful limitation disclosure

    // UI state adapter mapping
    const uiState = mapReportToUIState(report);
    assert.equal(uiState.state, "tests_passed");
    assert.equal(uiState.badgeType, "success");
    assert.equal(uiState.passedCount, 2);
  } finally {
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
  }
});

test("integration: Scenario 2 - failed test with clear hypothesis and error details", async () => {
  process.env.TESTSHERIFF_MOCK_OUTPUT = `
=========================== short test summary info ============================
FAILED tests/test_fail.py::test_will_fail - AssertionError: Expected 1 to equal 2
=================== 1 failed, 1 passed in 0.18s ====================
`;
  process.env.TESTSHERIFF_MOCK_EXITCODE = "1";

  try {
    const report = await verifyChanges({
      requestId: "integration-flask-failure-edit",
      workspaceRoot: FIXTURE_ROOT,
      changedFiles: ["tests/test_fail.py"],
    });

    assert.equal(report.status, "failed");
    assert.equal(report.failed, 1);
    assert.equal(report.passed, 1);
    assert.equal(report.failures.length, 1);
    assert.equal(report.failures[0].testName, "test_will_fail");
    assert.ok(report.failures[0].message.includes("AssertionError"));
    assert.ok(report.failures[0].hypothesis?.includes("assertion check"));

    const uiState = mapReportToUIState(report);
    assert.equal(uiState.state, "tests_failed");
    assert.equal(uiState.badgeType, "danger");
    assert.equal(uiState.failedCount, 1);
  } finally {
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
  }
});

test("integration: Scenario 3 - timeout scenario triggers termination and report", async () => {
  process.env.TESTSHERIFF_MOCK_TIMEDOUT = "1";
  process.env.TESTSHERIFF_MOCK_EXITCODE = "124";
  process.env.TESTSHERIFF_MOCK_OUTPUT = "Running long tests...";

  try {
    const report = await verifyChanges({
      requestId: "integration-timeout-test",
      workspaceRoot: FIXTURE_ROOT,
      changedFiles: ["src/flask/cli.py"],
      timeoutMs: 1000,
    });

    assert.equal(report.status, "timed_out");
    assert.equal(report.exitCode, 124);
    assert.ok(report.limitations.some((l) => l.includes("timeout")));

    const uiState = mapReportToUIState(report);
    assert.equal(uiState.state, "execution_timed_out");
    assert.equal(uiState.badgeType, "warning");
  } finally {
    delete process.env.TESTSHERIFF_MOCK_TIMEDOUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
  }
});

test("integration: Scenario 4 - cancellation scenario terminates child cleanly", async () => {
  process.env.TESTSHERIFF_MOCK_CANCELLED = "1";
  process.env.TESTSHERIFF_MOCK_EXITCODE = "130";
  process.env.TESTSHERIFF_MOCK_OUTPUT = "Cancelled before execution completed.";

  try {
    const report = await verifyChanges({
      requestId: "integration-cancel-test",
      workspaceRoot: FIXTURE_ROOT,
      changedFiles: ["src/flask/cli.py"],
    });

    assert.equal(report.status, "cancelled");
    assert.equal(report.exitCode, 130);

    const uiState = mapReportToUIState(report);
    assert.equal(uiState.state, "execution_cancelled");
  } finally {
    delete process.env.TESTSHERIFF_MOCK_CANCELLED;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
  }
});

test("integration: Scenario 5 - collection error and incomplete parsing handling", async () => {
  process.env.TESTSHERIFF_MOCK_OUTPUT = `
==================================== ERRORS ====================================
ERROR tests/test_syntax.py - SyntaxError: invalid syntax
============================== 1 error in 0.05s ===============================
`;
  process.env.TESTSHERIFF_MOCK_EXITCODE = "2";

  try {
    const report = await verifyChanges({
      requestId: "integration-collection-error",
      workspaceRoot: FIXTURE_ROOT,
      changedFiles: ["src/flask/cli.py"],
    });

    assert.equal(report.status, "error");
    assert.equal(report.errors, 1);
    assert.equal(report.passed, 0);

    const uiState = mapReportToUIState(report);
    assert.equal(uiState.state, "verification_incomplete");
  } finally {
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
  }
});

test("integration: Scenario 6 - MCP dispatching and retrieval", async () => {
  process.env.TESTSHERIFF_MOCK_OUTPUT = "2 passed in 0.05s";
  process.env.TESTSHERIFF_MOCK_EXITCODE = "0";

  try {
    const mcpResult = await dispatchMcpTool("run_tests", {
      requestId: "mcp-full-integration",
      workspaceRoot: FIXTURE_ROOT,
      changedFiles: ["src/flask/cli.py"],
    });

    assert.equal(mcpResult.success, true);
    const data = mcpResult.data as any;
    assert.equal(data.status, "passed");

    // Fetch again via cached report
    const cached = getVerificationReport("mcp-full-integration");
    assert.equal(cached?.requestId, "mcp-full-integration");
  } finally {
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
  }
});

test("integration: Scenario 7 - strict non-modification guarantee", async () => {
  // Capture hashes before verification
  const hashesBefore = hashDirectoryFiles(FIXTURE_ROOT);

  process.env.TESTSHERIFF_MOCK_OUTPUT = "2 passed in 0.05s";
  process.env.TESTSHERIFF_MOCK_EXITCODE = "0";

  try {
    await verifyChanges({
      requestId: "integrity-test-request",
      workspaceRoot: FIXTURE_ROOT,
      changedFiles: ["src/flask/cli.py"],
    });
  } finally {
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
  }

  // Capture hashes after verification
  const hashesAfter = hashDirectoryFiles(FIXTURE_ROOT);

  // Assert NO files were created, edited, deleted or modified in the workspace
  assert.deepEqual(hashesBefore, hashesAfter);
});
