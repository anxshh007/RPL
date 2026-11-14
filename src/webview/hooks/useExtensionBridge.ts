import { useEffect, useState, useCallback, useRef } from 'react';
import type { HostToWebview, WebviewToHost, RepoPilotEvent, HunkDecision } from '../../shared/contracts';

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

        if (e.type === 'agent.status') {
          setAgentState(e.state);
          if (['completed', 'cancelled', 'error'].includes(e.state)) {
            setCurrentRequestId(null);
          } else {
            setCurrentRequestId(e.requestId);
          }
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
    submitInstruction,
    cancelRequest,
    applyHunks,
    undoHunks,
    openDiff,
  };
}
