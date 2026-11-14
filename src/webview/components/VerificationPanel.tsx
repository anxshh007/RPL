import React from 'react';
import type { VerificationReport } from '../../shared/contracts';

export interface VerificationPanelProps {
  report?: VerificationReport;
  isRunning?: boolean;
}

export const VerificationPanel: React.FC<VerificationPanelProps> = ({
  report,
  isRunning = false,
}) => {
  if (isRunning) {
    return (
      <div className="border border-purple-900/60 bg-purple-950/20 rounded-lg p-3 text-xs">
        <div className="flex items-center gap-2 text-purple-300">
          <span className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-pulse" />
          <span className="font-medium">TestSheriff is executing candidate pytest suites…</span>
        </div>
      </div>
    );
  }

  if (!report || report.status === 'not_run') {
    return (
      <div className="border border-zinc-800 bg-zinc-900/40 rounded-lg p-3 text-xs text-zinc-500 flex items-center justify-between">
        <span>No verification run pending. Tests execute automatically after changes are applied.</span>
        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">Idle</span>
      </div>
    );
  }

  const isPassed = report.status === 'passed';
  const isFailed = report.status === 'failed';

  return (
    <div className="border border-zinc-700/80 bg-zinc-900/60 rounded-lg p-3 text-xs">
      <div className="flex items-center justify-between mb-2">
        <div className="font-mono text-zinc-300 flex items-center gap-2">
          <span className="text-zinc-500">$</span> {report.commandLabel || 'pytest -q'}
        </div>
        {report.durationMs !== null && (
          <span className="text-[11px] text-zinc-500 font-mono">
            Duration: {(report.durationMs / 1000).toFixed(2)}s
          </span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 text-center font-mono my-3">
        <div className="bg-zinc-800/60 p-2 rounded border border-zinc-700">
          <div className="text-zinc-400 text-[10px]">TOTAL</div>
          <div className="text-sm font-bold text-white">{report.counts.total ?? '—'}</div>
        </div>
        <div className="bg-emerald-950/30 p-2 rounded border border-emerald-800/40">
          <div className="text-emerald-400 text-[10px]">PASSED</div>
          <div className="text-sm font-bold text-emerald-400">{report.counts.passed ?? '—'}</div>
        </div>
        <div className="bg-rose-950/30 p-2 rounded border border-rose-800/40">
          <div className="text-rose-400 text-[10px]">FAILED</div>
          <div className="text-sm font-bold text-rose-400">{report.counts.failed ?? '—'}</div>
        </div>
        <div className="bg-zinc-800/60 p-2 rounded border border-zinc-700">
          <div className="text-zinc-400 text-[10px]">SKIPPED</div>
          <div className="text-sm font-bold text-zinc-400">{report.counts.skipped ?? '—'}</div>
        </div>
      </div>

      {isPassed && (
        <div className="text-[11px] text-emerald-400 flex items-center gap-1.5 font-medium">
          ✓ All tests passed with exit code 0.
        </div>
      )}

      {isFailed && report.failures.length > 0 && (
        <div className="mt-2 text-rose-400 text-[11px] space-y-1">
          {report.failures.map((f, i) => (
            <div key={i} className="bg-rose-950/40 p-2 rounded border border-rose-800/50">
              <span className="font-semibold">{f.testName}</span>: {f.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
