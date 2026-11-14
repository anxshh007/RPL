import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { discoverTests } from "../../../src/verification/test-discovery.ts";

const FIXTURE_ROOT = path.resolve("tests/fixtures/sample-flask-repo");

test("test-discovery: discovers pytest.ini, pyproject.toml and tests directory", async () => {
  const result = await discoverTests(FIXTURE_ROOT);

  assert.equal(result.runner, "pytest");
  assert.equal(result.isConfigured, true);
  assert.ok(result.detectedConfigs.includes("pytest.ini"));
  assert.ok(result.detectedConfigs.includes("pyproject.toml"));
  assert.ok(result.testDirectories.includes("tests"));

  // Discovered test files
  assert.ok(result.testFiles.some((f) => f.includes("test_cli.py")));
  assert.ok(result.testFiles.some((f) => f.includes("test_helper.py")));
  assert.ok(result.testFiles.some((f) => f.includes("test_fail.py")));
});

test("test-discovery: handles empty directory gracefully", async () => {
  const emptyDir = path.resolve("tests/fixtures/empty-dir");
  const fs = await import("node:fs");
  if (!fs.existsSync(emptyDir)) {
    fs.mkdirSync(emptyDir, { recursive: true });
  }

  const result = await discoverTests(emptyDir);
  assert.equal(result.isConfigured, false);
  assert.equal(result.testFiles.length, 0);
  assert.equal(result.runner, "unsupported");

  fs.rmdirSync(emptyDir);
});
