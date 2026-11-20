import React, { useMemo, useState, useEffect } from 'react';
import { useExtensionBridge } from './hooks/useExtensionBridge';
import {
  ThinkingBar,
  ThinkingStep,
  ToolBlock,
  DiffReview,
  makeDecisionKey,
  parseDecisionKey,
  PromptInput,
  VerificationPanel,
  FeedbackBar,
  ImpactPanel,
  IconSparkles,
  IconX,
} from './components';
import type { ChangePlan, ImpactReport, VerificationReport, RepoPilotEvent, RepositoryContext } from '../shared/contracts';
import { isPlanApplied } from './state/bridgeState';
import { getStatusBadge, isAgentRunning } from './state/agentStatus';
import { deriveThinkingSteps } from './state/thinkingSteps';

export interface ChatMessage {
  id: string;
  text: string;
  time: string;
}

function renderMessageText(text: string) {
  const parts = text.split(/(@file:[^\s]+|@symbol:[^\s]+|\/[a-zA-Z0-9_-]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@file:')) {
      return (
        <span
          key={i}
          className="inline-block px-1.5 py-0.5 rounded text-[11px] font-mono border"
          style={{
            backgroundColor: 'rgba(56, 139, 253, 0.15)',
            borderColor: 'var(--rp-risk-low-border, #388bfd)',
            color: 'var(--rp-risk-low-text, #79c0ff)',
          }}
        >
          {part}
        </span>
      );
    }
    if (part.startsWith('@symbol:')) {
      return (
        <span
          key={i}
          className="inline-block px-1.5 py-0.5 rounded text-[11px] font-mono border"
          style={{
            backgroundColor: 'rgba(46, 160, 67, 0.15)',
            borderColor: 'var(--rp-conf-high-text, #2ea043)',
            color: 'var(--rp-conf-high-text, #56d364)',
          }}
        >
          {part}
        </span>
      );
    }
    if (part.startsWith('/')) {
      return (
        <span
          key={i}
          className="inline-block px-1.5 py-0.5 rounded text-[11px] font-mono border font-semibold"
          style={{
            backgroundColor: 'rgba(187, 128, 9, 0.15)',
            borderColor: 'var(--rp-risk-medium-border, #bb8009)',
            color: 'var(--rp-risk-medium-text, #e3b341)',
          }}
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export const AVAILABLE_MODELS = [
  { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B', desc: 'Google Gemma 4' },
  { id: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron 3.5 Lightning', desc: 'NVIDIA Fast & Robust' },
  { id: 'nvidia/nemotron-3.5-super-vl:free', label: 'Nemotron 3.5 Super VL', desc: 'NVIDIA Multimodal' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra 550B', desc: 'NVIDIA 550B Reasoning' },
  { id: 'openrouter/auto', label: 'OpenRouter Auto', desc: 'Auto best available' },
];

export const App: React.FC = () => {
  const { state, submitInstruction, cancelRequest, applyHunks, undoHunks, openDiff, changeModel } = useExtensionBridge();
  const {
    workspace,
    events,
    activeRequestId,
    runningRequestId,
    agentState,
    errorMessage,
    warnings,
    streamingDelta,
    lastApplyResult,
    lastUndoResult,
    verificationTests,
    activeModel,
  } = state;

  const [decisions, setDecisions] = useState<Map<string, 'accept' | 'reject'>>(new Map());
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [currentModel, setCurrentModel] = useState(activeModel || 'google/gemma-4-26b-a4b-it:free');

  // Derive latest change plan, impact report, and verification report from event stream
  const changePlan = useMemo<ChangePlan | undefined>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'change.proposed') return e.plan;
    }
    return undefined;
  }, [events]);

  // Clear hunk decisions whenever a new change plan is proposed (review item 8a)
  useEffect(() => {
    setDecisions(new Map());
  }, [changePlan]);

  const impactReport = useMemo<ImpactReport | undefined>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'impact.ready') return e.report;
    }
    return undefined;
  }, [events]);

  const repositoryContext = useMemo<RepositoryContext | undefined>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'context.ready') return e.context;
    }
    return undefined;
  }, [events]);

  const verificationReport = useMemo<VerificationReport | undefined>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'verification.completed') return e.report;
    }
    return undefined;
  }, [events]);

  // Strictly typed tool events (review item 8b: no (t as any))
  const toolEvents = useMemo(() => {
    return events.filter((e): e is Extract<RepoPilotEvent, { type: 'agent.tool' }> => e.type === 'agent.tool');
  }, [events]);

  // Earlier steps are finished; only the latest one spins, and only while the agent works.
  const thinkingSteps: ThinkingStep[] = useMemo(() => deriveThinkingSteps(events), [events]);

  // Application state derived from host events; reset for every new request
  const isApplied = isPlanApplied(state);

  const handleDecision = (path: string, hunkId: string, decision: 'accept' | 'reject') => {
    setDecisions((prev) => {
      const next = new Map(prev);
      next.set(makeDecisionKey(path, hunkId), decision);
      return next;
    });
  };

  const handleApply = () => {
    const reqId = activeRequestId || changePlan?.requestId;
    if (!reqId) return;
    const decisionList = Array.from(decisions.entries()).map(([key, decision]) => {
      const { path, hunkId } = parseDecisionKey(key);
      return { path, hunkId, decision };
    });
    // Send decisions to host; isApplied updates upon receiving change.applied event
    applyHunks(reqId, decisionList);
  };

  const handleUndo = () => {
    const reqId = activeRequestId || changePlan?.requestId;
    if (!reqId) return;
    // Send undo request to host; isApplied updates upon receiving change.undone event
    undoHunks(reqId);
  };

  const isRunning = isAgentRunning(agentState);

  const handleOpenDiff = (path: string) => {
    const reqId = activeRequestId || changePlan?.requestId;
    if (reqId) openDiff(reqId, path);
  };

  const statusColors = getStatusBadge(agentState);

  return (
    <div
      className="min-h-screen font-sans p-3 sm:p-5"
      style={{
        backgroundColor: 'var(--vscode-editor-background, #ffffff)',
        color: 'var(--vscode-editor-foreground, #1f2328)',
      }}
    >
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Header Bar */}
        <header
          className="flex items-center justify-between pb-3 border-b"
          style={{ borderColor: 'var(--vscode-panel-border, #d0d7de)' }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shadow-md"
              style={{
                backgroundColor: 'var(--vscode-editor-foreground, #1f2328)',
                color: 'var(--vscode-editor-background, #ffffff)',
              }}
            >
              RP
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold tracking-wide">
                  RepoPilot AI
                </h1>
                <div className="relative inline-block">
                  <button
                    type="button"
                    onClick={() => setShowModelMenu((v) => !v)}
                    className="cursor-pointer text-[10px] px-2 py-0.5 rounded-full font-mono border flex items-center gap-1 transition hover:opacity-80"
                    style={{
                      backgroundColor: 'rgba(56, 139, 253, 0.15)',
                      color: 'var(--rp-risk-low-text, #0969da)',
                      borderColor: 'var(--rp-risk-low-border, #54aeff)',
                    }}
                    title="Click to switch LLM model"
                  >
                    <span>{AVAILABLE_MODELS.find((m) => m.id === currentModel)?.label || currentModel}</span>
                    <span className="text-[9px]">▾</span>
                  </button>

                  {showModelMenu && (
                    <div
                      className="absolute left-0 mt-1.5 w-64 rounded-lg border shadow-xl z-50 p-1 font-mono text-xs"
                      style={{
                        backgroundColor: 'var(--vscode-sideBar-background, #18181b)',
                        borderColor: 'var(--vscode-panel-border, #27272a)',
                        color: 'var(--vscode-editor-foreground, #fafafa)',
                      }}
                    >
                      <div className="px-2 py-1 text-[10px] opacity-75 font-semibold border-b mb-1" style={{ borderColor: 'var(--vscode-panel-border, #27272a)' }}>
                        SWITCH LLM MODEL
                      </div>
                      {AVAILABLE_MODELS.map((m) => (
                        <div
                          key={m.id}
                          onClick={() => {
                            setCurrentModel(m.id);
                            setShowModelMenu(false);
                            changeModel(m.id);
                          }}
                          className="cursor-pointer px-2 py-1.5 rounded flex items-center justify-between text-xs transition hover:bg-gray-100"
                          style={{
                            backgroundColor: currentModel === m.id ? 'rgba(56, 139, 253, 0.2)' : 'transparent',
                          }}
                        >
                          <div>
                            <div className="font-semibold">{m.label}</div>
                            <div className="text-[10px] opacity-70 font-sans">{m.desc}</div>
                          </div>
                          {currentModel === m.id && <span className="text-blue-500 font-bold">✓</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <span
                  className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border"
                  style={{
                    backgroundColor: statusColors.bg,
                    color: statusColors.text,
                    borderColor: statusColors.border,
                  }}
                >
                  {agentState}
                </span>
              </div>
              <p className="text-[11px] font-mono opacity-80">
                {workspace.available ? (
                  <span>workspace: <span className="font-semibold">{workspace.name}</span></span>
                ) : (
                  'No workspace opened'
                )}
                {' • Autonomous Coding Agent • Antigravity Surface'}
              </p>
            </div>
          </div>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setHistory([])}
              className="px-2.5 py-1 rounded text-[11px] font-mono border transition hover:opacity-80"
              style={{
                backgroundColor: 'var(--vscode-button-secondaryBackground, #eaeef2)',
                color: 'var(--vscode-button-secondaryForeground, #24292f)',
                borderColor: 'var(--vscode-panel-border, #d0d7de)',
              }}
            >
              Clear Chat
            </button>
          )}
        </header>

        {/* Welcome / System Info Banner */}
        {history.length === 0 && (
          <div
            className="rounded-xl border p-4 space-y-2 text-xs"
            style={{
              backgroundColor: 'var(--vscode-sideBar-background, rgba(255, 255, 255, 0.03))',
              borderColor: 'var(--vscode-panel-border, #d0d7de)',
            }}
          >
            <div className="flex items-center gap-2 font-semibold">
              <IconSparkles size={14} className="text-amber-500" />
              <span>RepoPilot AI is ready.</span>
            </div>
            <p className="leading-relaxed opacity-90">
              Ask me to inspect files, refactor functions, run tests, or propose hunk-level diffs with ImpactLens analysis.
              Powered by <strong>google/gemma-4-26b-a4b-it:free</strong> via OpenRouter.
            </p>
            <div className="pt-1 flex flex-wrap gap-2 text-[11px] font-mono">
              <span
                className="px-2 py-0.5 rounded border"
                style={{
                  backgroundColor: 'var(--vscode-input-background, #ffffff)',
                  borderColor: 'var(--vscode-panel-border, #d0d7de)',
                }}
              >
                Type <strong>/</strong> for skills
              </span>
              <span
                className="px-2 py-0.5 rounded border"
                style={{
                  backgroundColor: 'var(--vscode-input-background, #ffffff)',
                  borderColor: 'var(--vscode-panel-border, #d0d7de)',
                }}
              >
                Type <strong>@</strong> for files &amp; symbols
              </span>
            </div>
          </div>
        )}

        {/* User Conversation Messages */}
        {history.map((msg) => (
          <div key={msg.id} className="flex justify-end">
            <div
              className="max-w-[85%] rounded-2xl p-3 text-xs shadow-sm space-y-1 font-sans border"
              style={{
                backgroundColor: 'var(--vscode-sideBar-background, #f6f8fa)',
                borderColor: 'var(--vscode-panel-border, #d0d7de)',
                color: 'var(--vscode-editor-foreground, #1f2328)',
              }}
            >
              <div className="flex items-center justify-between text-[10px] font-mono mb-1 opacity-75">
                <span className="font-semibold text-blue-600">You</span>
                <span>{msg.time}</span>
              </div>
              <div className="whitespace-pre-wrap leading-relaxed">
                {renderMessageText(msg.text)}
              </div>
            </div>
          </div>
        ))}

        {/* Error Alert (Host error or agent.error) */}
        {errorMessage && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2 font-mono shadow-sm">
            <IconX size={14} className="text-red-600 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Warnings for this request (agent.warning), all of them, in order */}
        {warnings.length > 0 && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-mono shadow-sm space-y-1">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="font-bold flex-shrink-0">⚠️ Warning:</span>
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Apply Result Alerts (review item 2) */}
        {lastApplyResult?.status === 'stale' && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-xs font-mono shadow-sm">
            <div className="font-bold">⚠️ Stale Change Proposal — Nothing Written</div>
            <div className="mt-1">
              The following files were modified on disk since the proposal was generated:
            </div>
            <ul className="list-disc pl-5 mt-1 font-semibold">
              {lastApplyResult.stalePaths.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <div className="mt-1.5 text-[11px] text-amber-700">
              Please submit a new instruction to generate a fresh diff against the current files.
            </div>
          </div>
        )}

        {lastApplyResult?.status === 'applied' && (
          <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-mono shadow-sm">
            ✓ Successfully applied {lastApplyResult.appliedHunkIds.length} hunks across {lastApplyResult.appliedPaths.length} files.
          </div>
        )}

        {lastApplyResult?.status === 'nothing_to_apply' && (
          <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-300 text-gray-700 text-xs font-mono shadow-sm">
            ℹ Nothing was applied (no hunks were accepted).
          </div>
        )}

        {lastUndoResult?.status === 'undone' && (
          <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-300 text-blue-800 text-xs font-mono shadow-sm">
            ↺ Successfully reverted changes across {lastUndoResult.restoredPaths.join(', ')}.
          </div>
        )}

        {/* Streaming Delta Reasoning / Progress */}
        {streamingDelta && (
          <div
            className="rounded-xl border p-3.5 text-xs font-mono shadow-sm leading-relaxed"
            style={{
              backgroundColor: 'var(--vscode-sideBar-background, rgba(255, 255, 255, 0.03))',
              borderColor: 'var(--vscode-panel-border, #d0d7de)',
            }}
          >
            <div
              className="flex items-center gap-1.5 text-[10px] uppercase font-bold mb-2 pb-1.5 border-b"
              style={{ borderColor: 'var(--vscode-panel-border, #d0d7de)' }}
            >
              <IconSparkles size={12} className="text-blue-500" />
              <span>Live Response {isRunning && '● Streaming…'}</span>
            </div>
            <div className="whitespace-pre-wrap">{streamingDelta}</div>
          </div>
        )}

        {/* Chain of Thought / Thinking Bar */}
        {thinkingSteps.length > 0 && (
          <ThinkingBar
            headline={thinkingSteps[thinkingSteps.length - 1]?.label || 'Reasoning about codebase…'}
            steps={thinkingSteps}
            isStreaming={isRunning}
          />
        )}

        {/* Context Assembly & Budget (B1: Size budget, strategy stated, shows which files it chose and why) */}
        {repositoryContext && repositoryContext.relevantFiles.length > 0 && (
          <div
            className="border rounded-lg p-2.5 font-mono text-xs shadow-sm"
            style={{
              backgroundColor: 'var(--vscode-editor-background, #ffffff)',
              borderColor: 'var(--vscode-panel-border, #d0d7de)',
              color: 'var(--vscode-editor-foreground, #1f2328)',
            }}
          >
            <div className="flex items-center justify-between text-[11px] font-semibold mb-2">
              <span className="flex items-center gap-1.5 text-blue-600">
                <span>📁</span> Context Assembly ({repositoryContext.relevantFiles.length} files selected, ~{repositoryContext.tokenEstimate} tokens)
              </span>
              <span className="text-[10px] opacity-75">Budget: 12,000 tokens</span>
            </div>
            <div className="space-y-1.5">
              {repositoryContext.relevantFiles.map((f, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between text-[11px] p-1.5 rounded border"
                  style={{
                    backgroundColor: 'rgba(56, 139, 253, 0.05)',
                    borderColor: 'var(--vscode-panel-border, #d0d7de)',
                  }}
                >
                  <span className="font-semibold text-blue-600 truncate mr-2">{f.path}</span>
                  <span className="text-[10px] opacity-75 text-right">{f.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tool Execution Blocks */}
        {toolEvents.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-mono text-gray-500 px-1 font-semibold">
              TOOL EXECUTIONS
            </div>
            {toolEvents.map((t, i) => (
              <ToolBlock
                key={i}
                toolName={t.tool}
                status={t.status}
                detail={t.detail}
              />
            ))}
          </div>
        )}

        {/* ImpactLens Predictive Report Panel */}
        {impactReport && (
          <ImpactPanel report={impactReport} />
        )}

        {/* Diff Reviewer */}
        {changePlan && changePlan.files.length > 0 && (
          <DiffReview
            files={changePlan.files}
            decisions={decisions}
            onDecision={handleDecision}
            onApply={handleApply}
            onUndo={handleUndo}
            isApplied={isApplied}
            onOpenDiff={handleOpenDiff}
          />
        )}

        {/* TestSheriff Verification Panel */}
        <VerificationPanel
          report={verificationReport}
          isRunning={agentState === 'verifying' || Boolean(verificationTests && verificationTests.length > 0)}
        />

        {/* Prompt Input with Autocomplete & Trigger Chips */}
        <div className="pt-1">
          <PromptInput
            onSubmit={(instr, mode) => {
              const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              setHistory((prev) => [...prev, { id: String(Date.now()), text: instr, time: now }]);
              submitInstruction(instr, mode);
            }}
            onCancel={() => runningRequestId && cancelRequest(runningRequestId)}
            isRunning={isRunning}
          />
        </div>

        {/* Feedback Footer */}
        <FeedbackBar />
      </div>
    </div>
  );
};
