import React, { useState } from 'react';
import { IconThumbsUp, IconThumbsDown, IconCopy, IconCheck } from './Icons';

export interface FeedbackBarProps {
  onCopy?: () => void;
  onFeedback?: (type: 'positive' | 'negative') => void;
}

export const FeedbackBar: React.FC<FeedbackBarProps> = ({ onCopy, onFeedback }) => {
  const [copied, setCopied] = useState(false);
  const [voted, setVoted] = useState<'positive' | 'negative' | null>(null);

  const handleCopy = () => {
    onCopy?.();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleVote = (type: 'positive' | 'negative') => {
    setVoted(type);
    onFeedback?.(type);
  };

  return (
    <div
      className="mt-3 pt-2.5 border-t flex items-center justify-between text-xs font-sans"
      style={{
        borderColor: 'var(--vscode-panel-border, #d0d7de)',
        color: 'var(--vscode-descriptionForeground, #57606a)',
      }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => handleVote('positive')}
          aria-label="Helpful"
          aria-pressed={voted === 'positive'}
          className={`cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded transition border active:scale-95 ${
            voted === 'positive'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 font-semibold'
              : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'
          }`}
        >
          <IconThumbsUp size={13} />
          <span>Helpful</span>
        </button>

        <button
          type="button"
          onClick={() => handleVote('negative')}
          aria-label="Unhelpful"
          aria-pressed={voted === 'negative'}
          className={`cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded transition border active:scale-95 ${
            voted === 'negative'
              ? 'bg-red-50 text-red-700 border-red-300 font-semibold'
              : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'
          }`}
        >
          <IconThumbsDown size={13} />
          <span>Unhelpful</span>
        </button>

        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy diff"
          className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-gray-50 hover:bg-gray-100 text-gray-700 transition border border-gray-200 active:scale-95"
        >
          {copied ? <IconCheck size={13} className="text-emerald-600" /> : <IconCopy size={13} />}
          <span>{copied ? 'Copied!' : 'Copy Diff'}</span>
        </button>
      </div>

      <div className="text-[11px] font-mono flex items-center gap-1.5 text-gray-500">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
        <span>TrueForge &bull; MCP Standard</span>
      </div>
    </div>
  );
};
