import * as vscode from 'vscode';
import { fetchSnapshot, Snapshot } from './cursorApi';

const SECRET_KEY = 'cursorMeter.workosSessionToken';
let status: vscode.StatusBarItem;
let output: vscode.OutputChannel;
let timer: NodeJS.Timeout | undefined;
let lastSnapshot: Snapshot | undefined;

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('Cursor Meter');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'cursorMeter.openPanel';
  status.text = '$(pulse) Cursor Meter';
  status.tooltip = 'Cursor Meter: click to open usage panel';
  status.show();

  context.subscriptions.push(
    output,
    status,
    vscode.commands.registerCommand('cursorMeter.refresh', () => refresh(context, true)),
    vscode.commands.registerCommand('cursorMeter.setToken', () => setToken(context)),
    vscode.commands.registerCommand('cursorMeter.clearToken', () => clearToken(context)),
    vscode.commands.registerCommand('cursorMeter.openPanel', () => openPanel(context)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cursorMeter')) restartTimer(context);
    })
  );

  refresh(context, false).catch((err) => log(`Initial refresh failed: ${String(err)}`));
  restartTimer(context);
}

export function deactivate() {
  if (timer) clearInterval(timer);
}

async function setToken(context: vscode.ExtensionContext) {
  const token = await vscode.window.showInputBox({
    title: 'Cursor Meter: Set Session Token',
    prompt: 'Paste WorkosCursorSessionToken from cursor.com cookies. Stored in VS Code SecretStorage.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? undefined : 'Token is required'
  });
  if (!token) return;
  await context.secrets.store(SECRET_KEY, token.trim());
  vscode.window.showInformationMessage('Cursor Meter token saved.');
  await refresh(context, true);
}

async function clearToken(context: vscode.ExtensionContext) {
  await context.secrets.delete(SECRET_KEY);
  lastSnapshot = undefined;
  status.text = '$(warning) Cursor token missing';
  vscode.window.showInformationMessage('Cursor Meter token cleared.');
}

async function refresh(context: vscode.ExtensionContext, showErrors: boolean) {
  const token = await context.secrets.get(SECRET_KEY);
  if (!token) {
    status.text = '$(warning) Cursor token missing';
    status.tooltip = 'Run Cursor Meter: Set Session Token';
    if (showErrors) vscode.window.showWarningMessage('Set your Cursor session token first.', 'Set Token').then((choice) => {
      if (choice === 'Set Token') setToken(context);
    });
    return;
  }

  const cfg = vscode.workspace.getConfiguration('cursorMeter');
  const range = cfg.get<string>('range', 'today');
  const pageSize = cfg.get<number>('pageSize', 100);
  const maxPages = cfg.get<number>('maxPages', 2);

  status.text = '$(sync~spin) Cursor…';
  try {
    const snapshot = await fetchSnapshot({ token, pageSize, maxPages }, range);
    lastSnapshot = snapshot;
    const dollars = snapshot.totals.totalDollars;
    const last = snapshot.recentEvents[0];
    status.text = `$(pulse) Cursor ${formatMoney(dollars)}`;
    status.tooltip = [
      `Range: ${range}`,
      `Spend: ${formatMoney(dollars)}`,
      `Events: ${snapshot.totals.eventCount.toLocaleString()}`,
      `Tokens: ${snapshot.totals.totalTokens.toLocaleString()}`,
      last ? `Last: ${formatMoney((last.chargedCents || 0) / 100)} · ${last.model}` : 'Last: —'
    ].join('\n');
    log(`Refreshed ${range}: ${formatMoney(dollars)}, ${snapshot.totals.eventCount} events`);
  } catch (err: any) {
    status.text = '$(error) Cursor Meter error';
    status.tooltip = err?.message || String(err);
    log(`Refresh failed: ${err?.stack || err?.message || String(err)}`);
    if (showErrors) vscode.window.showErrorMessage(`Cursor Meter refresh failed: ${err?.message || String(err)}`);
  }
}

function restartTimer(context: vscode.ExtensionContext) {
  if (timer) clearInterval(timer);
  const seconds = vscode.workspace.getConfiguration('cursorMeter').get<number>('refreshSeconds', 60);
  timer = setInterval(() => refresh(context, false), Math.max(20, seconds) * 1000);
}

async function openPanel(context: vscode.ExtensionContext) {
  if (!lastSnapshot) await refresh(context, true);
  if (!lastSnapshot) return;
  const panel = vscode.window.createWebviewPanel('cursorMeter', 'Cursor Meter', vscode.ViewColumn.One, { enableScripts: false });
  panel.webview.html = renderHtml(lastSnapshot);
}

function renderHtml(snapshot: Snapshot): string {
  const modelRows = snapshot.byModel.map((row) => `
    <tr><td>${escapeHtml(row.model)}</td><td>${formatMoney(row.totalCents / 100)}</td><td>${row.eventCount}</td><td>${row.totalTokens.toLocaleString()}</td></tr>
  `).join('');
  const eventRows = snapshot.recentEvents.slice(0, 25).map((event) => `
    <tr><td>${event.timestamp ? new Date(event.timestamp).toLocaleString() : '—'}</td><td>${escapeHtml(event.model)}</td><td>${formatMoney((event.chargedCents || 0) / 100)}</td><td>${event.totalTokens.toLocaleString()}</td></tr>
  `).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:system-ui,sans-serif;padding:20px;line-height:1.4} table{border-collapse:collapse;width:100%;margin:12px 0 24px} td,th{border-bottom:1px solid #8884;padding:6px;text-align:left} .big{font-size:32px;font-weight:700}
  </style></head><body>
    <h1>Cursor Meter</h1>
    <div class="big">${formatMoney(snapshot.totals.totalDollars)}</div>
    <p>${snapshot.totals.eventCount.toLocaleString()} events · ${snapshot.totals.totalTokens.toLocaleString()} tokens · generated ${escapeHtml(snapshot.generatedAt)}</p>
    <h2>By model</h2><table><thead><tr><th>Model</th><th>Spend</th><th>Events</th><th>Tokens</th></tr></thead><tbody>${modelRows}</tbody></table>
    <h2>Recent events</h2><table><thead><tr><th>Time</th><th>Model</th><th>Spend</th><th>Tokens</th></tr></thead><tbody>${eventRows}</tbody></table>
  </body></html>`;
}

function log(message: string) {
  output.appendLine(`[${new Date().toISOString()}] ${message}`);
}
function formatMoney(value: number) {
  if (Math.abs(value) < 0.01 && value !== 0) return `${(value * 100).toFixed(2)}¢`;
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: value < 10 ? 4 : 2 });
}
function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]!));
}
