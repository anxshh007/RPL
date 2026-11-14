import React from 'react';
import { IconTerminal, IconCheck, IconLoader, IconX } from './Icons';

export interface ToolBlockProps {
  toolName: string;
  target?: string;
  detail?: string;
  status: 'started' | 'succeeded' | 'failed';
  durationMs?: number;
}

export const ToolBlock: React.FC<ToolBlockProps> = ({
  toolName,
  target,
  detail,
  status,
  durationMs,
}) => {
  return (
    <div className="border border-slate-700/80 bg-[#0E1223] hover:border-slate-600 rounded-xl p-3 flex items-center justify-between text-xs transition-colors duration-150 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="p-1.5 rounded-lg bg-slate-800 border border-slate-700/60 text-slate-300 font-mono flex items-center justify-center">
          <IconTerminal size={14} />
        </div>
        <div>
          <div className="font-medium text-slate-100 flex items-center gap-2">
            <code className="text-emerald-400 font-mono font-semibold">{toolName}</code>
            {target && (
              <span className="text-slate-400 font-mono text-[11px] bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700/50">
                {target}
              </span>
            )}
          </div>
          {detail && <div className="text-[11px] text-slate-400 mt-0.5 font-mono">{detail}</div>}
        </div>
      </div>

      <div className="flex items-center">
        {status === 'started' && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded-md bg-sky-950/80 text-sky-400 border border-sky-700/60 animate-pulse">
            <IconLoader size={12} />
            <span>Executing…</span>
          </span>
        )}
        {status === 'succeeded' && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded-md bg-emerald-950/80 text-emerald-400 border border-emerald-700/60">
            <IconCheck size={12} />
            <span>Success {durationMs ? `(${durationMs}ms)` : ''}</span>
          </span>
        )}
        {status === 'failed' && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded-md bg-rose-950/80 text-rose-400 border border-rose-700/60">
            <IconX size={12} />
            <span>Failed</span>
          </span>
        )}
      </div>
    </div>
  );
};
