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
      <div className="border border-purple-700/60 bg-[#0E1223] rounded-xl p-3.5 text-xs shadow-md transition-all duration-200">
        <div className="flex items-center gap-2.5 text-purple-300 font-mono">
          <IconLoader size={15} className="text-purple-400" />
          <span className="font-semibold">TestSheriff is executing candidate pytest suites…</span>
        </div>
      </div>
    );
  }

  if (!report || report.status === 'not_run') {
    return (
      <div className="border border-slate-700/80 bg-[#0E1223] rounded-xl p-3 text-xs text-slate-400 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <IconFlask size={14} className="text-slate-500" />
          <span>No verification run pending. Tests execute automatically after changes are applied.</span>
        </div>
        <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
          Idle
        </span>
      </div>
    );
  }

  const isPassed = report.status === 'passed';
  const isFailed = report.status === 'failed';

  return (
    <div className="border border-slate-700/80 bg-[#0E1223] rounded-xl p-3.5 text-xs shadow-md transition-all duration-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-slate-200 flex items-center gap-2">
          <div className="p-1 rounded bg-slate-800 border border-slate-700/60 text-purple-400">
            <IconFlask size={14} />
          </div>
          <span className="font-semibold text-slate-100">{report.commandLabel || 'pytest -q'}</span>
        </div>
        {report.durationMs !== null && (
          <span className="text-[11px] text-slate-400 font-mono bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/60">
            Duration: {(report.durationMs / 1000).toFixed(2)}s
          </span>
        )}
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-4 gap-2 text-center font-mono my-2.5">
        <div className="bg-[#020617] p-2.5 rounded-lg border border-slate-700">
          <div className="text-slate-400 text-[10px] font-semibold">TOTAL</div>
          <div className="text-base font-bold text-slate-100">{report.counts.total ?? '—'}</div>
        </div>
        <div className="bg-emerald-950/30 p-2.5 rounded-lg border border-emerald-700/60">
          <div className="text-emerald-400 text-[10px] font-semibold">PASSED</div>
          <div className="text-base font-bold text-emerald-400">{report.counts.passed ?? '—'}</div>
        </div>
        <div className="bg-rose-950/30 p-2.5 rounded-lg border border-rose-700/60">
          <div className="text-rose-400 text-[10px] font-semibold">FAILED</div>
          <div className="text-base font-bold text-rose-400">{report.counts.failed ?? '—'}</div>
        </div>
        <div className="bg-amber-950/30 p-2.5 rounded-lg border border-amber-700/60">
          <div className="text-amber-400 text-[10px] font-semibold">SKIPPED</div>
          <div className="text-base font-bold text-amber-400">{report.counts.skipped ?? 0}</div>
        </div>
      </div>

      {/* Pass/Fail Status Banner */}
      <div className="mt-2.5 pt-2.5 border-t border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isPassed && (
            <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold font-mono text-xs">
              <IconCheckCircle size={14} />
              <span>All candidate test suites passed</span>
            </span>
          )}
          {isFailed && (
            <span className="inline-flex items-center gap-1.5 text-rose-400 font-semibold font-mono text-xs">
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
            className="cursor-pointer inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
          >
            <span>{report.failures.length} Failure details</span>
            {showFailures ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          </button>
        )}
      </div>

      {/* Failure Diagnostics Details */}
      {showFailures && report.failures && report.failures.length > 0 && (
        <div className="mt-2.5 space-y-2 pt-2 border-t border-slate-800">
          {report.failures.map((f, i) => (
            <div key={i} className="bg-[#020617] p-2.5 rounded-lg border border-rose-900/60 font-mono text-xs">
              <div className="text-rose-300 font-semibold flex items-center gap-1.5">
                <IconX size={12} className="text-rose-400" />
                <span>{f.testName}</span>
              </div>
              <div className="text-slate-300 text-[11px] mt-1 pl-4 border-l-2 border-rose-700/80 whitespace-pre-wrap">
                {f.message}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
