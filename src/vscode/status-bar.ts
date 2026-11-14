/**
 * VS Code Status Bar Provider for TestSheriff
 * Displays real-time verification indicators and test metrics in the VS Code status bar.
 */

import type { VerificationReport } from "../shared/types/verification.ts";
import { mapReportToUIState, type UIStateView } from "../ui/ui-state-adapter.ts";

export interface IStatusBarItem {
  text: string;
  tooltip: string;
  command?: string;
  color?: string;
  backgroundColor?: unknown;
  show(): void;
  hide(): void;
}

export class TestSheriffStatusBarProvider {
  private item: IStatusBarItem | null = null;

  constructor(private readonly factory?: () => IStatusBarItem) {
    if (factory) {
      this.item = factory();
    }
  }

  public setItem(item: IStatusBarItem): void {
    this.item = item;
  }

  public updateState(state: "discovering" | "running" | "ready"): void {
    if (!this.item) return;

    if (state === "discovering") {
      this.item.text = "$(search~spin) TestSheriff: Discovering...";
      this.item.tooltip = "Scanning workspace for test configurations and candidate tests";
      this.item.show();
    } else if (state === "running") {
      this.item.text = "$(sync~spin) TestSheriff: Running Tests...";
      this.item.tooltip = "Executing allowlisted tests in secure child process";
      this.item.show();
    } else {
      this.item.text = "$(beaker) TestSheriff: Ready";
      this.item.tooltip = "TestSheriff verification engine ready for approved changes";
      this.item.show();
    }
  }

  public updateReport(report: VerificationReport): void {
    if (!this.item) return;

    const uiView: UIStateView = mapReportToUIState(report);

    switch (report.status) {
      case "passed":
        this.item.text = `$(check) TestSheriff: Passed (${report.passed}/${report.total})`;
        this.item.tooltip = `Verification Passed: ${report.passed} tests passed. Click to view dashboard.`;
        this.item.color = "#10B981";
        break;

      case "failed":
        this.item.text = `$(error) TestSheriff: Failed (${report.failed}/${report.total})`;
        this.item.tooltip = `Verification Failed: ${report.failed} test(s) failed. Click to view failure diagnostics.`;
        this.item.color = "#EF4444";
        break;

      case "timed_out":
        this.item.text = "$(clock) TestSheriff: Timed Out";
        this.item.tooltip = "Execution timed out. Click to view technical logs.";
        this.item.color = "#F59E0B";
        break;

      case "cancelled":
        this.item.text = "$(circle-slash) TestSheriff: Cancelled";
        this.item.tooltip = "Test execution was cancelled by user request.";
        this.item.color = "#6B7280";
        break;

      case "error":
        this.item.text = "$(warning) TestSheriff: Error";
        this.item.tooltip = `Verification Error: ${report.failures[0]?.testName || "Runner Error"}`;
        this.item.color = "#EF4444";
        break;

      case "not_run":
      default:
        this.item.text = "$(beaker) TestSheriff: Not Run";
        this.item.tooltip = "Changes have not been verified yet.";
        this.item.color = undefined;
    }

    this.item.command = "repopilot.showVerificationPanel";
    this.item.show();
  }

  public hide(): void {
    this.item?.hide();
  }
}
