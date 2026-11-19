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
    <div
      className="border rounded-lg p-2.5 flex items-center justify-between text-xs transition shadow-sm font-sans"
      style={{
        backgroundColor: 'var(--vscode-editor-background, #ffffff)',
        borderColor: 'var(--vscode-panel-border, #d0d7de)',
      }}
    >
      <div className="flex items-center gap-2.5">
        <div className="p-1 rounded bg-gray-100 border border-gray-200 text-gray-700 font-mono flex items-center justify-center">
          <IconTerminal size={13} />
        </div>
        <div>
          <div className="font-medium text-gray-900 flex items-center gap-2">
            <code className="text-blue-700 font-mono font-semibold">{toolName}</code>
            {target && (
              <span className="text-gray-600 font-mono text-[11px] bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
                {target}
              </span>
            )}
          </div>
          {detail && <div className="text-[11px] text-gray-500 mt-0.5 font-mono">{detail}</div>}
        </div>
      </div>

      <div className="flex items-center">
        {status === 'started' && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
            <IconLoader size={11} />
            <span>Running…</span>
          </span>
        )}
        {status === 'succeeded' && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-300">
            <IconCheck size={11} />
            <span>Success {durationMs ? `(${durationMs}ms)` : ''}</span>
          </span>
        )}
        {status === 'failed' && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-300">
            <IconX size={11} />
            <span>Failed</span>
          </span>
        )}
      </div>
    </div>
  );
};
