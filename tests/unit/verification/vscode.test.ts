import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { TestSheriffStatusBarProvider } from "../../../src/vscode/status-bar.ts";
import { TestSheriffWebviewProvider } from "../../../src/vscode/webview-provider.ts";
import { TestSheriffExtensionController } from "../../../src/vscode/extension.ts";
import type { VerificationReport } from "../../../src/shared/types/verification.ts";

const FIXTURE_ROOT = path.resolve("tests/fixtures/sample-flask-repo");

test("vscode: status bar provider updates icons and colors based on report status", () => {
  let text = "";
  let color = "";
  let shown = false;

  const mockItem = {
    get text() { return text; },
    set text(val: string) { text = val; },
    get color() { return color; },
    set color(val: string | undefined) { color = val || ""; },
    tooltip: "",
    show() { shown = true; },
    hide() { shown = false; },
  };

  const provider = new TestSheriffStatusBarProvider(() => mockItem);

  provider.updateState("running");
  assert.ok(mockItem.text.includes("Running Tests"));
  assert.equal(shown, true);

  const passReport: VerificationReport = {
    requestId: "vsc-req-1",
    status: "passed",
    runner: "pytest",
    commandLabel: "pytest",
    selectedTests: ["tests/test_cli.py"],
    total: 2,
    passed: 2,
    failed: 0,
    skipped: 0,
    errors: 0,
    failures: [],
    outputSummary: "2 passed in 0.05s",
    outputTruncated: false,
    limitations: [],
  };

  provider.updateReport(passReport);
  assert.ok(mockItem.text.includes("Passed (2/2)"));
  assert.equal(mockItem.color, "#10B981");

  const failReport: VerificationReport = {
    ...passReport,
    status: "failed",
    failed: 1,
    passed: 1,
  };

  provider.updateReport(failReport);
  assert.ok(mockItem.text.includes("Failed (1/2)"));
  assert.equal(mockItem.color, "#EF4444");
});

test("vscode: webview provider mounts HTML dashboard", () => {
  let createdHtml = "";
  let revealed = false;

  const mockPanel = {
    title: "",
    webview: {
      get html() { return createdHtml; },
      set html(val: string) { createdHtml = val; },
      onDidReceiveMessage: () => ({ dispose: () => {} }),
      postMessage: async () => true,
    },
    reveal: () => { revealed = true; },
    dispose: () => {},
    onDidDispose: () => ({ dispose: () => {} }),
  };

  const provider = new TestSheriffWebviewProvider();
  const report: VerificationReport = {
    requestId: "vsc-webview-1",
    status: "passed",
    runner: "pytest",
    commandLabel: "pytest",
    selectedTests: ["tests/test_cli.py"],
    total: 2,
    passed: 2,
    failed: 0,
    skipped: 0,
    errors: 0,
    failures: [],
    outputSummary: "2 passed",
    outputTruncated: false,
    limitations: [],
  };

  provider.showReport(report, () => mockPanel);

  assert.equal(revealed, true);
  assert.ok(createdHtml.includes("RepoPilot Verification Dashboard"));
  assert.ok(createdHtml.includes("vsc-webview-1"));
});

test("vscode: extension controller executes verify command", async () => {
  process.env.TESTSHERIFF_MOCK_OUTPUT = "2 passed in 0.05s";
  process.env.TESTSHERIFF_MOCK_EXITCODE = "0";

  try {
    const controller = new TestSheriffExtensionController();
    const report = await controller.handleVerifyCommand(FIXTURE_ROOT, ["src/flask/cli.py"]);

    assert.equal(report.status, "passed");
    assert.equal(report.passed, 2);
  } finally {
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
  }
});
