import { useEffect, useState, useCallback, useRef } from 'react';
import type {
  HostToWebview,
  WebviewToHost,
  RepoPilotEvent,
  HunkDecision,
  ApplyResult,
  UndoResult,
} from '../../shared/contracts';

declare function acquireVsCodeApi(): {
  postMessage: (message: WebviewToHost) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

let vscodeApi: ReturnType<typeof acquireVsCodeApi> | undefined;
function getVsCode() {
  if (!vscodeApi && typeof acquireVsCodeApi === 'function') {
    vscodeApi = acquireVsCodeApi();
  }
  return vscodeApi;
}

export function useExtensionBridge() {
  const [workspace, setWorkspace] = useState<{ available: boolean; name?: string }>({ available: false });
  const [events, setEvents] = useState<RepoPilotEvent[]>([]);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [agentState, setAgentState] = useState<string>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [streamingDelta, setStreamingDelta] = useState<string>('');
  const [lastApplyResult, setLastApplyResult] = useState<ApplyResult | null>(null);
  const [lastUndoResult, setLastUndoResult] = useState<UndoResult | null>(null);
  const [verificationTests, setVerificationTests] = useState<string[] | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<HostToWebview>) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'host.workspace') {
        setWorkspace({ available: msg.available, name: msg.name });
      } else if (msg.type === 'host.error') {
        setErrorMessage(msg.message);
      } else if (msg.type === 'host.event') {
        const e = msg.event;
        setEvents((prev) => [...prev, e]);

        switch (e.type) {
          case 'agent.status':
            setAgentState(e.state);
            if (['completed', 'cancelled', 'error'].includes(e.state)) {
              setCurrentRequestId(null);
            } else {
              setCurrentRequestId(e.requestId);
            }
            break;

          case 'agent.error':
            setAgentState('error');
            setErrorMessage(e.error.message);
            setCurrentRequestId(null);
            break;

          case 'agent.warning':
            setWarningMessage(e.message);
            break;

          case 'agent.delta':
            setStreamingDelta((prev) => prev + e.text);
            break;

          case 'change.applied':
            setLastApplyResult(e.result);
            break;

          case 'change.undone':
            setLastUndoResult(e.result);
            break;

          case 'verification.started':
            setVerificationTests(e.tests);
            break;

          case 'verification.completed':
            setVerificationTests(null);
            break;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    // Signal to host that UI is ready
    getVsCode()?.postMessage({ type: 'ui.ready' });

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const submitInstruction = useCallback((instruction: string, mode: 'inline' | 'agent' = 'agent') => {
    setErrorMessage(null);
    setWarningMessage(null);
    setStreamingDelta('');
    setLastApplyResult(null);
    setLastUndoResult(null);
    getVsCode()?.postMessage({ type: 'ui.submit', instruction, mode });
  }, []);

  const cancelRequest = useCallback((requestId: string) => {
    getVsCode()?.postMessage({ type: 'ui.cancel', requestId });
  }, []);

  const applyHunks = useCallback((requestId: string, decisions: HunkDecision[]) => {
    getVsCode()?.postMessage({ type: 'ui.applyDecisions', requestId, decisions });
  }, []);

  const undoHunks = useCallback((requestId: string) => {
    getVsCode()?.postMessage({ type: 'ui.undo', requestId });
  }, []);

  const openDiff = useCallback((requestId: string, path: string) => {
    getVsCode()?.postMessage({ type: 'ui.openDiff', requestId, path });
  }, []);

  return {
    workspace,
    events,
    currentRequestId,
    agentState,
    errorMessage,
    warningMessage,
    streamingDelta,
    lastApplyResult,
    lastUndoResult,
    verificationTests,
    submitInstruction,
    cancelRequest,
    applyHunks,
    undoHunks,
    openDiff,
  };
}
