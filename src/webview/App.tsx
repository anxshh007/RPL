import React, { useMemo, useState } from 'react';
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
  FileUpload,
  ImpactPanel,
  IconSparkles,
  IconFlask,
  IconZap,
  IconX,
} from './components';
import type { ChangePlan, ImpactReport, VerificationReport } from '../shared/contracts';

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
  const changePlan = useMemo<ChangePlan | undefined>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'change.proposed') return e.plan;
    }
    return undefined;
  }, [events]);

  const impactReport = useMemo<ImpactReport | undefined>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'impact.ready') return e.report;
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
      next.set(makeDecisionKey(path, hunkId), decision);
      return next;
    });
  };

  const handleApply = () => {
    if (!currentRequestId && !changePlan) return;
    const reqId = currentRequestId || changePlan?.requestId || '';
    const decisionList = Array.from(decisions.entries()).map(([key, decision]) => {
      const { path, hunkId } = parseDecisionKey(key);
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

  const getStatusBadge = (state: string) => {
    switch (state) {
      case 'idle':
        return { bg: '#f6f8fa', text: '#57606a', border: '#d0d7de' };
      case 'executing':
      case 'planning':
      case 'verifying':
        return { bg: '#dafbe1', text: '#1a7f37', border: '#4ac26b' };
      case 'error':
        return { bg: '#ffebe9', text: '#cf222e', border: '#ff8182' };
      case 'completed':
        return { bg: '#ddf4ff', text: '#0969da', border: '#54aeff' };
      default:
        return { bg: '#f6f8fa', text: '#57606a', border: '#d0d7de' };
    }
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
            <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm">
              <IconSparkles size={15} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight font-mono text-gray-900">
                  RepoPilot AI
                </h1>
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
              <p className="text-[11px] text-gray-500 font-mono">
                {workspace.available ? (
                  <span>workspace: <span className="text-gray-800 font-semibold">{workspace.name}</span></span>
                ) : (
                  'No workspace opened'
                )}
              </p>
            </div>
          </div>

          {/* Quick Action Badges (Impact DAG button removed per review) */}
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <button
              type="button"
              onClick={() => submitInstruction('/ponytail-review', 'agent')}
              disabled={isRunning}
              className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] transition disabled:opacity-40"
              style={{
                backgroundColor: 'var(--vscode-sideBar-background, #f6f8fa)',
                borderColor: 'var(--vscode-panel-border, #d0d7de)',
                color: 'var(--vscode-editor-foreground, #1f2328)',
              }}
            >
              <IconZap size={12} className="text-amber-500" />
              <span>Review Diff</span>
            </button>
            <button
              type="button"
              onClick={() => submitInstruction('/verify', 'agent')}
              disabled={isRunning}
              className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] transition disabled:opacity-40"
              style={{
                backgroundColor: 'var(--vscode-sideBar-background, #f6f8fa)',
                borderColor: 'var(--vscode-panel-border, #d0d7de)',
                color: 'var(--vscode-editor-foreground, #1f2328)',
              }}
            >
              <IconFlask size={12} className="text-purple-600" />
              <span>Run Tests</span>
            </button>
          </div>
        </header>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2 font-mono shadow-sm">
            <IconX size={14} className="text-red-600 flex-shrink-0" />
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
          <div className="space-y-1.5">
            <div className="text-[11px] font-mono text-gray-500 px-1 font-semibold">
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
