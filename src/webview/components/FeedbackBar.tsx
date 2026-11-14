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
    <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => handleVote('positive')}
          aria-label="Vote helpful"
          aria-pressed={voted === 'positive'}
          className={`cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none ${
            voted === 'positive'
              ? 'bg-emerald-950/80 border border-emerald-700/60 text-emerald-400 font-semibold'
              : 'hover:bg-slate-800 hover:text-slate-200 text-slate-400'
          }`}
        >
          <IconThumbsUp size={13} />
          <span>Helpful</span>
        </button>

        <button
          type="button"
          onClick={() => handleVote('negative')}
          aria-label="Vote unhelpful"
          aria-pressed={voted === 'negative'}
          className={`cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none ${
            voted === 'negative'
              ? 'bg-rose-950/80 border border-rose-700/60 text-rose-400 font-semibold'
              : 'hover:bg-slate-800 hover:text-slate-200 text-slate-400'
          }`}
        >
          <IconThumbsDown size={13} />
          <span>Unhelpful</span>
        </button>

        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy diff to clipboard"
          className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-slate-800 hover:text-slate-200 text-slate-300 transition-all duration-150 active:scale-95 border border-slate-700/60 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
        >
          {copied ? <IconCheck size={13} className="text-emerald-400" /> : <IconCopy size={13} />}
          <span>{copied ? 'Copied to Clipboard!' : 'Copy Diff'}</span>
        </button>
      </div>

      <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        <span>TrueForge Engine &bull; MCP Standard</span>
      </div>
    </div>
  );
};
