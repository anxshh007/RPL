import React, { useState, useRef } from 'react';
import {
  IconZap,
  IconSearch,
  IconFlask,
  IconSliders,
  IconFile,
  IconFileCode,
  IconSparkles,
  IconX,
} from './Icons';

export interface PromptInputProps {
  onSubmit: (instruction: string, mode: 'inline' | 'agent') => void;
  onCancel: () => void;
  isRunning: boolean;
}

interface DropdownItem {
  key: string;
  label: string;
  detail: string;
  icon: React.ReactNode;
  category: 'slash' | 'mention';
}

export const PromptInput: React.FC<PromptInputProps> = ({
  onSubmit,
  onCancel,
  isRunning,
}) => {
  const [instruction, setInstruction] = useState('');
  const [mode, setMode] = useState<'inline' | 'agent'>('agent');
  const [dropdownType, setDropdownType] = useState<'slash' | 'mention' | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const slashCommands: DropdownItem[] = [
    { key: '/ponytail-review', label: '/ponytail-review', detail: 'Senior dev review of diff & tests', icon: <IconZap size={14} className="text-amber-500" />, category: 'slash' },
    { key: '/ponytail-audit', label: '/ponytail-audit', detail: 'Full repository health & risk audit', icon: <IconSearch size={14} className="text-blue-500" />, category: 'slash' },
    { key: '/verify', label: '/verify', detail: 'Run TestSheriff pytest validation suite', icon: <IconFlask size={14} className="text-purple-500" />, category: 'slash' },
    { key: '/ponytail', label: '/ponytail [lite|full|ultra]', detail: 'Set ponytail engine intensity', icon: <IconSliders size={14} className="text-indigo-500" />, category: 'slash' },
  ];

  const mentionItems: DropdownItem[] = [
    { key: '@file:src/flask/helpers.py', label: '@file:helpers.py', detail: 'src/flask/helpers.py (get_debug_flag)', icon: <IconFile size={14} className="text-blue-500" />, category: 'mention' },
    { key: '@file:src/flask/cli.py', label: '@file:cli.py', detail: 'src/flask/cli.py (CLI command group)', icon: <IconFile size={14} className="text-blue-500" />, category: 'mention' },
    { key: '@file:tests/test_cli.py', label: '@file:test_cli.py', detail: 'tests/test_cli.py (Pytest verification)', icon: <IconFlask size={14} className="text-purple-500" />, category: 'mention' },
    { key: '@symbol:get_debug_flag', label: '@symbol:get_debug_flag', detail: 'Function in helpers.py', icon: <IconFileCode size={14} className="text-emerald-500" />, category: 'mention' },
    { key: '@symbol:FlaskGroup', label: '@symbol:FlaskGroup', detail: 'Class in cli.py', icon: <IconFileCode size={14} className="text-emerald-500" />, category: 'mention' },
  ];

  const activeItems = dropdownType === 'slash' ? slashCommands : dropdownType === 'mention' ? mentionItems : [];

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInstruction(val);

    const cursorPos = e.target.selectionStart || 0;
    const textBefore = val.slice(0, cursorPos);
    const lastWord = textBefore.split(/\s+/).pop() || '';

    if (lastWord.startsWith('/')) {
      setDropdownType('slash');
      setSelectedIndex(0);
    } else if (lastWord.startsWith('@')) {
      setDropdownType('mention');
      setSelectedIndex(0);
    } else {
      setDropdownType(null);
    }
  };

  const insertItem = (item: DropdownItem) => {
    if (!textareaRef.current) return;
    const cursorPos = textareaRef.current.selectionStart || 0;
    const textBefore = instruction.slice(0, cursorPos);
    const textAfter = instruction.slice(cursorPos);
    const words = textBefore.split(/\s+/);
    words.pop();
    const newPrefix = words.length > 0 ? words.join(' ') + ' ' : '';
    const newText = `${newPrefix}${item.key} ${textAfter}`;

    setInstruction(newText);
    setDropdownType(null);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 10);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (dropdownType && activeItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % activeItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + activeItems.length) % activeItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertItem(activeItems[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setDropdownType(null);
        return;
      }
    }

    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const trimmed = instruction.trim();
    if (!trimmed || isRunning) return;
    onSubmit(trimmed, mode);
    setInstruction('');
    setDropdownType(null);
  };

  return (
    <div
      className="relative rounded-lg p-3 border shadow-sm font-sans"
      style={{
        backgroundColor: 'var(--vscode-input-background, #ffffff)',
        borderColor: 'var(--vscode-input-border, #d0d7de)',
      }}
    >
      {/* Dropdown Suggestions Popover */}
      {dropdownType && activeItems.length > 0 && (
        <div
          role="listbox"
          aria-label={dropdownType === 'slash' ? 'Slash commands' : 'Context mentions'}
          className="absolute left-2 right-2 bottom-full mb-1.5 rounded-lg border shadow-xl overflow-hidden z-30 max-h-52 overflow-y-auto divide-y font-sans"
          style={{
            backgroundColor: 'var(--vscode-editor-background, #ffffff)',
            borderColor: 'var(--vscode-panel-border, #d0d7de)',
          }}
        >
          <div
            className="px-3 py-1.5 text-[10px] font-mono flex items-center justify-between"
            style={{
              backgroundColor: 'var(--vscode-sideBar-background, #f6f8fa)',
              color: 'var(--vscode-descriptionForeground, #57606a)',
            }}
          >
            <span>{dropdownType === 'slash' ? 'SLASH COMMANDS & SKILLS' : 'FILE & SYMBOL CONTEXT (@)'}</span>
            <span>↑↓ navigate &bull; Enter select</span>
          </div>
          {activeItems.map((item, idx) => (
            <div
              key={item.key}
              role="option"
              aria-selected={idx === selectedIndex}
              onClick={() => insertItem(item)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className="cursor-pointer px-3 py-2 flex items-center justify-between text-xs transition"
              style={{
                backgroundColor: idx === selectedIndex ? 'var(--vscode-list-hoverBackground, #f3f4f6)' : 'transparent',
              }}
            >
              <div className="flex items-center gap-2">
                <span className="p-1 rounded bg-gray-100 border border-gray-200">{item.icon}</span>
                <span className="font-mono font-semibold text-blue-700">{item.label}</span>
              </div>
              <span className="text-[11px] text-gray-500 font-mono">{item.detail}</span>
            </div>
          ))}
        </div>
      )}

      {/* Main Text Area */}
      <textarea
        ref={textareaRef}
        rows={3}
        value={instruction}
        onChange={handleTextChange}
        onKeyDown={handleKeyDown}
        placeholder="Type instruction, / for skills (/verify, /ponytail-review), @ for files..."
        aria-label="Agent instruction prompt"
        className="w-full bg-transparent text-xs font-mono outline-none resize-none leading-relaxed"
        style={{
          color: 'var(--vscode-input-foreground, #1f2328)',
        }}
      />

      {/* Footer Controls & Mode Selector */}
      <div
        className="mt-2 pt-2 border-t flex items-center justify-between text-xs"
        style={{ borderColor: 'var(--vscode-panel-border, #d0d7de)' }}
      >
        {/* Quick Helper Chips */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setInstruction((prev) => (prev ? prev + ' /' : '/'));
              setDropdownType('slash');
              textareaRef.current?.focus();
            }}
            aria-label="Insert slash command trigger"
            className="cursor-pointer px-2 py-0.5 rounded text-[11px] font-mono border transition active:scale-95"
            style={{
              backgroundColor: 'var(--vscode-button-secondaryBackground, #eaeef2)',
              color: 'var(--vscode-button-secondaryForeground, #24292f)',
              borderColor: 'var(--vscode-panel-border, #d0d7de)',
            }}
          >
            / skills
          </button>
          <button
            type="button"
            onClick={() => {
              setInstruction((prev) => (prev ? prev + ' @' : '@'));
              setDropdownType('mention');
              textareaRef.current?.focus();
            }}
            aria-label="Insert context mention trigger"
            className="cursor-pointer px-2 py-0.5 rounded text-[11px] font-mono border transition active:scale-95"
            style={{
              backgroundColor: 'var(--vscode-button-secondaryBackground, #eaeef2)',
              color: 'var(--vscode-button-secondaryForeground, #24292f)',
              borderColor: 'var(--vscode-panel-border, #d0d7de)',
            }}
          >
            @ context
          </button>

          <div className="h-3.5 w-px bg-gray-300 mx-1" />

          {/* Mode Switcher */}
          <div className="inline-flex rounded border p-0.5 text-[10px] font-mono" style={{ borderColor: 'var(--vscode-panel-border, #d0d7de)' }}>
            <button
              type="button"
              onClick={() => setMode('agent')}
              aria-label="Agent Loop Mode"
              className={`cursor-pointer px-2 py-0.5 rounded transition ${
                mode === 'agent'
                  ? 'bg-blue-600 text-white font-bold shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Agent Loop
            </button>
            <button
              type="button"
              onClick={() => setMode('inline')}
              aria-label="Inline Diff Mode"
              className={`cursor-pointer px-2 py-0.5 rounded transition ${
                mode === 'inline'
                  ? 'bg-blue-600 text-white font-bold shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Inline Diff
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {isRunning ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel running agent execution"
              className="cursor-pointer inline-flex items-center gap-1 px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-semibold text-xs transition active:scale-95 shadow-sm"
            >
              <IconX size={12} />
              <span>Cancel</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!instruction.trim()}
              aria-label="Send instruction"
              className="cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-1 rounded font-bold text-xs transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm active:scale-95"
              style={{
                backgroundColor: 'var(--vscode-button-background, #0969da)',
                color: 'var(--vscode-button-foreground, #ffffff)',
              }}
            >
              <IconSparkles size={13} />
              <span>Send</span>
              <span className="text-[10px] font-normal opacity-80 font-mono">(Ctrl+↵)</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
