import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { VerificationService } from "../../../src/verification/verification-service.ts";
import { ValidationError } from "../../../src/verification/errors.ts";

const FIXTURE_ROOT = path.resolve("tests/fixtures/sample-flask-repo");

test("verification-service: rejects invalid requests", () => {
  const service = new VerificationService();

  assert.throws(
    () => service.validateRequest({} as any),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      return true;
    }
  );

  assert.throws(
    () =>
      service.validateRequest({
        requestId: "req-1",
        workspaceRoot: FIXTURE_ROOT,
        changedFiles: ["src/flask/cli.py"],
        timeoutMs: -10, // Invalid timeout
      }),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      return true;
    }
  );
});

test("verification-service: verifies changes with successful pass output", async () => {
  const service = new VerificationService();

  process.env.TESTSHERIFF_MOCK_OUTPUT = `
tests/test_cli.py ..                                                      [100%]
============================== 2 passed in 0.08s ===============================
`;
  process.env.TESTSHERIFF_MOCK_EXITCODE = "0";

  try {
    const report = await service.verifyChanges({
      requestId: "req-success-1",
      workspaceRoot: FIXTURE_ROOT,
      changedFiles: ["src/flask/cli.py"],
    });

    assert.equal(report.requestId, "req-success-1");
    assert.equal(report.status, "passed");
    assert.equal(report.passed, 2);
    assert.equal(report.failed, 0);
    assert.equal(report.errors, 0);

    // Verify cache
    const cached = service.getReport("req-success-1");
    assert.equal(cached?.status, "passed");
  } finally {
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
  }
});

test("verification-service: handles failure results truthfully without guessing", async () => {
  const service = new VerificationService();

  process.env.TESTSHERIFF_MOCK_OUTPUT = `
FAILED tests/test_fail.py::test_will_fail - AssertionError: Expected 1 to equal 2
========================= 1 failed, 1 passed in 0.12s ==========================
`;
  process.env.TESTSHERIFF_MOCK_EXITCODE = "1";

  try {
    const report = await service.verifyChanges({
      requestId: "req-fail-1",
      workspaceRoot: FIXTURE_ROOT,
      changedFiles: ["tests/test_fail.py"],
    });

    assert.equal(report.status, "failed");
    assert.equal(report.failed, 1);
    assert.equal(report.passed, 1);
    assert.equal(report.failures.length, 1);
    assert.ok(report.failures[0].hypothesis?.includes("assertion check"));
  } finally {
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
  }
});
