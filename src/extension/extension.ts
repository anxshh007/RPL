// OWNER: Member 5 — VS Code entry point, commands and webview bridge
// (brief: docs/briefs/05_member5_vscode_ui.md). Domain logic stays in the owner modules;
// this file only builds ChangeRequests, forwards UI actions and renders events.
import * as vscode from 'vscode';
import { createRepoPilot } from '../agent';
import { AgentController, ChangeRequest, HostToWebview, isWebviewToHost } from '../shared/contracts';
import { renderPlaceholderHtml } from './webview-html';

let panel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('RepoPilot AI');
  const config = vscode.workspace.getConfiguration('repopilot');
  const controller = createRepoPilot({ tokenBudget: config.get<number>('context.tokenBudget') });

  // Forward every agent event to the log and the panel.
  context.subscriptions.push(
    output,
    controller.onEvent((event) => {
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

function openPanel(context: vscode.ExtensionContext, controller: AgentController): void {
  if (panel) {
    panel.reveal();
    return;
  }
  panel = vscode.window.createWebviewPanel('repopilot', 'RepoPilot AI', vscode.ViewColumn.Beside, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
  });
  panel.webview.html = renderPlaceholderHtml(panel.webview.cspSource);
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
          await controller.applyDecisions(raw.requestId, raw.decisions);
          break;
        case 'ui.undo':
          await controller.undo(raw.requestId);
          break;
        case 'ui.openDiff':
          // TODO(Member 5): open vscode.diff for the proposed file via the edit service.
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
