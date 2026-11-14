/**
 * VS Code Webview Panel Provider for TestSheriff
 * Mounts the interactive HTML verification dashboard inside VS Code editor panes.
 */

import type { VerificationReport } from "../shared/types/verification.ts";
import { generateVerificationWidgetHtml } from "../ui/widget-generator.ts";

export interface IWebviewPanel {
  title: string;
  webview: {
    html: string;
    onDidReceiveMessage(callback: (msg: unknown) => void): { dispose(): void };
    postMessage(message: unknown): Thenable<boolean>;
  };
  reveal(viewColumn?: unknown): void;
  dispose(): void;
  onDidDispose(callback: () => void): { dispose(): void };
}

export class TestSheriffWebviewProvider {
  private currentPanel: IWebviewPanel | null = null;
  private lastReport: VerificationReport | null = null;

  public showReport(report: VerificationReport, panelFactory: (title: string) => IWebviewPanel): void {
    this.lastReport = report;

    if (!this.currentPanel) {
      this.currentPanel = panelFactory("RepoPilot: TestSheriff Verification");
      this.currentPanel.onDidDispose(() => {
        this.currentPanel = null;
      });
    }

    const html = generateVerificationWidgetHtml(report);
    this.currentPanel.webview.html = html;
    this.currentPanel.reveal();
  }

  public getCurrentReport(): VerificationReport | null {
    return this.lastReport;
  }
}
