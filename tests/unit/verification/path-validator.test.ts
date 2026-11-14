import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import {
  validateSafePath,
  validateSafePaths,
  normalizePath,
  SecurityPathError,
} from "../../../src/shared/utils/path-validator.ts";

test("path-validator: normalizes workspace paths", () => {
  const norm = normalizePath("c:/TEST_SHERIFF");
  assert.ok(norm.length > 0);
  assert.equal(norm.includes("/"), false); // Normalized on Windows to backslashes
});

test("path-validator: accepts safe paths inside workspace", () => {
  const ws = path.resolve("tests/fixtures/sample-flask-repo");
  const validRelative = "tests/test_cli.py";
  const safe = validateSafePath(validRelative, ws);

  assert.ok(safe.startsWith(normalizePath(ws)));
});

test("path-validator: rejects directory traversal with ..", () => {
  const ws = path.resolve("tests/fixtures/sample-flask-repo");
  const badPath = "../../outside.py";

  assert.throws(
    () => validateSafePath(badPath, ws),
    (err: unknown) => {
      assert.ok(err instanceof SecurityPathError);
      assert.ok((err as Error).message.includes("resolves outside workspace boundary"));
      return true;
    }
  );
});

test("path-validator: rejects absolute paths outside workspace", () => {
  const ws = path.resolve("tests/fixtures/sample-flask-repo");
  const outsidePath = "C:/Windows/System32/cmd.exe";

  assert.throws(
    () => validateSafePath(outsidePath, ws),
    (err: unknown) => {
      assert.ok(err instanceof SecurityPathError);
      return true;
    }
  );
});

test("path-validator: validateSafePaths converts array to clean relative paths", () => {
  const ws = path.resolve("tests/fixtures/sample-flask-repo");
  const input = ["tests/test_cli.py", "tests/test_helper.py"];
  const safe = validateSafePaths(input, ws);

  assert.deepEqual(safe, ["tests/test_cli.py", "tests/test_helper.py"]);
});
