import React from 'react';
import type { Hunk, ProposedFileChange } from '../../shared/contracts';
import { IconFileCode, IconCheck, IconX, IconCornerDownLeft } from './Icons';

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
  const totalHunks = files.reduce((acc, f) => acc + f.hunks.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-semibold text-slate-200">PROPOSED CHANGES</span>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
            {files.length} file(s) &bull; {totalHunks} hunk(s)
          </span>
        </div>
        <span className="text-[11px] text-slate-400 font-mono">
          {isApplied ? 'Changes applied to workspace' : 'Review each hunk before applying'}
        </span>
      </div>

      {files.map((file) => (
        <div
          key={file.path}
          className="border border-slate-700/80 rounded-xl overflow-hidden bg-[#0E1223] text-xs shadow-md transition-all duration-200"
        >
          {/* File Header */}
          <div className="bg-slate-900/90 px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconFileCode size={15} className="text-emerald-400" />
              <span className="font-mono font-semibold text-slate-200">{file.path}</span>
            </div>
            <span className="text-slate-400 font-mono text-[11px] bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/60">
              {file.hunks.length} hunk{file.hunks.length === 1 ? '' : 's'}
            </span>
          </div>

          {/* Hunk Review List */}
          <div className="p-3.5 divide-y divide-slate-800/80">
            {file.hunks.map((hunk: Hunk, hunkIdx: number) => {
              const currentDecision = decisions.get(`${file.path}:${hunk.hunkId}`);
              return (
                <div key={hunk.hunkId} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-slate-400 text-[11px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onDecision(file.path, hunk.hunkId, 'accept')}
                        aria-label={`Accept hunk ${hunkIdx + 1} of ${file.path}`}
                        className={`cursor-pointer inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold transition-all duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none ${
                          currentDecision === 'accept'
                            ? 'bg-emerald-500 text-slate-950 shadow-sm'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                        }`}
                      >
                        <IconCheck size={12} />
                        <span>Accept</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDecision(file.path, hunk.hunkId, 'reject')}
                        aria-label={`Reject hunk ${hunkIdx + 1} of ${file.path}`}
                        className={`cursor-pointer inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold transition-all duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none ${
                          currentDecision === 'reject'
                            ? 'bg-rose-600 text-white shadow-sm'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                        }`}
                      >
                        <IconX size={12} />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>

                  {/* Diff Content Preview */}
                  <pre className="font-mono text-[12px] bg-[#020617] p-3 rounded-lg overflow-x-auto text-slate-200 whitespace-pre border border-slate-800/80 leading-relaxed">
                    {hunk.diffText.split('\n').map((line, lineIdx) => {
                      const isAdd = line.startsWith('+');
                      const isDel = line.startsWith('-');
                      return (
                        <div
                          key={lineIdx}
                          className={
                            isAdd
                              ? 'bg-emerald-950/40 text-emerald-300 px-1 -mx-1 rounded-sm'
                              : isDel
                              ? 'bg-rose-950/40 text-rose-300 px-1 -mx-1 rounded-sm'
                              : 'text-slate-400'
                          }
                        >
                          {line}
                        </div>
                      );
                    })}
                  </pre>
                </div>
              );
            })}
          </div>

          {/* Action Bar Footer */}
          <div className="bg-slate-900/80 p-3 border-t border-slate-800 flex items-center justify-between">
            <span className="text-[11px] text-slate-400 font-mono">
              Status: {isApplied ? 'Changes active in workspace' : hasAccepted ? 'Ready to apply' : 'Select hunks to accept'}
            </span>
            <div className="flex items-center gap-2.5">
              {!isApplied ? (
                <button
                  type="button"
                  onClick={onApply}
                  disabled={!hasAccepted}
                  aria-label="Apply approved code changes to workspace"
                  className="cursor-pointer inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-bold text-xs transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none active:scale-95"
                >
                  <IconCheck size={14} />
                  <span>Apply Approved Changes</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onUndo}
                  aria-label="Undo applied changes"
                  className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all duration-150 border border-slate-700 shadow-sm focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none active:scale-95"
                >
                  <IconCornerDownLeft size={13} />
                  <span>Undo Changes (Ctrl+Z)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
