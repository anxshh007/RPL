import React from 'react';

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
    <div className="border border-zinc-700/80 bg-zinc-900/60 rounded-lg p-3 flex items-center justify-between text-xs">
      <div className="flex items-center gap-3">
        <div className="p-1.5 rounded bg-zinc-800 text-zinc-300 font-mono">
          &gt;_
        </div>
        <div>
          <div className="font-medium text-white flex items-center gap-2">
            <code className="text-sky-300">{toolName}</code>
            {target && <span className="text-zinc-400 font-mono text-[11px]">{target}</span>}
          </div>
          {detail && <div className="text-[11px] text-zinc-400 mt-0.5">{detail}</div>}
        </div>
      </div>
      <div>
        {status === 'started' && (
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-sky-950 text-sky-400 border border-sky-800 animate-pulse">
            Running…
          </span>
        )}
        {status === 'succeeded' && (
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
            Succeeded {durationMs ? `(${durationMs}ms)` : ''}
          </span>
        )}
        {status === 'failed' && (
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800">
            Failed
          </span>
        )}
      </div>
    </div>
  );
};
