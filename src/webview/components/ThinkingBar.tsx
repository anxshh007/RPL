import React, { useState } from 'react';

export interface ThinkingStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed';
  timestamp?: string;
}

export interface ThinkingBarProps {
  headline: string;
  elapsedSeconds?: number;
  steps: ThinkingStep[];
  isStreaming?: boolean;
}

export const ThinkingBar: React.FC<ThinkingBarProps> = ({
  headline,
  elapsedSeconds = 0,
  steps,
  isStreaming = false,
}) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border border-sky-900/60 bg-sky-950/20 rounded-lg p-3 transition-all">
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5">
          <span className={`w-2.5 h-2.5 rounded-full bg-sky-400 ${isStreaming ? 'animate-pulse' : ''}`} />
          <span className="text-xs font-medium text-sky-200">
            {headline}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-sky-400 font-mono">
          <span>{steps.length} steps</span>
          {elapsedSeconds > 0 && <span className="text-zinc-500">({elapsedSeconds.toFixed(1)}s)</span>}
          <span className="transform transition-transform">{expanded ? '▼' : '▶'}</span>
        </div>
      </div>

      {expanded && steps.length > 0 && (
        <div className="mt-3 pt-3 border-t border-sky-900/40 text-xs font-mono space-y-2 text-zinc-300">
          {steps.map((step) => (
            <div key={step.id} className="flex items-start gap-2">
              {step.status === 'completed' && <span className="text-emerald-400">✓</span>}
              {step.status === 'running' && <span className="text-sky-400 animate-spin">◐</span>}
              {step.status === 'pending' && <span className="text-zinc-600">○</span>}
              <span className={step.status === 'running' ? 'text-sky-300' : 'text-zinc-400'}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
