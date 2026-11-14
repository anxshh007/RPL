import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import {
  findImportBasedTestsForFile,
  selectTests,
} from "../../../src/verification/test-selection.ts";
import {
  scanConftestFiles,
  extractTestInstructions,
  discoverTests,
} from "../../../src/verification/test-discovery.ts";

const FIXTURE_ROOT = path.resolve("tests/fixtures/sample-flask-repo");

test("import-selection: discovers tests that import modified module even with non-matching filenames", async () => {
  const discovery = await discoverTests(FIXTURE_ROOT);
  const candidates = findImportBasedTestsForFile(
    "src/flask/helper.py",
    discovery.testFiles,
    FIXTURE_ROOT
  );

  assert.ok(candidates.length > 0);
  const unconventionallyNamed = candidates.find((c) =>
    c.path.includes("test_unconventionally_named.py")
  );
  assert.ok(unconventionallyNamed);
  assert.equal(unconventionallyNamed?.source, "import");
  assert.equal(unconventionallyNamed?.confidence, "high");
});

test("import-selection: detects conftest.py files in test directories", () => {
  const conftestFiles = scanConftestFiles(FIXTURE_ROOT);
  assert.ok(conftestFiles.length > 0);
  assert.ok(conftestFiles.some((f) => f.includes("conftest.py")));
});

test("import-selection: extracts test instructions from README.md", () => {
  const instructions = extractTestInstructions(FIXTURE_ROOT);
  assert.ok(instructions.length > 0);
  assert.ok(instructions[0].includes("pytest"));
});

test("import-selection: integrated selectTests includes both conventional and import candidates", async () => {
  const result = await selectTests({
    workspaceRoot: FIXTURE_ROOT,
    changedFiles: ["src/flask/helper.py"],
  });

  // Conventional match: tests/test_helper.py
  assert.ok(result.selectedTests.some((t) => t.includes("test_helper.py")));
  // Import match: tests/test_unconventionally_named.py
  assert.ok(result.selectedTests.some((t) => t.includes("test_unconventionally_named.py")));
});
