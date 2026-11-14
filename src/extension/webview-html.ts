// OWNER: Member 5. Temporary plain-HTML panel so the bridge can be tested end to end.
// Replace with the React + Vite build from src/webview/ (loaded from /media) — keep the CSP strict.

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export function renderPlaceholderHtml(cspSource: string): string {
  const n = nonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${cspSource} 'nonce-${n}'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RepoPilot AI</title>
<style nonce="${n}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  textarea { width: 100%; min-height: 70px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
  button { margin: 6px 6px 0 0; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 4px 10px; cursor: pointer; }
  #log { margin-top: 12px; font-family: var(--vscode-editor-font-family); font-size: 12px; white-space: pre-wrap; }
  .muted { opacity: .7; }
</style>
</head>
<body>
  <h3>RepoPilot AI <span id="ws" class="muted"></span></h3>
  <textarea id="instruction" placeholder="Describe the change. Use @file:path or @symbol:name to pin context."></textarea>
  <div><button id="run">Run</button><button id="cancel" disabled>Cancel</button></div>
  <div id="log" class="muted">Placeholder UI — Member 5 replaces this with the React panel.</div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const cancelBtn = document.getElementById('cancel');
  let current = null;
  const add = (t) => { log.textContent += '\\n' + t; };
  document.getElementById('run').onclick = () => {
    const instruction = document.getElementById('instruction').value;
    if (instruction.trim()) vscode.postMessage({ type: 'ui.submit', instruction, mode: 'agent' });
  };
  cancelBtn.onclick = () => current && vscode.postMessage({ type: 'ui.cancel', requestId: current });
  window.addEventListener('message', ({ data }) => {
    if (data.type === 'host.workspace') document.getElementById('ws').textContent = data.available ? '— ' + data.name : '— no folder open';
    if (data.type === 'host.error') add('Error: ' + data.message);
    if (data.type !== 'host.event') return;
    const e = data.event;
    if (e.type === 'agent.status') {
      current = ['completed','cancelled','error'].includes(e.state) ? null : e.requestId;
      cancelBtn.disabled = !current;
      add('[' + e.state + '] ' + e.message);
    } else if (e.type === 'agent.warning') add('⚠ ' + e.message);
    else if (e.type === 'agent.error') add('✖ ' + e.error.message);
    else add('• ' + e.type);
  });
  vscode.postMessage({ type: 'ui.ready' });
</script>
</body>
</html>`;
}
