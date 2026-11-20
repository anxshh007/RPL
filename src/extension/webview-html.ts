// OWNER: Member 5 — VS Code Webview HTML generation with strict CSP
import * as vscode from 'vscode';

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export function renderWebviewHtml(
  cspSource: string,
  scriptUri: vscode.Uri,
  cssUri?: vscode.Uri,
): string {
  const n = nonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${n}' ${cspSource}; font-src ${cspSource} data:; img-src ${cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RepoPilot AI</title>
  ${cssUri ? `<link rel="stylesheet" href="${cssUri}">` : ''}
</head>
<body>
  <div id="root"></div>
  <script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function renderPlaceholderHtml(cspSource: string): string {
  const n = nonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}'; font-src ${cspSource} data:; img-src ${cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RepoPilot AI</title>
<style nonce="${n}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  #log { margin-top: 12px; font-family: var(--vscode-editor-font-family); font-size: 12px; white-space: pre-wrap; }
</style>
</head>
<body>
  <h3>RepoPilot AI</h3>
  <div id="log">Loading RepoPilot Webview Panel…</div>
</body>
</html>`;
}
