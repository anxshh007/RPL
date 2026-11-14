import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { TestSheriffMcpServer } from "../../../src/verification/mcp/mcp-server.ts";

const FIXTURE_ROOT = path.resolve("tests/fixtures/sample-flask-repo");

test("mcp-server: handles initialize handshake", async () => {
  const server = new TestSheriffMcpServer();
  const response = await server.handleRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
  });

  assert.equal(response?.jsonrpc, "2.0");
  assert.equal(response?.id, 1);
  const result = response?.result as any;
  assert.equal(result.serverInfo.name, "repopilot-testsheriff");
  assert.equal(result.protocolVersion, "2024-11-05");
});

test("mcp-server: handles tools/list", async () => {
  const server = new TestSheriffMcpServer();
  const response = await server.handleRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });

  assert.equal(response?.id, 2);
  const result = response?.result as any;
  assert.ok(Array.isArray(result.tools));
  assert.ok(result.tools.some((t: any) => t.name === "run_tests"));
  assert.ok(result.tools.some((t: any) => t.name === "get_test_results"));
  assert.ok(result.tools.some((t: any) => t.name === "discover_tests"));
});

test("mcp-server: handles tools/call for discover_tests", async () => {
  const server = new TestSheriffMcpServer();
  const response = await server.handleRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "discover_tests",
      arguments: {
        workspaceRoot: FIXTURE_ROOT,
        changedFiles: ["src/flask/cli.py"],
      },
    },
  });

  assert.equal(response?.id, 3);
  const result = response?.result as any;
  assert.equal(result.isError, false);
  assert.ok(result.content[0].text.includes("pytest"));
});

test("mcp-server: handles ping and unknown methods", async () => {
  const server = new TestSheriffMcpServer();

  const pingRes = await server.handleRequest({
    jsonrpc: "2.0",
    id: 4,
    method: "ping",
  });
  assert.deepEqual(pingRes?.result, {});

  const unknownRes = await server.handleRequest({
    jsonrpc: "2.0",
    id: 5,
    method: "non_existent_method",
  });
  assert.equal(unknownRes?.error?.code, -32601);
});
