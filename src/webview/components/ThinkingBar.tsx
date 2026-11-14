import React, { useState } from 'react';
import {
  IconChevronDown,
  IconChevronRight,
  IconCheckCircle,
  IconLoader,
  IconCircleDot,
  IconSparkles,
} from './Icons';

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setExpanded(!expanded);
    }
  };

  const completedCount = steps.filter((s) => s.status === 'completed').length;

  return (
    <div className="border border-slate-700/80 bg-[#0E1223] rounded-xl p-3.5 shadow-md transition-all duration-200">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label="Toggle chain of thought reasoning steps"
        className="flex items-center justify-between cursor-pointer select-none rounded-lg p-1 -m-1 hover:bg-slate-800/40 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none transition-colors duration-150"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1 rounded-md bg-emerald-950/80 border border-emerald-700/50 text-emerald-400">
            <IconSparkles size={14} className={isStreaming ? 'animate-pulse' : ''} />
          </div>
          <span className="text-xs font-semibold text-slate-100 font-mono tracking-tight">
            {headline}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-slate-400 font-medium">
            {completedCount}/{steps.length} steps
          </span>
          {elapsedSeconds > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 text-[11px] border border-slate-700/50">
              {elapsedSeconds.toFixed(1)}s
            </span>
          )}
          <span className="text-slate-400 hover:text-slate-200 transition-colors">
            {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </span>
        </div>
      </div>

      {expanded && steps.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-800 text-xs font-mono space-y-2 text-slate-300">
          {steps.map((step) => (
            <div key={step.id} className="flex items-start gap-2.5 py-0.5">
              <div className="mt-0.5 flex-shrink-0">
                {step.status === 'completed' && (
                  <IconCheckCircle size={14} className="text-emerald-400" />
                )}
                {step.status === 'running' && (
                  <IconLoader size={14} className="text-sky-400 animate-spin" />
                )}
                {step.status === 'pending' && (
                  <IconCircleDot size={14} className="text-slate-600" />
                )}
              </div>
              <span
                className={`transition-colors duration-150 ${
                  step.status === 'running'
                    ? 'text-sky-300 font-medium'
                    : step.status === 'completed'
                    ? 'text-slate-300'
                    : 'text-slate-500'
                }`}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
