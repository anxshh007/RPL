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
import type { ChangePlan, ImpactReport, VerificationReport, RepoPilotEvent } from '../shared/contracts';
import { isPlanApplied } from './state/bridgeState';
import { getStatusBadge, isAgentRunning } from './state/agentStatus';

export const App: React.FC = () => {
  const { state, submitInstruction, cancelRequest, applyHunks, undoHunks, openDiff } = useExtensionBridge();
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
  } = state;

  const [decisions, setDecisions] = useState<Map<string, 'accept' | 'reject'>>(new Map());

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
        </header>

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
        {streamingDelta && isRunning && (
          <div className="p-2.5 rounded-lg border text-xs font-mono bg-gray-50 text-gray-700 shadow-sm">
            <div className="text-[10px] uppercase font-bold text-gray-500 mb-1">Live Output</div>
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
            onSubmit={(instr, mode) => submitInstruction(instr, mode)}
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
