import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import {
  runSafeProcess,
  validateExecutable,
  validateArguments,
} from "../../../src/verification/process/safe-process.ts";
import { SecurityViolationError } from "../../../src/verification/errors.ts";

const WS_ROOT = path.resolve(".");

test("safe-process: validateExecutable accepts allowlisted executables", () => {
  assert.equal(validateExecutable("python", WS_ROOT), "python");
  assert.equal(validateExecutable("python.exe", WS_ROOT), "python.exe");
  assert.equal(validateExecutable("node", WS_ROOT), "node");
  assert.equal(validateExecutable("pytest", WS_ROOT), "pytest");
});

test("safe-process: validateExecutable rejects unapproved executables", () => {
  assert.throws(
    () => validateExecutable("bash", WS_ROOT),
    (err: unknown) => {
      assert.ok(err instanceof SecurityViolationError);
      assert.ok((err as Error).message.includes("rejected by security policy"));
      return true;
    }
  );

  assert.throws(
    () => validateExecutable("powershell.exe", WS_ROOT),
    (err: unknown) => {
      assert.ok(err instanceof SecurityViolationError);
      return true;
    }
  );

  assert.throws(
    () => validateExecutable("curl", WS_ROOT),
    (err: unknown) => {
      assert.ok(err instanceof SecurityViolationError);
      return true;
    }
  );
});

test("safe-process: validateArguments rejects dangerous commands like pip install and sudo", () => {
  assert.throws(
    () => validateArguments(["-m", "pip", "install", "requests"]),
    (err: unknown) => {
      assert.ok(err instanceof SecurityViolationError);
      return true;
    }
  );

  assert.throws(
    () => validateArguments(["sudo", "pytest"]),
    (err: unknown) => {
      assert.ok(err instanceof SecurityViolationError);
      return true;
    }
  );
});

test("safe-process: executes harmless command and captures exit code and output", async () => {
  const result = await runSafeProcess({
    executable: "node",
    args: ["-e", "console.log('hello from safe process');"],
    cwd: WS_ROOT,
    timeoutMs: 5000,
  });

  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("hello from safe process"));
  assert.equal(result.timedOut, false);
  assert.equal(result.cancelled, false);
  assert.ok(result.durationMs >= 0);
});

test("safe-process: handles timeout by terminating process tree", async () => {
  const result = await runSafeProcess({
    executable: "node",
    args: ["-e", "setTimeout(() => {}, 1500);"],
    cwd: WS_ROOT,
    timeoutMs: 150, // Fast timeout
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, 124);
});

test("safe-process: handles cancellation via AbortSignal", async () => {
  const controller = new AbortController();

  setTimeout(() => {
    controller.abort();
  }, 100);

  const result = await runSafeProcess({
    executable: "node",
    args: ["-e", "setTimeout(() => {}, 1500);"],
    cwd: WS_ROOT,
    timeoutMs: 3000,
    signal: controller.signal,
  });

  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
});

test("safe-process: enforces bounded output buffer and marks truncated", async () => {
  const result = await runSafeProcess({
    executable: "node",
    args: ["-e", "console.log('A'.repeat(5000));"],
    cwd: WS_ROOT,
    timeoutMs: 5000,
    maxOutputBytes: 256, // small buffer
  });

  assert.equal(result.truncated, true);
  assert.ok(result.stdout.length <= 256);
});
