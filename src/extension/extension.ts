// OWNER: Member 5 — VS Code entry point, commands and webview bridge
// (brief: docs/briefs/05_member5_vscode_ui.md). Domain logic stays in the owner modules;
// this file only builds ChangeRequests, forwards UI actions and renders events.
import * as vscode from 'vscode';
import { createRepoPilot, RepoPilotController } from '../agent';
import { ChangeRequest, HostToWebview, isWebviewToHost } from '../shared/contracts';
import { renderWebviewHtml, renderPlaceholderHtml } from './webview-html';
import { ProposedPlans } from './proposed-plans';
import { openProposedDiff, registerProposedContentProvider } from './proposed-diff';

let panel: vscode.WebviewPanel | undefined;
const proposedPlans = new ProposedPlans();

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('RepoPilot AI');
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) {
    // RepoPilot needs a folder: there is no process.cwd() fallback.
    context.subscriptions.push(
      output,
      vscode.commands.registerCommand('repopilot.open', () => vscode.window.showWarningMessage('RepoPilot: open a folder first.')),
      vscode.commands.registerCommand('repopilot.inlineEdit', () => vscode.window.showWarningMessage('RepoPilot: open a folder first.')),
    );
    return;
  }
  const config = vscode.workspace.getConfiguration('repopilot');
  const controller = createRepoPilot({
    workspaceRoot: workspace.uri.fsPath,
    tokenBudget: config.get<number>('context.tokenBudget'),
    requireTestApproval: config.get<boolean>('tests.requireApproval', true),
    testTimeoutMs: config.get<number>('tests.timeoutMs'),
    trueforge: { baseUrl: config.get<string>('trueforge.baseUrl', '') },
  });

  // Forward every agent event to the log and the panel.
  context.subscriptions.push(
    output,
    registerProposedContentProvider(proposedPlans),
    controller.onEvent((event) => {
      proposedPlans.record(event); // remembered for "Open diff"
      output.appendLine(`[${event.requestId}] ${event.type}${'message' in event ? ': ' + event.message : ''}`);
      post({ type: 'host.event', event });
    }),

    vscode.commands.registerCommand('repopilot.open', () => openPanel(context, controller)),

    vscode.commands.registerCommand('repopilot.inlineEdit', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('RepoPilot: select some code first.');
        return;
      }
      const instruction = await vscode.window.showInputBox({ prompt: 'RepoPilot: what should change in the selection?' });
      if (!instruction) {
        return;
      }
      openPanel(context, controller);
      const sel = editor.selection;
      void controller.submit(
        buildRequest(instruction, 'inline', {
          activeFile: vscode.workspace.asRelativePath(editor.document.uri, false),
          selectedText: editor.document.getText(sel),
          selectionRange: { startLine: sel.start.line + 1, endLine: sel.end.line + 1 },
        }),
      );
    }),
  );
}

function openPanel(context: vscode.ExtensionContext, controller: RepoPilotController): void {
  if (panel) {
    panel.reveal();
    return;
  }
  panel = vscode.window.createWebviewPanel('repopilot', 'RepoPilot AI', vscode.ViewColumn.Beside, {
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.joinPath(context.extensionUri, 'out'),
      vscode.Uri.joinPath(context.extensionUri, 'media'),
    ],
  });
  const scriptUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'out', 'src', 'webview', 'webview.js')
  );
  const cssUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'out', 'src', 'webview', 'webview.css')
  );
  panel.webview.html = renderWebviewHtml(panel.webview.cspSource, scriptUri, cssUri);
  panel.onDidDispose(() => (panel = undefined), null, context.subscriptions);

  panel.webview.onDidReceiveMessage(
    async (raw: unknown) => {
      if (!isWebviewToHost(raw)) {
        return; // never trust unvalidated webview input
      }
      switch (raw.type) {
        case 'ui.ready': {
          const ws = vscode.workspace.workspaceFolders?.[0];
          post({ type: 'host.workspace', available: !!ws, name: ws?.name });
          break;
        }
        case 'ui.submit':
          if (!vscode.workspace.workspaceFolders?.length) {
            post({ type: 'host.error', message: 'Open a folder first.' });
            return;
          }
          if (typeof raw.instruction === 'string' && raw.instruction.trim()) {
            void controller.submit(buildRequest(raw.instruction.trim(), 'agent'));
          }
          break;
        case 'ui.cancel':
          controller.cancel(raw.requestId);
          break;
        case 'ui.applyDecisions':
          {
            const result = await controller.applyDecisions(raw.requestId, raw.decisions);
            // D-12: ask before every TestSheriff run when repopilot.tests.requireApproval is on.
            if (
              result.status === 'applied' &&
              vscode.workspace.getConfiguration('repopilot').get<boolean>('tests.requireApproval', true)
            ) {
              const choice = await vscode.window.showInformationMessage(
                `RepoPilot applied ${result.appliedHunkIds.length} hunk(s). Run the relevant tests now?`,
                'Run tests',
                'Not now',
              );
              if (choice === 'Run tests') {
                await controller.runVerification(raw.requestId);
              }
            }
          }
          break;
        case 'ui.undo':
          await controller.undo(raw.requestId);
          break;
        case 'ui.openDiff':
          await openProposedDiff(proposedPlans, raw.requestId, raw.path);
          break;
      }
    },
    null,
    context.subscriptions,
  );
}

function post(message: HostToWebview): void {
  void panel?.webview.postMessage(message);
}

/** Parses @file / @symbol mentions. Member 2 owns full resolution; this only extracts tokens. */
export function buildRequest(
  instruction: string,
  mode: 'inline' | 'agent',
  extra: Partial<ChangeRequest> = {},
): ChangeRequest {
  const files = [...instruction.matchAll(/@file:(\S+)/g)].map((m) => m[1]);
  const symbols = [...instruction.matchAll(/@symbol:(\S+)/g)].map((m) => m[1]);
  return {
    requestId: `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    instruction,
    mode,
    explicitFileMentions: files,
    explicitSymbolMentions: symbols,
    ...extra,
  };
}

export function deactivate(): void {}
