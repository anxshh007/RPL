import React, { useRef } from 'react';
import { IconUploadCloud, IconFile, IconImage, IconX } from './Icons';

export interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
  acceptedTypes?: string;
  uploadedFiles?: Array<{ name: string; size: number; isImage?: boolean }>;
  onRemoveFile?: (index: number) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onFilesSelected,
  acceptedTypes = '.ts,.tsx,.py,.js,.jsx,.json,.md,.png,.jpg,.jpeg',
  uploadedFiles = [],
  onRemoveFile,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesSelected(Array.from(e.dataTransfer.files));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  return (
    <div className="space-y-2 text-xs">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload reference files or screenshots"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={handleKeyDown}
        className="cursor-pointer border border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-4 text-center bg-[#0E1223] hover:bg-slate-900/60 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none shadow-sm"
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptedTypes}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              onFilesSelected(Array.from(e.target.files));
            }
          }}
        />
        <div className="flex flex-col items-center justify-center gap-1.5">
          <div className="p-2 rounded-full bg-slate-800 text-emerald-400 border border-slate-700/60">
            <IconUploadCloud size={18} />
          </div>
          <div className="text-slate-300 font-medium">
            <span className="text-emerald-400 font-semibold">Click to upload</span> or drag and drop reference files
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Code files (.py, .ts), diffs, specs, or UI screenshots
          </div>
        </div>
      </div>

      {uploadedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {uploadedFiles.map((file, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#0E1223] border border-slate-700 text-slate-200 font-mono text-[11px] shadow-sm"
            >
              <span className="text-emerald-400">
                {file.isImage ? <IconImage size={13} /> : <IconFile size={13} />}
              </span>
              <span className="max-w-[140px] truncate">{file.name}</span>
              <span className="text-slate-500 text-[10px]">({(file.size / 1024).toFixed(0)}KB)</span>
              {onRemoveFile && (
                <button
                  type="button"
                  onClick={() => onRemoveFile(idx)}
                  aria-label={`Remove ${file.name}`}
                  className="cursor-pointer text-slate-500 hover:text-rose-400 transition-colors p-0.5 rounded focus-visible:ring-1 focus-visible:ring-rose-400 focus-visible:outline-none"
                >
                  <IconX size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
