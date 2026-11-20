import { useEffect, useCallback, useReducer } from 'react';
import type { HostToWebview, WebviewToHost, HunkDecision } from '../../shared/contracts';
import { bridgeReducer, initialBridgeState } from '../state/bridgeState';

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
  const [state, dispatch] = useReducer(bridgeReducer, initialBridgeState);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<HostToWebview>) => {
      if (event.data) {
        dispatch(event.data);
      }
    };
    window.addEventListener('message', handleMessage);
    // Signal to host that UI is ready
    getVsCode()?.postMessage({ type: 'ui.ready' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const submitInstruction = useCallback((instruction: string, mode: 'inline' | 'agent' = 'agent') => {
    dispatch({ type: 'local.submit' });
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

  const changeModel = useCallback((model: string) => {
    getVsCode()?.postMessage({ type: 'ui.setModel', model });
  }, []);

  return {
    state,
    submitInstruction,
    cancelRequest,
    applyHunks,
    undoHunks,
    openDiff,
    changeModel,
  };
}
