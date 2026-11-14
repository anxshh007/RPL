import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import {
  TEST_MCP_TOOLS,
  handleRunTests,
  handleGetTestResults,
  handleDiscoverTests,
  dispatchMcpTool,
} from "../../../src/verification/mcp/test-tools.ts";

const FIXTURE_ROOT = path.resolve("tests/fixtures/sample-flask-repo");

test("mcp-tools: tool definitions match Member 1 requirements", () => {
  const toolNames = TEST_MCP_TOOLS.map((t) => t.name);
  assert.ok(toolNames.includes("run_tests"));
  assert.ok(toolNames.includes("get_test_results"));
  assert.ok(toolNames.includes("discover_tests"));
});

test("mcp-tools: discover_tests returns candidate tests and configs", async () => {
  const response = await handleDiscoverTests({
    workspaceRoot: FIXTURE_ROOT,
    changedFiles: ["src/flask/cli.py"],
  });

  assert.equal(response.success, true);
  assert.equal(response.data?.runner, "pytest");
  assert.ok(response.data?.selectedTests.includes("tests/test_cli.py"));
});

test("mcp-tools: run_tests and get_test_results round-trip", async () => {
  process.env.TESTSHERIFF_MOCK_OUTPUT = "2 passed in 0.05s";
  process.env.TESTSHERIFF_MOCK_EXITCODE = "0";

  try {
    const runResponse = await handleRunTests({
      requestId: "mcp-req-1",
      workspaceRoot: FIXTURE_ROOT,
      changedFiles: ["src/flask/cli.py"],
    });

    assert.equal(runResponse.success, true);
    assert.equal(runResponse.data?.status, "passed");

    // Fetch via get_test_results
    const getResponse = await handleGetTestResults({
      requestId: "mcp-req-1",
    });

    assert.equal(getResponse.success, true);
    assert.equal(getResponse.data?.requestId, "mcp-req-1");
    assert.equal(getResponse.data?.status, "passed");
  } finally {
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
  }
});

test("mcp-tools: dispatchMcpTool routes calls cleanly", async () => {
  const dispatchResponse = await dispatchMcpTool("unknown_tool", {});
  assert.equal(dispatchResponse.success, false);
  assert.equal(dispatchResponse.error?.code, "UNKNOWN_TOOL");
});
