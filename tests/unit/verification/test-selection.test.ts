import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { selectTests } from "../../../src/verification/test-selection.ts";

const FIXTURE_ROOT = path.resolve("tests/fixtures/sample-flask-repo");

test("test-selection: prioritizes explicit test paths (Priority 1)", async () => {
  const result = await selectTests({
    workspaceRoot: FIXTURE_ROOT,
    changedFiles: ["src/flask/cli.py"],
    explicitTests: ["tests/test_helper.py"],
  });

  assert.ok(result.selectedTests.includes("tests/test_helper.py"));
  const cand = result.candidates.find((c) => c.path === "tests/test_helper.py");
  assert.equal(cand?.source, "explicit");
  assert.equal(cand?.confidence, "high");
});

test("test-selection: accepts ImpactLens candidates (Priority 2)", async () => {
  const result = await selectTests({
    workspaceRoot: FIXTURE_ROOT,
    changedFiles: ["src/flask/helper.py"],
    candidateTests: [
      {
        path: "tests/test_helper.py",
        reason: "ImpactLens graph dependency",
        source: "impact",
        confidence: "high",
      },
    ],
  });

  assert.ok(result.selectedTests.includes("tests/test_helper.py"));
  const cand = result.candidates.find((c) => c.path === "tests/test_helper.py");
  assert.equal(cand?.source, "impact");
  assert.ok(cand?.reason.includes("ImpactLens"));
});

test("test-selection: maps source files to tests by convention (Priority 3)", async () => {
  const result = await selectTests({
    workspaceRoot: FIXTURE_ROOT,
    changedFiles: ["src/flask/cli.py"],
  });

  assert.ok(result.selectedTests.includes("tests/test_cli.py"));
  const cand = result.candidates.find((c) => c.path === "tests/test_cli.py");
  assert.equal(cand?.source, "convention");
  assert.equal(cand?.confidence, "high");
});

test("test-selection: eliminates duplicates across tiers", async () => {
  const result = await selectTests({
    workspaceRoot: FIXTURE_ROOT,
    changedFiles: ["src/flask/cli.py"],
    explicitTests: ["tests/test_cli.py"],
    candidateTests: [
      {
        path: "tests/test_cli.py",
        reason: "Impact candidate",
        source: "impact",
        confidence: "high",
      },
    ],
  });

  // Must only appear once
  const occurrences = result.selectedTests.filter((t) => t === "tests/test_cli.py");
  assert.equal(occurrences.length, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source, "explicit"); // Prioritized first
});

test("test-selection: falls back to broader suite when no mapping found (Priority 4)", async () => {
  const result = await selectTests({
    workspaceRoot: FIXTURE_ROOT,
    changedFiles: ["docs/readme.md"], // Unrelated doc change
  });

  assert.equal(result.fallbackToFullSuite, true);
  assert.ok(result.selectedTests.length >= 3);
  assert.ok(result.limitations.some((l) => l.includes("Broad test suite selected")));
});
