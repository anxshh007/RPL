import React from 'react';
import type { Hunk, ProposedFileChange } from '../../shared/contracts';
import { IconFileCode, IconCheck, IconX, IconCornerDownLeft } from './Icons';

export const DECISION_KEY_SEPARATOR = '\u0000';

export function makeDecisionKey(path: string, hunkId: string): string {
  return `${path}${DECISION_KEY_SEPARATOR}${hunkId}`;
}

export function parseDecisionKey(key: string): { path: string; hunkId: string } {
  const [path, hunkId] = key.split(DECISION_KEY_SEPARATOR);
  return { path, hunkId };
}

export interface DiffReviewProps {
  files: ProposedFileChange[];
  decisions: Map<string, 'accept' | 'reject'>;
  onDecision: (path: string, hunkId: string, decision: 'accept' | 'reject') => void;
  onApply: () => void;
  onUndo: () => void;
  isApplied: boolean;
  /** Opens VS Code's side-by-side diff (current file vs proposed content) for one file. */
  onOpenDiff?: (path: string) => void;
}

export const DiffReview: React.FC<DiffReviewProps> = ({
  files,
  decisions,
  onDecision,
  onApply,
  onUndo,
  isApplied,
  onOpenDiff,
}) => {
  const hasAccepted = Array.from(decisions.values()).some((d) => d === 'accept');
  const totalHunks = files.reduce((acc, f) => acc + f.hunks.length, 0);

  return (
    <div className="space-y-3 font-sans">
      <div className="flex items-center justify-between px-1 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold" style={{ color: 'var(--vscode-editor-foreground, #1f2328)' }}>
            PROPOSED CHANGES
          </span>
          <span
            className="px-2 py-0.5 rounded-full font-mono text-[11px] border"
            style={{
              backgroundColor: 'var(--vscode-sideBar-background, #f6f8fa)',
              borderColor: 'var(--vscode-panel-border, #d0d7de)',
              color: 'var(--vscode-descriptionForeground, #57606a)',
            }}
          >
            {files.length} file(s) &bull; {totalHunks} hunk(s)
          </span>
        </div>
        <span className="font-mono text-[11px]" style={{ color: 'var(--vscode-descriptionForeground, #57606a)' }}>
          {isApplied ? 'Changes applied to workspace' : 'Review each hunk before applying'}
        </span>
      </div>

      {files.map((file) => (
        <div
          key={file.path}
          className="rounded-lg overflow-hidden border text-xs shadow-sm"
          style={{
            backgroundColor: 'var(--vscode-editor-background, #ffffff)',
            borderColor: 'var(--vscode-panel-border, #d0d7de)',
          }}
        >
          {/* File Header */}
          <div
            className="px-3.5 py-2 border-b flex items-center justify-between"
            style={{
              backgroundColor: 'var(--vscode-sideBar-background, #f6f8fa)',
              borderColor: 'var(--vscode-panel-border, #d0d7de)',
            }}
          >
            <div className="flex items-center gap-2">
              <IconFileCode size={15} className="text-blue-600" />
              <span className="font-mono font-semibold" style={{ color: 'var(--vscode-editor-foreground, #1f2328)' }}>
                {file.path}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {onOpenDiff && (
                <button
                  type="button"
                  onClick={() => onOpenDiff(file.path)}
                  aria-label={`Open ${file.path} in the VS Code diff view`}
                  className="cursor-pointer px-2 py-0.5 rounded text-[11px] font-mono border transition active:scale-95"
                  style={{
                    backgroundColor: 'var(--vscode-button-secondaryBackground, #eaeef2)',
                    color: 'var(--vscode-button-secondaryForeground, #24292f)',
                    borderColor: 'var(--vscode-panel-border, #d0d7de)',
                  }}
                >
                  Open diff
                </button>
              )}
              <span
                className="font-mono text-[11px] px-2 py-0.5 rounded border"
                style={{
                  backgroundColor: 'var(--vscode-editor-background, #ffffff)',
                  borderColor: 'var(--vscode-panel-border, #d0d7de)',
                  color: 'var(--vscode-descriptionForeground, #57606a)',
                }}
              >
                {file.hunks.length} hunk{file.hunks.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          {/* Hunk Review List */}
          <div className="p-3 divide-y" style={{ borderColor: 'var(--vscode-panel-border, #d0d7de)' }}>
            {file.hunks.map((hunk: Hunk, hunkIdx: number) => {
              const currentDecision = decisions.get(makeDecisionKey(file.path, hunk.hunkId));
              return (
                <div key={hunk.hunkId} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className="font-mono text-[11px] px-2 py-0.5 rounded border"
                      style={{
                        backgroundColor: 'var(--vscode-textCodeBlock-background, #f6f8fa)',
                        borderColor: 'var(--vscode-panel-border, #d0d7de)',
                        color: 'var(--vscode-descriptionForeground, #57606a)',
                      }}
                    >
                      @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onDecision(file.path, hunk.hunkId, 'accept')}
                        aria-label={`Accept hunk ${hunkIdx + 1} of ${file.path}`}
                        className={`cursor-pointer inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold transition active:scale-95 ${
                          currentDecision === 'accept'
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300'
                        }`}
                      >
                        <IconCheck size={12} />
                        <span>Accept</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDecision(file.path, hunk.hunkId, 'reject')}
                        aria-label={`Reject hunk ${hunkIdx + 1} of ${file.path}`}
                        className={`cursor-pointer inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold transition active:scale-95 ${
                          currentDecision === 'reject'
                            ? 'bg-red-600 text-white shadow-sm'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300'
                        }`}
                      >
                        <IconX size={12} />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>

                  {/* Diff Content Preview */}
                  <pre
                    className="font-mono text-[12px] p-2.5 rounded overflow-x-auto whitespace-pre border leading-relaxed"
                    style={{
                      backgroundColor: 'var(--vscode-textCodeBlock-background, #f6f8fa)',
                      borderColor: 'var(--vscode-panel-border, #d0d7de)',
                      color: 'var(--vscode-editor-foreground, #1f2328)',
                    }}
                  >
                    {hunk.diffText.split('\n').map((line, lineIdx) => {
                      const isAdd = line.startsWith('+');
                      const isDel = line.startsWith('-');
                      return (
                        <div
                          key={lineIdx}
                          style={{
                            backgroundColor: isAdd ? 'var(--rp-diff-add-bg, rgba(46, 160, 67, 0.15))' : isDel ? 'var(--rp-diff-del-bg, rgba(248, 81, 73, 0.15))' : 'transparent',
                            color: isAdd ? 'var(--rp-diff-add-text, #1a7f37)' : isDel ? 'var(--rp-diff-del-text, #cf222e)' : 'inherit',
                          }}
                          className="px-1 -mx-1 rounded-sm"
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
          <div
            className="p-3 border-t flex items-center justify-between"
            style={{
              backgroundColor: 'var(--vscode-sideBar-background, #f6f8fa)',
              borderColor: 'var(--vscode-panel-border, #d0d7de)',
            }}
          >
            <span className="text-[11px] font-mono" style={{ color: 'var(--vscode-descriptionForeground, #57606a)' }}>
              Status: {isApplied ? 'Changes applied to workspace' : hasAccepted ? 'Ready to apply' : 'Select hunks to accept'}
            </span>
            <div className="flex items-center gap-2">
              {!isApplied ? (
                <button
                  type="button"
                  onClick={onApply}
                  disabled={!hasAccepted}
                  aria-label="Apply approved code changes"
                  className="cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md font-semibold text-xs transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm active:scale-95"
                  style={{
                    backgroundColor: 'var(--vscode-button-background, #0969da)',
                    color: 'var(--vscode-button-foreground, #ffffff)',
                  }}
                >
                  <IconCheck size={14} />
                  <span>Apply Approved Changes</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onUndo}
                  aria-label="Undo applied changes"
                  className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold text-xs transition border shadow-sm active:scale-95"
                  style={{
                    backgroundColor: 'var(--vscode-button-secondaryBackground, #eaeef2)',
                    color: 'var(--vscode-button-secondaryForeground, #24292f)',
                    borderColor: 'var(--vscode-panel-border, #d0d7de)',
                  }}
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
