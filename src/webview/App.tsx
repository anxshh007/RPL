import React, { useMemo, useState } from 'react';
import { useExtensionBridge } from './hooks/useExtensionBridge';
import {
  ThinkingBar,
  ThinkingStep,
  ToolBlock,
  DiffReview,
  PromptInput,
  VerificationPanel,
  FeedbackBar,
  FileUpload,
  IconSparkles,
  IconFlask,
  IconGitBranch,
  IconZap,
  IconX,
} from './components';

export const App: React.FC = () => {
  const {
    workspace,
    events,
    currentRequestId,
    agentState,
    errorMessage,
    submitInstruction,
    cancelRequest,
    applyHunks,
    undoHunks,
  } = useExtensionBridge();

  const [decisions, setDecisions] = useState<Map<string, 'accept' | 'reject'>>(new Map());
  const [isApplied, setIsApplied] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ name: string; size: number; isImage?: boolean }>>([]);

  // Derive latest change plan, impact report, and verification report from event stream
  const changePlan = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'change.proposed') return e.plan;
    }
    return undefined;
  }, [events]);

  const impactReport = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'impact.ready') return e.report;
    }
    return undefined;
  }, [events]);

  const verificationReport = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'verification.completed') return e.report;
    }
    return undefined;
  }, [events]);

  const toolEvents = useMemo(() => {
    return events.filter((e) => e.type === 'agent.tool');
  }, [events]);

  const thinkingSteps: ThinkingStep[] = useMemo(() => {
    const steps: ThinkingStep[] = [];
    events.forEach((e, idx) => {
      if (e.type === 'agent.status') {
        steps.push({
          id: `status-${idx}`,
          label: e.message,
          status: ['completed', 'cancelled', 'error'].includes(e.state) ? 'completed' : 'running',
        });
      }
    });
    return steps;
  }, [events]);

  const handleDecision = (path: string, hunkId: string, decision: 'accept' | 'reject') => {
    setDecisions((prev) => {
      const next = new Map(prev);
      next.set(`${path}:${hunkId}`, decision);
      return next;
    });
  };

  const handleApply = () => {
    if (!currentRequestId && !changePlan) return;
    const reqId = currentRequestId || changePlan?.requestId || '';
    const decisionList = Array.from(decisions.entries()).map(([key, decision]) => {
      const [path, hunkId] = key.split(':');
      return { path, hunkId, decision };
    });
    applyHunks(reqId, decisionList);
    setIsApplied(true);
  };

  const handleUndo = () => {
    if (!currentRequestId && !changePlan) return;
    const reqId = currentRequestId || changePlan?.requestId || '';
    undoHunks(reqId);
    setIsApplied(false);
  };

  const handleFilesSelected = (files: File[]) => {
    const mapped = files.map((f) => ({
      name: f.name,
      size: f.size,
      isImage: f.type.startsWith('image/'),
    }));
    setUploadedFiles((prev) => [...prev, ...mapped]);
  };

  const handleRemoveFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const isRunning = !['idle', 'completed', 'cancelled', 'error'].includes(agentState);

  const getStatusColor = (state: string) => {
    switch (state) {
      case 'idle':
        return 'bg-slate-700 text-slate-300 border-slate-600';
      case 'executing':
      case 'planning':
      case 'verifying':
        return 'bg-emerald-950/80 text-emerald-400 border-emerald-700/60 animate-pulse';
      case 'error':
        return 'bg-rose-950/80 text-rose-400 border-rose-700/60';
      case 'completed':
        return 'bg-emerald-950/80 text-emerald-400 border-emerald-700/60';
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-[#F8FAFC] font-sans p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header Bar */}
        <header className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400 to-sky-500 p-0.5 shadow-md flex items-center justify-center">
              <div className="w-full h-full bg-[#0E1223] rounded-[10px] flex items-center justify-center text-emerald-400">
                <IconSparkles size={16} />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-sm font-bold tracking-tight text-white font-mono">
                  RepoPilot AI
                </h1>
                <span
                  className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border ${getStatusColor(
                    agentState
                  )}`}
                >
                  {agentState}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                {workspace.available ? (
                  <span>workspace: <span className="text-slate-200">{workspace.name}</span></span>
                ) : (
                  'No workspace opened'
                )}
              </p>
            </div>
          </div>

          {/* Quick Action Badges */}
          <div className="hidden sm:flex items-center gap-2">
            <button
              type="button"
              onClick={() => submitInstruction('/ponytail-review', 'agent')}
              disabled={isRunning}
              className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0E1223] hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300 hover:text-white transition-all duration-150 disabled:opacity-40"
            >
              <IconZap size={12} className="text-amber-400" />
              <span>Review Diff</span>
            </button>
            <button
              type="button"
              onClick={() => submitInstruction('/verify', 'agent')}
              disabled={isRunning}
              className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0E1223] hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300 hover:text-white transition-all duration-150 disabled:opacity-40"
            >
              <IconFlask size={12} className="text-purple-400" />
              <span>Run Tests</span>
            </button>
            <button
              type="button"
              onClick={() => submitInstruction('/impact', 'agent')}
              disabled={isRunning}
              className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0E1223] hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300 hover:text-white transition-all duration-150 disabled:opacity-40"
            >
              <IconGitBranch size={12} className="text-emerald-400" />
              <span>Impact DAG</span>
            </button>
          </div>
        </header>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center gap-2 font-mono shadow-sm">
            <IconX size={15} className="text-rose-400 flex-shrink-0" />
            <span>{errorMessage}</span>
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

        {/* Tool Execution Blocks */}
        {toolEvents.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-mono text-slate-400 px-1 font-semibold">
              TOOL EXECUTIONS
            </div>
            {toolEvents.map((t, i) => (
              <ToolBlock
                key={i}
                toolName={(t as any).tool}
                status={(t as any).status}
                detail={(t as any).detail}
              />
            ))}
          </div>
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
          />
        )}

        {/* TestSheriff Verification Panel */}
        <VerificationPanel
          report={verificationReport}
          isRunning={agentState === 'verifying'}
        />

        {/* Reference File Uploader */}
        <FileUpload
          onFilesSelected={handleFilesSelected}
          uploadedFiles={uploadedFiles}
          onRemoveFile={handleRemoveFile}
        />

        {/* Prompt Input with Autocomplete & Trigger Chips */}
        <div className="pt-1">
          <PromptInput
            onSubmit={(instr, mode) => submitInstruction(instr, mode)}
            onCancel={() => currentRequestId && cancelRequest(currentRequestId)}
            isRunning={isRunning}
          />
        </div>

        {/* Feedback Footer */}
        <FeedbackBar />
      </div>
    </div>
  );
};
