import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePytestSummaryCounts,
  parsePytestFailures,
  generateFailureHypothesis,
  buildVerificationReport,
} from "../../../src/verification/result-parser.ts";
import type { SafeProcessResult } from "../../../src/verification/process/process-types.ts";

test("result-parser: parses all-passed pytest summary output", () => {
  const output = `
tests/test_cli.py ..                                                      [100%]
============================== 2 passed in 0.12s ===============================
`;
  const counts = parsePytestSummaryCounts(output);

  assert.equal(counts.passed, 2);
  assert.equal(counts.failed, 0);
  assert.equal(counts.skipped, 0);
  assert.equal(counts.errors, 0);
  assert.equal(counts.total, 2);
  assert.equal(counts.parsingIncomplete, false);
});

test("result-parser: parses mixed pass, fail, and skipped tests", () => {
  const output = `
=========================== short test summary info ============================
FAILED tests/test_fail.py::test_will_fail - AssertionError: assert 1 == 2
=================== 1 failed, 3 passed, 2 skipped in 0.45s ====================
`;
  const counts = parsePytestSummaryCounts(output);

  assert.equal(counts.passed, 3);
  assert.equal(counts.failed, 1);
  assert.equal(counts.skipped, 2);
  assert.equal(counts.errors, 0);
  assert.equal(counts.total, 6);
});

test("result-parser: parses collection and import errors", () => {
  const output = `
==================================== ERRORS ====================================
________________________ ERROR collecting tests/test_broken.py _________________________
ImportError: No module named 'flask'
=========================== short test summary info ============================
ERROR tests/test_broken.py - ImportError: No module named 'flask'
!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
============================== 1 error in 0.08s ===============================
`;
  const counts = parsePytestSummaryCounts(output);
  const failures = parsePytestFailures(output);

  assert.equal(counts.errors, 1);
  assert.equal(counts.failed, 0);
  assert.equal(failures.length, 1);
  assert.ok(failures[0].testName.includes("test_broken.py"));
  assert.ok(failures[0].message.includes("ImportError"));
  assert.ok(failures[0].hypothesis?.includes("ImportError"));
});

test("result-parser: generates accurate evidence-backed hypotheses", () => {
  const assertionHypothesis = generateFailureHypothesis("AssertionError: assert 1 == 2");
  assert.ok(assertionHypothesis.includes("assertion check"));

  const importHypothesis = generateFailureHypothesis("ModuleNotFoundError: No module named 'foo'");
  assert.ok(importHypothesis.includes("required module or import was not found"));

  const attrHypothesis = generateFailureHypothesis("AttributeError: 'Flask' object has no attribute 'missing_func'");
  assert.ok(attrHypothesis.includes("attribute or method was accessed"));

  const typeHypothesis = generateFailureHypothesis("TypeError: func() takes 1 positional argument but 2 were given");
  assert.ok(typeHypothesis.includes("invalid arguments"));
});

test("result-parser: builds complete canonical VerificationReport", () => {
  const processResult: SafeProcessResult = {
    exitCode: 1,
    stdout: `
FAILED tests/test_cli.py::test_get_debug_flag - AssertionError: assert False is True
========================= 1 failed, 1 passed in 0.15s ==========================
`,
    stderr: "",
    combinedOutput: "FAILED tests/test_cli.py::test_get_debug_flag - AssertionError: assert False is True\n1 failed, 1 passed in 0.15s",
    durationMs: 150,
    timedOut: false,
    cancelled: false,
    truncated: false,
  };

  const report = buildVerificationReport({
    requestId: "req-123",
    runner: "pytest",
    commandLabel: "python -m pytest tests/test_cli.py -q",
    selectedTests: ["tests/test_cli.py"],
    processResult,
    selectionLimitations: ["Targeted subset executed."],
  });

  assert.equal(report.requestId, "req-123");
  assert.equal(report.status, "failed");
  assert.equal(report.total, 2);
  assert.equal(report.passed, 1);
  assert.equal(report.failed, 1);
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0].testName, "test_get_debug_flag");
  assert.ok(report.failures[0].hypothesis?.includes("assertion check"));
  assert.ok(report.limitations.some((l) => l.includes("Targeted subset")));
});

test("result-parser: reports timeout status truthfully", () => {
  const processResult: SafeProcessResult = {
    exitCode: 124,
    stdout: "running tests...",
    stderr: "",
    combinedOutput: "running tests...",
    durationMs: 30000,
    timedOut: true,
    cancelled: false,
    truncated: false,
  };

  const report = buildVerificationReport({
    requestId: "req-timeout",
    runner: "pytest",
    commandLabel: "python -m pytest tests/ -q",
    selectedTests: ["tests/test_cli.py"],
    processResult,
  });

  assert.equal(report.status, "timed_out");
  assert.equal(report.exitCode, 124);
  assert.ok(report.limitations.some((l) => l.includes("timed out")));
});
