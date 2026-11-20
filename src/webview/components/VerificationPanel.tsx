import React, { useState } from 'react';
import type { VerificationReport } from '../../shared/contracts';
import {
  IconFlask,
  IconCheckCircle,
  IconX,
  IconLoader,
  IconChevronDown,
  IconChevronRight,
} from './Icons';

export interface VerificationPanelProps {
  report?: VerificationReport;
  isRunning?: boolean;
}

export const VerificationPanel: React.FC<VerificationPanelProps> = ({
  report,
  isRunning = false,
}) => {
  const [showFailures, setShowFailures] = useState(true);

  if (isRunning) {
    return (
      <div
        className="rounded-lg p-3 text-xs border shadow-sm font-sans"
        style={{
          backgroundColor: 'var(--rp-verify-bg, #faf5ff)',
          borderColor: 'var(--rp-verify-border, #e9d5ff)',
          color: 'var(--rp-verify-text, #6b21a8)',
        }}
      >
        <div className="flex items-center gap-2 font-mono">
          <IconLoader size={14} className="text-purple-600" />
          <span className="font-semibold">TestSheriff is executing candidate pytest suites…</span>
        </div>
      </div>
    );
  }

  if (!report || report.status === 'not_run') {
    return (
      <div
        className="rounded-lg p-3 text-xs border flex items-center justify-between shadow-sm font-sans"
        style={{
          backgroundColor: 'var(--vscode-editor-background, #ffffff)',
          borderColor: 'var(--vscode-panel-border, #d0d7de)',
          color: 'var(--vscode-descriptionForeground, #57606a)',
        }}
      >
        <div className="flex items-center gap-2">
          <IconFlask size={14} className="text-gray-400" />
          <span>No verification run pending. Tests execute automatically after changes are applied.</span>
        </div>
        <span
          className="font-mono text-[11px] px-2 py-0.5 rounded border"
          style={{
            backgroundColor: 'var(--vscode-sideBar-background, #f6f8fa)',
            borderColor: 'var(--vscode-panel-border, #d0d7de)',
          }}
        >
          Idle
        </span>
      </div>
    );
  }

  const isPassed = report.status === 'passed';
  const isFailed = report.status === 'failed';

  return (
    <div
      className="rounded-lg p-3 text-xs border shadow-sm font-sans"
      style={{
        backgroundColor: 'var(--vscode-editor-background, #ffffff)',
        borderColor: 'var(--vscode-panel-border, #d0d7de)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="font-mono flex items-center gap-2" style={{ color: 'var(--vscode-editor-foreground, #1f2328)' }}>
          <div className="p-1 rounded bg-purple-50 border border-purple-200 text-purple-600">
            <IconFlask size={14} />
          </div>
          <span className="font-semibold">{report.commandLabel || 'pytest -q'}</span>
        </div>
        {report.durationMs !== null && (
          <span
            className="text-[11px] font-mono px-2 py-0.5 rounded border"
            style={{
              backgroundColor: 'var(--vscode-sideBar-background, #f6f8fa)',
              borderColor: 'var(--vscode-panel-border, #d0d7de)',
              color: 'var(--vscode-descriptionForeground, #57606a)',
            }}
          >
            Duration: {(report.durationMs / 1000).toFixed(2)}s
          </span>
        )}
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-4 gap-2 text-center font-mono my-2">
        <div className="p-2 rounded border bg-gray-50 border-gray-200">
          <div className="text-gray-500 text-[10px] font-semibold">TOTAL</div>
          <div className="text-sm font-bold text-gray-900">{report.counts.total ?? '—'}</div>
        </div>
        <div className="p-2 rounded border bg-emerald-50 border-emerald-200">
          <div className="text-emerald-700 text-[10px] font-semibold">PASSED</div>
          <div className="text-sm font-bold text-emerald-700">{report.counts.passed ?? '—'}</div>
        </div>
        <div className="p-2 rounded border bg-red-50 border-red-200">
          <div className="text-red-700 text-[10px] font-semibold">FAILED</div>
          <div className="text-sm font-bold text-red-700">{report.counts.failed ?? '—'}</div>
        </div>
        <div className="p-2 rounded border bg-amber-50 border-amber-200">
          <div className="text-amber-700 text-[10px] font-semibold">SKIPPED</div>
          <div className="text-sm font-bold text-amber-700">{report.counts.skipped ?? 0}</div>
        </div>
      </div>

      {/* Pass/Fail Status Banner */}
      <div
        className="mt-2 pt-2 border-t flex items-center justify-between"
        style={{ borderColor: 'var(--vscode-panel-border, #d0d7de)' }}
      >
        <div className="flex items-center gap-1.5 font-mono">
          {isPassed && (
            <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
              <IconCheckCircle size={14} />
              <span>All candidate test suites passed</span>
            </span>
          )}
          {isFailed && (
            <span className="inline-flex items-center gap-1.5 text-red-700 font-semibold">
              <IconX size={14} />
              <span>Regressions detected by TestSheriff</span>
            </span>
          )}
        </div>

        {report.failures && report.failures.length > 0 && (
          <button
            type="button"
            onClick={() => setShowFailures(!showFailures)}
            aria-expanded={showFailures}
            className="cursor-pointer inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900"
          >
            <span>{report.failures.length} Failure details</span>
            {showFailures ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          </button>
        )}
      </div>

      {/* Failure Diagnostics Details */}
      {showFailures && report.failures && report.failures.length > 0 && (
        <div
          className="mt-2 space-y-1.5 pt-2 border-t"
          style={{ borderColor: 'var(--vscode-panel-border, #d0d7de)' }}
        >
          {report.failures.map((f, i) => (
            <div key={i} className="p-2.5 rounded border bg-red-50 border-red-200 font-mono text-xs">
              <div className="text-red-800 font-semibold flex items-center gap-1.5">
                <IconX size={12} className="text-red-600" />
                <span>{f.testName}</span>
              </div>
              <div className="text-red-700 text-[11px] mt-1 pl-3 border-l-2 border-red-400 whitespace-pre-wrap">
                {f.message}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
