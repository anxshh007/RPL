import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { PytestRunner } from "../../../src/verification/runner/pytest-runner.ts";

const FIXTURE_ROOT = path.resolve("tests/fixtures/sample-flask-repo");

test("pytest-runner: detects pytest configuration in repository", async () => {
  const runner = new PytestRunner();
  const isDetected = await runner.detect(FIXTURE_ROOT);
  assert.equal(isDetected, true);
});

test("pytest-runner: executes via mock hook for fixture testing", async () => {
  const runner = new PytestRunner();

  process.env.TESTSHERIFF_MOCK_OUTPUT = "2 passed in 0.05s";
  process.env.TESTSHERIFF_MOCK_EXITCODE = "0";

  try {
    const result = await runner.execute({
      workspaceRoot: FIXTURE_ROOT,
      testPaths: ["tests/test_cli.py"],
      timeoutMs: 5000,
    });

    assert.equal(result.runner, "pytest");
    assert.ok(result.commandLabel.includes("test_cli.py"));
    assert.equal(result.processResult.exitCode, 0);
    assert.ok(result.processResult.stdout.includes("2 passed"));
  } finally {
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
  }
});
