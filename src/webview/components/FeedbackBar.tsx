import React, { useState } from 'react';

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
    <div className="mt-4 pt-3 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
      <div className="flex items-center gap-3">
        <button
          onClick={() => handleVote('positive')}
          className={`hover:text-white flex items-center gap-1 transition ${
            voted === 'positive' ? 'text-emerald-400 font-semibold' : ''
          }`}
        >
          👍 Helpful
        </button>
        <button
          onClick={() => handleVote('negative')}
          className={`hover:text-white flex items-center gap-1 transition ${
            voted === 'negative' ? 'text-rose-400 font-semibold' : ''
          }`}
        >
          👎 Unhelpful
        </button>
        <button
          onClick={handleCopy}
          className="hover:text-white flex items-center gap-1 transition text-zinc-300"
        >
          📋 {copied ? 'Copied!' : 'Copy Diff'}
        </button>
      </div>
      <div className="text-[11px] text-zinc-500 font-mono">TrueForge Loop &bull; MCP Standard</div>
    </div>
  );
};
