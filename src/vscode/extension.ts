/**
 * VS Code Extension Activation & Command Registration for TestSheriff
 * Connects RepoPilot IDE integration commands with the verification engine.
 */

import { verifyChanges, getVerificationReport, discoverTests, selectTests } from "../verification/index.ts";
import { TestSheriffStatusBarProvider } from "./status-bar.ts";
import { TestSheriffWebviewProvider, type IWebviewPanel } from "./webview-provider.ts";
import type { VerificationReport } from "../shared/types/verification.ts";

export interface ExtensionContext {
  subscriptions: Array<{ dispose(): void }>;
}

export class TestSheriffExtensionController {
  public readonly statusBar = new TestSheriffStatusBarProvider();
  public readonly webview = new TestSheriffWebviewProvider();

  public async handleVerifyCommand(
    workspaceRoot: string,
    changedFiles: string[],
    panelFactory?: (title: string) => IWebviewPanel
  ): Promise<VerificationReport> {
    this.statusBar.updateState("running");

    const requestId = `vscode-verify-${Date.now()}`;
    const report = await verifyChanges({
      requestId,
      workspaceRoot,
      changedFiles,
    });

    this.statusBar.updateReport(report);

    if (panelFactory) {
      this.webview.showReport(report, panelFactory);
    }

    return report;
  }

  public async handleDiscoverCommand(
    workspaceRoot: string,
    changedFiles: string[] = []
  ) {
    this.statusBar.updateState("discovering");
    const discovery = await discoverTests(workspaceRoot);
    const selection = await selectTests({ workspaceRoot, changedFiles });
    this.statusBar.updateState("ready");
    return { discovery, selection };
  }
}

export const extensionController = new TestSheriffExtensionController();
