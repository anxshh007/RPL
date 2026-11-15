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
    <div className="space-y-2 text-xs font-sans">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload reference files"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={handleKeyDown}
        className="cursor-pointer border border-dashed rounded-lg p-3 text-center transition shadow-sm"
        style={{
          backgroundColor: 'var(--vscode-sideBar-background, #f6f8fa)',
          borderColor: 'var(--vscode-panel-border, #d0d7de)',
        }}
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
        <div className="flex flex-col items-center justify-center gap-1">
          <div className="p-1.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
            <IconUploadCloud size={16} />
          </div>
          <div className="text-gray-700 font-medium">
            <span className="text-blue-700 font-semibold">Click to upload</span> or drag and drop reference files
          </div>
          <div className="text-[11px] text-gray-500 font-mono">
            Code files (.py, .ts), diffs, specs, or UI screenshots
          </div>
        </div>
      </div>

      {uploadedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {uploadedFiles.map((file, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border font-mono text-[11px] shadow-sm"
              style={{
                backgroundColor: 'var(--vscode-editor-background, #ffffff)',
                borderColor: 'var(--vscode-panel-border, #d0d7de)',
                color: 'var(--vscode-editor-foreground, #1f2328)',
              }}
            >
              <span className="text-blue-600">
                {file.isImage ? <IconImage size={13} /> : <IconFile size={13} />}
              </span>
              <span className="max-w-[140px] truncate">{file.name}</span>
              <span className="text-gray-400 text-[10px]">({(file.size / 1024).toFixed(0)}KB)</span>
              {onRemoveFile && (
                <button
                  type="button"
                  onClick={() => onRemoveFile(idx)}
                  aria-label={`Remove ${file.name}`}
                  className="cursor-pointer text-gray-400 hover:text-red-600 transition p-0.5 rounded"
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
