// OWNER: Member 5 — VS Code entry point, commands and webview bridge
// (brief: docs/briefs/05_member5_vscode_ui.md). Domain logic stays in the owner modules;
// this file only builds ChangeRequests, forwards UI actions and renders events.
import * as vscode from 'vscode';
import { createRepoPilot, generateConnectorToken, RepoPilotController } from '../agent';
import { ChangeRequest, HostToWebview, isWebviewToHost } from '../shared/contracts';
import { renderWebviewHtml, renderPlaceholderHtml } from './webview-html';
import { ProposedPlans } from './proposed-plans';
import { openProposedDiff, registerProposedContentProvider } from './proposed-diff';

let panel: vscode.WebviewPanel | undefined;
const proposedPlans = new ProposedPlans();

/** Secret storage keys (encrypted by VS Code; never in settings.json). */
const SECRET_API_KEY = 'repopilot.trueforge.apiKey';
const SECRET_CONNECTOR_TOKEN = 'repopilot.mcp.connectorToken';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('RepoPilot AI');
  registerTrueForgeCommands(context);

  let controller: RepoPilotController | undefined;

  async function initController(): Promise<RepoPilotController | undefined> {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) return undefined;
    if (controller) return controller;

    const config = vscode.workspace.getConfiguration('repopilot');
    const baseUrl = config.get<string>('trueforge.baseUrl', '').trim();
    const apiKey = await context.secrets.get(SECRET_API_KEY);
    const newController = createRepoPilot({
      workspaceRoot: workspace.uri.fsPath,
      tokenBudget: config.get<number>('context.tokenBudget'),
      requireTestApproval: config.get<boolean>('tests.requireApproval', true),
      testTimeoutMs: config.get<number>('tests.timeoutMs'),
      openrouter: {
        apiKey: config.get<string>('openrouter.apiKey') || process.env.OPENROUTER_API_KEY || '',
        model: config.get<string>('openrouter.model') || 'google/gemma-4-26b-a4b-it:free',
        baseUrl: config.get<string>('openrouter.baseUrl') || 'https://openrouter.ai/api/v1',
        fallbackModels: [
          'nvidia/nemotron-3.5-lightning:free',
          'nvidia/nemotron-3.5-super-vl:free',
          'nvidia/nemotron-3-ultra-550b-a55b:free',
          'openrouter/auto',
        ],
      },
      trueforge: {
        baseUrl,
        model: config.get<string>('trueforge.model', ''),
        connectorName: config.get<string>('trueforge.connectorName', 'repopilot'),
        ...(apiKey ? { apiKey } : {}),
      },
      ...(baseUrl
        ? {
            mcpConnector: {
              port: config.get<number>('mcp.port', 8791),
              token: await connectorToken(context),
              onReady: (url: string) => output.appendLine(`RepoPilot MCP connector listening at ${url}`),
              onError: (err: Error) => {
                output.appendLine(`RepoPilot MCP connector could not start: ${err.message}`);
                void vscode.window.showWarningMessage(
                  `RepoPilot: the TrueForge connector could not start (${err.message}). Change "repopilot.mcp.port" and reload.`,
                );
              },
            },
          }
        : {}),
    });

    controller = newController;
    output.appendLine('RepoPilot AI initialized with OpenRouter planner (google/gemma-4-26b-a4b-it:free)');
    context.subscriptions.push(
      { dispose: () => void newController.dispose() },
      newController.onEvent((event) => {
        proposedPlans.record(event);
        output.appendLine(`[${event.requestId}] ${event.type}${'message' in event ? ': ' + event.message : ''}`);
        post({ type: 'host.event', event });
      }),
    );
    return controller;
  }

  // Initialize controller asynchronously without blocking extension activation
  void initController().catch((err) => output.appendLine('Controller deferred: ' + String(err)));

  context.subscriptions.push(
    output,
    registerProposedContentProvider(proposedPlans),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await initController();
      const ws = vscode.workspace.workspaceFolders?.[0];
      post({ type: 'host.workspace', available: !!ws, name: ws?.name });
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('repopilot.trueforge') || e.affectsConfiguration('repopilot.mcp')) {
        void promptReload('RepoPilot settings changed.');
      }
    }),
    vscode.commands.registerCommand('repopilot.open', async () => {
      await initController();
      openPanel(context, () => controller);
    }),
    vscode.commands.registerCommand('repopilot.selectModel', async () => {
      const items = [
        { label: 'Gemma 4 26B', description: 'google/gemma-4-26b-a4b-it:free', detail: 'Google Gemma 4' },
        { label: 'Nemotron 3.5 Lightning', description: 'nvidia/nemotron-3.5-lightning:free', detail: 'NVIDIA Fast & Robust' },
        { label: 'Nemotron 3.5 Super VL', description: 'nvidia/nemotron-3.5-super-vl:free', detail: 'NVIDIA Multimodal' },
        { label: 'Nemotron 3 Ultra 550B', description: 'nvidia/nemotron-3-ultra-550b-a55b:free', detail: 'NVIDIA 550B Reasoning' },
        { label: 'OpenRouter Auto', description: 'openrouter/auto', detail: 'Dynamic best available model' },
      ];
      const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select active model for RepoPilot' });
      if (selected) {
        const config = vscode.workspace.getConfiguration('repopilot');
        await config.update('openrouter.model', selected.description, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`RepoPilot: active model set to ${selected.label}`);
        post({ type: 'host.model', model: selected.description });
      }
    }),
    vscode.commands.registerCommand('repopilot.inlineEdit', async () => {
      const activeCtrl = await initController();
      if (!activeCtrl) {
        vscode.window.showWarningMessage('RepoPilot: open a folder first.');
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('RepoPilot: select some code first.');
        return;
      }
      const instruction = await vscode.window.showInputBox({ prompt: 'RepoPilot: what should change in the selection?' });
      if (!instruction) {
        return;
      }
      openPanel(context, () => controller);
      const sel = editor.selection;
      void activeCtrl.submit(
        buildRequest(instruction, 'inline', {
          activeFile: vscode.workspace.asRelativePath(editor.document.uri, false),
          selectedText: editor.document.getText(sel),
          selectionRange: { startLine: sel.start.line + 1, endLine: sel.end.line + 1 },
        }),
      );
    }),
  );
}

/** The connector token: created once with a secure random generator, kept in secret storage. */
async function connectorToken(context: vscode.ExtensionContext): Promise<string> {
  let token = await context.secrets.get(SECRET_CONNECTOR_TOKEN);
  if (!token) {
    token = generateConnectorToken();
    await context.secrets.store(SECRET_CONNECTOR_TOKEN, token);
  }
  return token;
}

async function promptReload(reason: string): Promise<void> {
  const choice = await vscode.window.showInformationMessage(`${reason} Reload the window to apply.`, 'Reload Window');
  if (choice === 'Reload Window') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

/** Commands that work with or without an open folder. */
function registerTrueForgeCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('repopilot.setTrueForgeApiKey', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'TrueForge API key (stored encrypted by VS Code; leave empty to remove it)',
        password: true,
        ignoreFocusOut: true,
      });
      if (value === undefined) return;
      if (value.trim()) {
        await context.secrets.store(SECRET_API_KEY, value.trim());
      } else {
        await context.secrets.delete(SECRET_API_KEY);
      }
      await promptReload('TrueForge API key saved.');
    }),

    vscode.commands.registerCommand('repopilot.showConnectorSetup', async () => {
      const config = vscode.workspace.getConfiguration('repopilot');
      const name = config.get<string>('trueforge.connectorName', 'repopilot');
      const url = `http://127.0.0.1:${config.get<number>('mcp.port', 8791)}/mcp`;
      const token = await connectorToken(context);
      const choice = await vscode.window.showInformationMessage(
        `Add this in TrueForge → Settings → Connectors as a remote MCP server:\n\n` +
          `Name: ${name}\nURL: ${url}\nAuth: header "Authorization" = "Bearer <token>" (use "Copy header value").\n\n` +
          'The TrueForge server must run on this computer to reach 127.0.0.1.',
        { modal: true },
        'Copy URL',
        'Copy header value',
      );
      if (choice === 'Copy URL') {
        await vscode.env.clipboard.writeText(url);
      } else if (choice === 'Copy header value') {
        await vscode.env.clipboard.writeText(`Bearer ${token}`);
        void vscode.window.showInformationMessage('Copied. Paste it as the value of the "Authorization" header.');
      }
    }),

    vscode.commands.registerCommand('repopilot.rotateConnectorToken', async () => {
      await context.secrets.store(SECRET_CONNECTOR_TOKEN, generateConnectorToken());
      await promptReload('New connector token created. Update it in TrueForge (Settings → Connectors).');
    }),
  );
}

function openPanel(context: vscode.ExtensionContext, getController: () => RepoPilotController | undefined): void {
  if (panel) {
    panel.reveal();
    return;
  }
  panel = vscode.window.createWebviewPanel('repopilot', 'RepoPilot AI', vscode.ViewColumn.Beside, {
    enableScripts: true,
    localResourceRoots: [
      context.extensionUri,
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
        case 'ui.submit': {
          const ctrl = getController();
          if (!vscode.workspace.workspaceFolders?.length || !ctrl) {
            post({ type: 'host.error', message: 'Open a folder first.' });
            return;
          }
          if (typeof raw.instruction === 'string' && raw.instruction.trim()) {
            void ctrl.submit(buildRequest(raw.instruction.trim(), 'agent'));
          }
          break;
        }
        case 'ui.cancel':
          getController()?.cancel(raw.requestId);
          break;
        case 'ui.applyDecisions':
          {
            const ctrl = getController();
            if (!ctrl) return;
            const result = await ctrl.applyDecisions(raw.requestId, raw.decisions);
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
                await ctrl.runVerification(raw.requestId);
              }
            }
          }
          break;
        case 'ui.undo':
          await getController()?.undo(raw.requestId);
          break;
        case 'ui.openDiff':
          await openProposedDiff(proposedPlans, raw.requestId, raw.path);
          break;
        case 'ui.setModel': {
          const config = vscode.workspace.getConfiguration('repopilot');
          await config.update('openrouter.model', raw.model, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage(`RepoPilot: model switched to ${raw.model}`);
          post({ type: 'host.model', model: raw.model });
          break;
        }
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
