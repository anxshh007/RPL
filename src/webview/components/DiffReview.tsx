import React from 'react';
import type { Hunk, HunkDecision, ProposedFileChange } from '../../shared/contracts';

export interface DiffReviewProps {
  files: ProposedFileChange[];
  decisions: Map<string, 'accept' | 'reject'>;
  onDecision: (path: string, hunkId: string, decision: 'accept' | 'reject') => void;
  onApply: () => void;
  onUndo: () => void;
  isApplied: boolean;
}

export const DiffReview: React.FC<DiffReviewProps> = ({
  files,
  decisions,
  onDecision,
  onApply,
  onUndo,
  isApplied,
}) => {
  const hasAccepted = Array.from(decisions.values()).some((d) => d === 'accept');

  return (
    <div className="space-y-4">
      {files.map((file) => (
        <div key={file.path} className="border border-zinc-700 rounded-lg overflow-hidden bg-zinc-950 text-xs">
          <div className="bg-zinc-900 px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
            <span className="font-mono text-zinc-200">{file.path}</span>
            <span className="text-zinc-500 font-mono text-[11px]">{file.hunks.length} hunk(s)</span>
          </div>

          <div className="p-3 divide-y divide-zinc-800/80">
            {file.hunks.map((hunk: Hunk) => {
              const currentDecision = decisions.get(`${file.path}:${hunk.hunkId}`);
              return (
                <div key={hunk.hunkId} className="py-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-zinc-500 text-[11px]">
                      @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onDecision(file.path, hunk.hunkId, 'accept')}
                        className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition ${
                          currentDecision === 'accept'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                        }`}
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => onDecision(file.path, hunk.hunkId, 'reject')}
                        className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition ${
                          currentDecision === 'reject'
                            ? 'bg-rose-700 text-white'
                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                        }`}
                      >
                        Reject
                      </button>
                    </div>
                  </div>

                  <pre className="font-mono text-[12px] bg-zinc-900/60 p-2 rounded overflow-x-auto text-zinc-300 whitespace-pre">
                    {hunk.diffText}
                  </pre>
                </div>
              );
            })}
          </div>

          <div className="bg-zinc-900/60 p-2.5 border-t border-zinc-800 flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">
              {isApplied ? 'Changes applied to workspace' : 'Review each hunk before applying'}
            </span>
            <div className="flex items-center gap-2">
              {!isApplied ? (
                <button
                  onClick={onApply}
                  disabled={!hasAccepted}
                  className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Apply Approved Changes
                </button>
              ) : (
                <button
                  onClick={onUndo}
                  className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition border border-zinc-700"
                >
                  Undo Changes (Ctrl+Z)
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
