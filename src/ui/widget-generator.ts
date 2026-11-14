/**
 * Interactive Verification Widget & Generative UI Generator
 * Generates standalone, responsive HTML/CSS/JS widgets for Member 5's UI webviews.
 * Features test metric counters, status filters, expandable failure details,
 * evidence-based hypothesis cards, and limitations disclosure.
 */

import type { VerificationReport } from "../shared/types/verification.ts";
import { mapReportToUIState } from "./ui-state-adapter.ts";

export function generateVerificationWidgetHtml(report: VerificationReport): string {
  const uiView = mapReportToUIState(report);

  const statusColors: Record<string, { bg: string; text: string; border: string }> = {
    tests_passed: { bg: "#ECFDF5", text: "#065F46", border: "#10B981" },
    tests_failed: { bg: "#FEF2F2", text: "#991B1B", border: "#EF4444" },
    execution_timed_out: { bg: "#FFFBEB", text: "#92400E", border: "#F59E0B" },
    execution_cancelled: { bg: "#F3F4F6", text: "#374151", border: "#9CA3AF" },
    verification_incomplete: { bg: "#FEF2F2", text: "#991B1B", border: "#EF4444" },
    ready_to_execute: { bg: "#EFF6FF", text: "#1E40AF", border: "#3B82F6" },
  };

  const theme = statusColors[uiView.state] || { bg: "#F9FAFB", text: "#111827", border: "#E5E7EB" };

  const failuresHtml = report.failures.length === 0
    ? `<div class="no-failures">✔ No test failures detected during this run.</div>`
    : report.failures
        .map(
          (f, idx) => `
        <div class="failure-card">
          <div class="failure-header">
            <span class="failure-badge">FAILURE #${idx + 1}</span>
            <span class="failure-test-name">${escapeHtml(f.testName)}</span>
            ${f.file ? `<span class="failure-file">${escapeHtml(f.file)}</span>` : ""}
          </div>
          <div class="failure-message">${escapeHtml(f.message)}</div>
          ${
            f.hypothesis
              ? `<div class="hypothesis-box">
                  <strong>Diagnostic Hypothesis:</strong> ${escapeHtml(f.hypothesis)}
                </div>`
              : ""
          }
          ${
            f.errorDetails
              ? `<details class="traceback-details">
                  <summary>View Technical Traceback</summary>
                  <pre class="traceback-content">${escapeHtml(f.errorDetails)}</pre>
                </details>`
              : ""
          }
        </div>
      `
        )
        .join("");

  const limitationsHtml = report.limitations
    .map((l) => `<li>${escapeHtml(l)}</li>`)
    .join("");

  const testCasesRows = (report.testCases || [])
    .map(
      (tc) => `
      <tr class="test-row status-${tc.status}">
        <td class="status-indicator"><span class="pill pill-${tc.status}">${tc.status.toUpperCase()}</span></td>
        <td class="test-name">${escapeHtml(tc.name)}</td>
        <td class="test-file">${escapeHtml(tc.file || "-")}</td>
        <td class="test-message">${escapeHtml(tc.message || "Passed without assertion errors")}</td>
      </tr>
    `
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>RepoPilot Verification Dashboard</title>
  <style>
    :root {
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --bg: #F9FAFB;
      --card-bg: #FFFFFF;
      --text: #1F2937;
      --text-muted: #6B7280;
      --border: #E5E7EB;
      --success: #10B981;
      --danger: #EF4444;
      --warning: #F59E0B;
      --info: #3B82F6;
    }
    body {
      font-family: var(--font-family);
      margin: 0;
      padding: 20px;
      background: var(--bg);
      color: var(--text);
    }
    .dashboard-container {
      max-width: 960px;
      margin: 0 auto;
      background: var(--card-bg);
      border-radius: 12px;
      border: 1px solid var(--border);
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
      overflow: hidden;
    }
    .header-banner {
      background: ${theme.bg};
      border-bottom: 2px solid ${theme.border};
      color: ${theme.text};
      padding: 20px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .headline-title {
      font-size: 1.25rem;
      font-weight: 700;
      margin: 0;
    }
    .request-id {
      font-size: 0.85rem;
      opacity: 0.8;
      margin-top: 4px;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      border-bottom: 1px solid var(--border);
    }
    .metric-card {
      padding: 16px;
      text-align: center;
      border-right: 1px solid var(--border);
    }
    .metric-card:last-child {
      border-right: none;
    }
    .metric-value {
      font-size: 1.5rem;
      font-weight: 700;
    }
    .metric-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .section {
      padding: 20px 24px;
      border-bottom: 1px solid var(--border);
    }
    .section:last-child {
      border-bottom: none;
    }
    .section-title {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .command-tag {
      background: #1E293B;
      color: #E2E8F0;
      font-family: monospace;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.85rem;
      word-break: break-all;
    }
    .failure-card {
      background: #FEF2F2;
      border: 1px solid #FCA5A5;
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 12px;
    }
    .failure-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .failure-badge {
      background: var(--danger);
      color: white;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .failure-test-name {
      font-weight: 600;
      color: #991B1B;
    }
    .failure-file {
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .failure-message {
      font-family: monospace;
      font-size: 0.85rem;
      background: rgba(255,255,255,0.7);
      padding: 8px;
      border-radius: 4px;
      color: #7F1D1D;
    }
    .hypothesis-box {
      margin-top: 10px;
      background: #EFF6FF;
      border-left: 3px solid var(--info);
      padding: 8px 12px;
      font-size: 0.85rem;
      color: #1E3A8A;
      border-radius: 0 4px 4px 0;
    }
    .traceback-details {
      margin-top: 10px;
      font-size: 0.8rem;
    }
    .traceback-content {
      background: #111827;
      color: #F9FAFB;
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 0.75rem;
      margin-top: 6px;
    }
    .limitations-box {
      background: #FFFBEB;
      border: 1px solid #FDE68A;
      border-radius: 8px;
      padding: 12px 16px;
      color: #92400E;
      font-size: 0.85rem;
    }
    .limitations-box ul {
      margin: 6px 0 0 18px;
      padding: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th, td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      background: #F8FAFC;
      font-weight: 600;
      color: var(--text-muted);
    }
    .pill {
      font-size: 0.7rem;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 9999px;
      text-transform: uppercase;
    }
    .pill-passed { background: #D1FAE5; color: #065F46; }
    .pill-failed { background: #FEE2E2; color: #991B1B; }
    .pill-skipped { background: #FEF3C7; color: #92400E; }
    .pill-error { background: #FEE2E2; color: #991B1B; }
  </style>
</head>
<body>
  <div class="dashboard-container">
    <div class="header-banner">
      <div>
        <h1 class="headline-title">${escapeHtml(uiView.headline)}</h1>
        <div class="request-id">Request ID: ${escapeHtml(report.requestId)} | Runner: ${escapeHtml(report.runner)}</div>
      </div>
      <div>
        <span class="pill pill-${report.status === "passed" ? "passed" : report.status === "failed" ? "failed" : "skipped"}" style="font-size: 0.9rem; padding: 6px 14px;">
          ${report.status.toUpperCase()}
        </span>
      </div>
    </div>

    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-value">${report.total}</div>
        <div class="metric-label">Total Tests</div>
      </div>
      <div class="metric-card" style="color: var(--success);">
        <div class="metric-value">${report.passed}</div>
        <div class="metric-label">Passed</div>
      </div>
      <div class="metric-card" style="color: var(--danger);">
        <div class="metric-value">${report.failed}</div>
        <div class="metric-label">Failed</div>
      </div>
      <div class="metric-card" style="color: var(--warning);">
        <div class="metric-value">${report.skipped}</div>
        <div class="metric-label">Skipped</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${uiView.durationLabel}</div>
        <div class="metric-label">Duration</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Executed Test Command</div>
      <div class="command-tag">${escapeHtml(report.commandLabel)}</div>
    </div>

    ${
      report.failures.length > 0
        ? `
    <div class="section">
      <div class="section-title">Failure Analysis & Grounded Hypotheses</div>
      ${failuresHtml}
    </div>`
        : ""
    }

    ${
      testCasesRows.length > 0
        ? `
    <div class="section">
      <div class="section-title">Test Cases Breakdown</div>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Test</th>
            <th>File</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${testCasesRows}
        </tbody>
      </table>
    </div>`
        : ""
    }

    <div class="section">
      <div class="section-title">Verification Limitations & Boundaries</div>
      <div class="limitations-box">
        <div><strong>Disclosed Verification Boundaries:</strong></div>
        <ul>${limitationsHtml}</ul>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
