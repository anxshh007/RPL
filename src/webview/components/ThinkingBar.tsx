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
    <div
      className="border rounded-lg p-3 shadow-sm transition font-sans"
      style={{
        backgroundColor: 'var(--vscode-editor-background, #ffffff)',
        borderColor: 'var(--vscode-panel-border, #d0d7de)',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label="Toggle reasoning steps"
        className="flex items-center justify-between cursor-pointer select-none rounded p-1 -m-1 transition"
        style={{
          color: 'var(--vscode-editor-foreground, #1f2328)',
        }}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-blue-50 border border-blue-200 text-blue-600">
            <IconSparkles size={14} className={isStreaming ? 'animate-pulse' : ''} />
          </div>
          <span className="text-xs font-semibold font-mono tracking-tight text-gray-900">
            {headline}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-gray-500 font-medium">
            {completedCount}/{steps.length} steps
          </span>
          {elapsedSeconds > 0 && (
            <span
              className="px-1.5 py-0.5 rounded text-[11px] border"
              style={{
                backgroundColor: 'var(--vscode-badge-background, #eaeef2)',
                color: 'var(--vscode-badge-foreground, #24292f)',
                borderColor: 'var(--vscode-panel-border, #d0d7de)',
              }}
            >
              {elapsedSeconds.toFixed(1)}s
            </span>
          )}
          <span className="text-gray-500">
            {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </span>
        </div>
      </div>

      {expanded && steps.length > 0 && (
        <div
          className="mt-2.5 pt-2.5 border-t text-xs font-mono space-y-1.5 text-gray-700"
          style={{ borderColor: 'var(--vscode-panel-border, #d0d7de)' }}
        >
          {steps.map((step) => (
            <div key={step.id} className="flex items-start gap-2 py-0.5">
              <div className="mt-0.5 flex-shrink-0">
                {step.status === 'completed' && (
                  <IconCheckCircle size={14} className="text-emerald-600" />
                )}
                {step.status === 'running' && (
                  <IconLoader size={14} className="text-blue-600 animate-spin" />
                )}
                {step.status === 'pending' && (
                  <IconCircleDot size={14} className="text-gray-400" />
                )}
              </div>
              <span
                className={
                  step.status === 'running'
                    ? 'text-blue-700 font-semibold'
                    : step.status === 'completed'
                    ? 'text-gray-700'
                    : 'text-gray-400'
                }
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
