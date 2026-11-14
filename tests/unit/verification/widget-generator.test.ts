import test from "node:test";
import assert from "node:assert/strict";
import { generateVerificationWidgetHtml } from "../../../src/ui/widget-generator.ts";
import type { VerificationReport } from "../../../src/shared/types/verification.ts";

test("widget-generator: generates HTML dashboard with metrics and status banner", () => {
  const report: VerificationReport = {
    requestId: "req-html-test",
    status: "passed",
    runner: "pytest",
    commandLabel: "python -m pytest tests/test_cli.py -q",
    selectedTests: ["tests/test_cli.py"],
    total: 2,
    passed: 2,
    failed: 0,
    skipped: 0,
    errors: 0,
    durationMs: 120,
    exitCode: 0,
    failures: [],
    testCases: [
      { id: "tests/test_cli.py::test_1", file: "tests/test_cli.py", name: "test_1", status: "passed" },
      { id: "tests/test_cli.py::test_2", file: "tests/test_cli.py", name: "test_2", status: "passed" },
    ],
    outputSummary: "2 passed in 0.12s",
    outputTruncated: false,
    limitations: ["Targeted subset executed."],
  };

  const html = generateVerificationWidgetHtml(report);

  assert.ok(html.includes("RepoPilot Verification Dashboard"));
  assert.ok(html.includes("req-html-test"));
  assert.ok(html.includes("PASSED"));
  assert.ok(html.includes("python -m pytest tests/test_cli.py -q"));
  assert.ok(html.includes("Targeted subset executed."));
  assert.ok(html.includes("test_1"));
});

test("widget-generator: renders failure cards with hypotheses and tracebacks", () => {
  const report: VerificationReport = {
    requestId: "req-fail-html",
    status: "failed",
    runner: "pytest",
    commandLabel: "python -m pytest tests/test_fail.py -q",
    selectedTests: ["tests/test_fail.py"],
    total: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
    errors: 0,
    durationMs: 80,
    exitCode: 1,
    failures: [
      {
        testName: "test_assert_failure",
        file: "tests/test_fail.py",
        message: "AssertionError: 1 != 2",
        hypothesis: "[Hypothesis] (AssertionError) Expected value did not match actual value.",
        errorDetails: "def test_assert_failure():\n> assert 1 == 2\nE AssertionError: 1 != 2",
      },
    ],
    outputSummary: "1 failed in 0.08s",
    outputTruncated: false,
    limitations: ["Broader repository suite was not executed."],
  };

  const html = generateVerificationWidgetHtml(report);

  assert.ok(html.includes("test_assert_failure"));
  assert.ok(html.includes("AssertionError: 1 != 2"));
  assert.ok(html.includes("Diagnostic Hypothesis:"));
  assert.ok(html.includes("View Technical Traceback"));
  assert.ok(html.includes("Broader repository suite was not executed."));
});

test("widget-generator: escapes HTML special characters to prevent XSS", () => {
  const report: VerificationReport = {
    requestId: "req-<script>alert('xss')</script>",
    status: "failed",
    runner: "pytest",
    commandLabel: "pytest '\"<>&",
    selectedTests: ["tests/test_xss.py"],
    total: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
    errors: 0,
    failures: [
      {
        testName: "<img src=x onerror=alert(1)>",
        file: "tests/<b>test.py</b>",
        message: "Error & Failure <details>",
        hypothesis: "Hypothesis with <script> and \"quotes\"",
        errorDetails: "<svg onload=alert(2)>",
      },
    ],
    outputSummary: "failed",
    outputTruncated: false,
    limitations: ["Limitation with <dangerous> & 'special' tags"],
  };

  const html = generateVerificationWidgetHtml(report);

  // Unescaped dangerous scripts/tags must NOT exist
  assert.ok(!html.includes("<script>alert('xss')</script>"));
  assert.ok(!html.includes("<img src=x onerror=alert(1)>"));
  assert.ok(!html.includes("<svg onload=alert(2)>"));
  assert.ok(!html.includes("<dangerous>"));

  // Escaped versions must exist
  assert.ok(html.includes("&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes("&lt;svg onload=alert(2)&gt;"));
  assert.ok(html.includes("&lt;dangerous&gt; &amp; &#039;special&#039; tags"));
});

test("widget-generator: correctly renders timed_out, cancelled, and error themes", () => {
  const statuses: Array<VerificationReport["status"]> = ["timed_out", "cancelled", "error", "not_run"];

  for (const status of statuses) {
    const report: VerificationReport = {
      requestId: `req-status-${status}`,
      status,
      runner: "pytest",
      commandLabel: "pytest",
      selectedTests: [],
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: 0,
      failures: [],
      outputSummary: `Status: ${status}`,
      outputTruncated: false,
      limitations: [],
    };

    const html = generateVerificationWidgetHtml(report);
    assert.ok(html.startsWith("<!DOCTYPE html>"), `Should have valid doctype for status ${status}`);
    assert.ok(html.includes(`req-status-${status}`), `Should contain request id for status ${status}`);
    assert.ok(html.includes("dashboard-container"), `Should contain container for status ${status}`);
  }
});

test("widget-generator: validates live verification-dashboard.html integrity", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dashboardPath = path.resolve("verification-dashboard.html");

  assert.ok(fs.existsSync(dashboardPath), "verification-dashboard.html must exist on disk");
  const content = fs.readFileSync(dashboardPath, "utf-8");

  // Validate structural HTML requirements
  assert.ok(content.startsWith("<!DOCTYPE html>"), "Must declare DOCTYPE html");
  assert.ok(content.includes("<html lang=\"en\">"), "Must have html tag with lang attribute");
  assert.ok(content.includes("<title>RepoPilot Verification Dashboard</title>"), "Must have dashboard title");
  assert.ok(content.includes("class=\"dashboard-container\""), "Must contain dashboard-container");
  assert.ok(content.includes("class=\"metric-grid\""), "Must contain metric-grid");
  assert.ok(content.includes("class=\"header-banner\""), "Must contain header-banner");
  assert.ok(content.includes("Total Tests"), "Must contain Total Tests metric card");
  assert.ok(content.includes("Passed"), "Must contain Passed metric card");
  assert.ok(content.includes("Failed"), "Must contain Failed metric card");
  assert.ok(content.includes("Skipped"), "Must contain Skipped metric card");
  assert.ok(content.includes("Duration"), "Must contain Duration metric card");
  assert.ok(content.includes("Executed Test Command"), "Must contain Executed Test Command section");
  assert.ok(content.includes("Verification Limitations & Boundaries"), "Must contain Limitations section");
  assert.ok(content.includes("</html>"), "Must close html tag cleanly");
});

