// OWNER: Member 5 — "Open diff": VS Code's side-by-side diff between the file on disk and the
// agent's proposed content. The proposed side is a read-only virtual document; nothing is written.
import * as vscode from 'vscode';
import type { ProposedPlans } from './proposed-plans';

export const PROPOSED_SCHEME = 'repopilot-proposed';

/** Serves proposed content for URIs like repopilot-proposed:/src/app.py?requestId=req-1 */
export function registerProposedContentProvider(plans: ProposedPlans): vscode.Disposable {
  return vscode.workspace.registerTextDocumentContentProvider(PROPOSED_SCHEME, {
    provideTextDocumentContent(uri: vscode.Uri): string {
      const params = new URLSearchParams(uri.query);
      if (params.get('side') === 'empty') {
        return ''; // left side for a file the proposal creates
      }
      const change = plans.get(params.get('requestId') ?? '', uri.path.replace(/^\//, ''));
      return change?.proposedContent ?? '';
    },
  });
}

export async function openProposedDiff(plans: ProposedPlans, requestId: string, path: string): Promise<void> {
  const change = plans.get(requestId, path);
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!change || !folder) {
    void vscode.window.showWarningMessage('RepoPilot: this proposal is no longer available to compare.');
    return;
  }

  const query = `requestId=${encodeURIComponent(requestId)}`;
  const proposed = vscode.Uri.from({ scheme: PROPOSED_SCHEME, path: `/${change.path}`, query });
  const current =
    change.changeType === 'create'
      ? vscode.Uri.from({ scheme: PROPOSED_SCHEME, path: `/${change.path}`, query: `${query}&side=empty` })
      : vscode.Uri.joinPath(folder.uri, ...change.path.split('/'));

  await vscode.commands.executeCommand('vscode.diff', current, proposed, `${change.path} ↔ RepoPilot proposal`, {
    preview: true,
  });
}
