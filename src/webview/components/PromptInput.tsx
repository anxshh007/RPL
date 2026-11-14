import React, { useState } from 'react';

export interface PromptInputProps {
  onSubmit: (instruction: string, mode: 'inline' | 'agent') => void;
  onCancel: () => void;
  isRunning: boolean;
}

export const PromptInput: React.FC<PromptInputProps> = ({
  onSubmit,
  onCancel,
  isRunning,
}) => {
  const [instruction, setInstruction] = useState('');
  const [mode, setMode] = useState<'inline' | 'agent'>('agent');

  const suggestions = [
    'Add flask config command with masked JSON output',
    'Update get_debug_flag in helpers.py to treat off and n as False',
    'Run pytest test_cli.py with timeout protection',
  ];

  const handleSubmit = () => {
    if (instruction.trim() && !isRunning) {
      onSubmit(instruction.trim(), mode);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs pb-1">
          <span className="text-zinc-500 text-[11px] whitespace-nowrap">Suggestions:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => setInstruction(s)}
              className="px-2.5 py-0.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 text-[11px] whitespace-nowrap transition"
            >
              + {s.slice(0, 32)}…
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded border border-zinc-700 text-[11px]">
          <button
            onClick={() => setMode('agent')}
            className={`px-2 py-0.5 rounded transition ${
              mode === 'agent' ? 'bg-sky-600 text-white font-medium' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Agent
          </button>
          <button
            onClick={() => setMode('inline')}
            className={`px-2 py-0.5 rounded transition ${
              mode === 'inline' ? 'bg-sky-600 text-white font-medium' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Inline
          </button>
        </div>
      </div>

      <div className="border border-zinc-700 focus-within:border-sky-500 rounded-lg p-2.5 bg-zinc-900 transition">
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={isRunning}
          className="w-full bg-transparent text-xs text-white placeholder-zinc-500 focus:outline-none resize-none font-sans"
          rows={2}
          placeholder="Describe code edit... Use @file:path or @symbol:name to pin context"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />

        <div className="flex items-center justify-between pt-2 border-t border-zinc-800 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setInstruction((prev) => prev + ' @file:')}
              className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 font-mono transition"
            >
              +@file
            </button>
            <button
              type="button"
              onClick={() => setInstruction((prev) => prev + ' @symbol:')}
              className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 font-mono transition"
            >
              +@symbol
            </button>
          </div>
          <div className="flex items-center gap-2">
            {isRunning ? (
              <button
                type="button"
                onClick={onCancel}
                className="px-3 py-1 rounded bg-rose-900 hover:bg-rose-800 text-rose-200 text-xs font-medium transition"
              >
                Cancel Run
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!instruction.trim()}
                className="px-3.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Run
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
