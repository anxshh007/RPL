import React, { useState, useRef } from 'react';
import {
  IconZap,
  IconSearch,
  IconFlask,
  IconGitBranch,
  IconSliders,
  IconFile,
  IconFileCode,
  IconCornerDownLeft,
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
    { key: '/ponytail-review', label: '/ponytail-review', detail: 'Senior dev review of diff & tests', icon: <IconZap size={14} className="text-amber-400" />, category: 'slash' },
    { key: '/ponytail-audit', label: '/ponytail-audit', detail: 'Full repository health & risk audit', icon: <IconSearch size={14} className="text-sky-400" />, category: 'slash' },
    { key: '/verify', label: '/verify', detail: 'Run TestSheriff pytest validation suite', icon: <IconFlask size={14} className="text-purple-400" />, category: 'slash' },
    { key: '/impact', label: '/impact', detail: 'Run ImpactLens DAG analysis on current file', icon: <IconGitBranch size={14} className="text-emerald-400" />, category: 'slash' },
    { key: '/ponytail', label: '/ponytail [lite|full|ultra]', detail: 'Set ponytail engine intensity', icon: <IconSliders size={14} className="text-indigo-400" />, category: 'slash' },
  ];

  const mentionItems: DropdownItem[] = [
    { key: '@file:src/flask/helpers.py', label: '@file:helpers.py', detail: 'src/flask/helpers.py (get_debug_flag)', icon: <IconFile size={14} className="text-sky-400" />, category: 'mention' },
    { key: '@file:src/flask/cli.py', label: '@file:cli.py', detail: 'src/flask/cli.py (CLI command group)', icon: <IconFile size={14} className="text-sky-400" />, category: 'mention' },
    { key: '@file:tests/test_cli.py', label: '@file:test_cli.py', detail: 'tests/test_cli.py (Pytest verification)', icon: <IconFlask size={14} className="text-purple-400" />, category: 'mention' },
    { key: '@symbol:get_debug_flag', label: '@symbol:get_debug_flag', detail: 'Function in helpers.py', icon: <IconFileCode size={14} className="text-emerald-400" />, category: 'mention' },
    { key: '@symbol:FlaskGroup', label: '@symbol:FlaskGroup', detail: 'Class in cli.py', icon: <IconFileCode size={14} className="text-emerald-400" />, category: 'mention' },
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
    words.pop(); // remove partial trigger
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
    <div className="relative border border-slate-700/80 bg-[#0E1223] rounded-xl p-3 shadow-lg focus-within:border-emerald-500/80 focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all duration-200">
      {/* Dropdown Suggestions Popover */}
      {dropdownType && activeItems.length > 0 && (
        <div
          role="listbox"
          aria-label={dropdownType === 'slash' ? 'Slash commands' : 'Context mentions'}
          className="absolute left-3 right-3 bottom-full mb-2 bg-[#0E1223] border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-30 max-h-56 overflow-y-auto divide-y divide-slate-800/80 backdrop-blur-md"
        >
          <div className="px-3 py-1.5 bg-slate-900/90 text-[10px] font-mono text-slate-400 flex items-center justify-between">
            <span>{dropdownType === 'slash' ? 'SLASH COMMANDS & SKILLS' : 'FILE & SYMBOL CONTEXT (@)'}</span>
            <span className="text-slate-500">↑↓ to navigate &bull; Enter to select</span>
          </div>
          {activeItems.map((item, idx) => (
            <div
              key={item.key}
              role="option"
              aria-selected={idx === selectedIndex}
              onClick={() => insertItem(item)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`cursor-pointer px-3 py-2 flex items-center justify-between text-xs transition-colors duration-150 ${
                idx === selectedIndex ? 'bg-slate-800/90 text-white' : 'text-slate-300 hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="p-1 rounded bg-slate-900 border border-slate-800">{item.icon}</span>
                <span className="font-mono font-medium text-emerald-400">{item.label}</span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">{item.detail}</span>
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
        placeholder="Type instruction, / for skills (/verify, /impact, /ponytail), @ for files..."
        aria-label="Agent instruction prompt"
        className="w-full bg-transparent text-slate-100 placeholder-slate-500 text-xs font-mono outline-none resize-none leading-relaxed"
      />

      {/* Footer Controls & Mode Selector */}
      <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
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
            className="cursor-pointer px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-mono border border-slate-700/60 transition-colors duration-150 active:scale-95"
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
            className="cursor-pointer px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-mono border border-slate-700/60 transition-colors duration-150 active:scale-95"
          >
            @ context
          </button>

          <div className="h-3.5 w-px bg-slate-700/80 mx-1" />

          {/* Mode Switcher */}
          <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800 text-[10px] font-mono">
            <button
              type="button"
              onClick={() => setMode('agent')}
              aria-label="Switch to full agent loop mode"
              className={`cursor-pointer px-2 py-0.5 rounded-md transition-all duration-150 ${
                mode === 'agent'
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Agent Loop
            </button>
            <button
              type="button"
              onClick={() => setMode('inline')}
              aria-label="Switch to inline diff mode"
              className={`cursor-pointer px-2 py-0.5 rounded-md transition-all duration-150 ${
                mode === 'inline'
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
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
              className="cursor-pointer inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-rose-600/90 hover:bg-rose-500 text-white font-semibold text-xs transition-all duration-150 active:scale-95"
            >
              <IconX size={12} />
              <span>Cancel</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!instruction.trim()}
              aria-label="Send instruction (Ctrl+Enter)"
              className="cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-bold text-xs transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none active:scale-95"
            >
              <IconSparkles size={13} />
              <span>Send</span>
              <span className="text-[10px] font-normal text-slate-900/80 font-mono">(Ctrl+↵)</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
