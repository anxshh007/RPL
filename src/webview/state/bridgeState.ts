// OWNER: Member 5 — panel state derived from host messages. Pure (no React, no DOM), so it is unit-tested.
//
// Rules:
// - A new request starts with agent.status "starting" for a requestId we are not showing yet.
//   Everything that belongs to one request (events, warnings, streamed text, apply/undo results,
//   running tests, errors) is cleared at that moment.
// - Events for any other requestId are ignored, so a late event from an earlier request
//   can never overwrite what the user is looking at.
// - Warnings are kept as a list (a run can warn more than once).
import type { ApplyResult, HostToWebview, RepoPilotEvent, UndoResult } from '../../shared/contracts';

export interface BridgeState {
  workspace: { available: boolean; name?: string };
  /** The request shown in the panel (stays set after it finishes, so Apply/Undo still work). */
  activeRequestId: string | null;
  /** Set only while the shown request is still running. */
  runningRequestId: string | null;
  agentState: string;
  events: RepoPilotEvent[];
  errorMessage: string | null;
  warnings: string[];
  streamingDelta: string;
  lastApplyResult: ApplyResult | null;
  lastUndoResult: UndoResult | null;
  verificationTests: string[] | null;
  activeModel?: string;
}

export const initialBridgeState: BridgeState = {
  workspace: { available: false },
  activeRequestId: null,
  runningRequestId: null,
  agentState: 'idle',
  events: [],
  errorMessage: null,
  warnings: [],
  streamingDelta: '',
  lastApplyResult: null,
  lastUndoResult: null,
  verificationTests: null,
  activeModel: 'google/gemma-4-26b-a4b-it:free',
};

const TERMINAL_STATES = new Set(['completed', 'cancelled', 'error']);

/** Fields that belong to one request and are cleared when a new one starts. */
function freshRequest(state: BridgeState, requestId: string): BridgeState {
  return {
    ...state,
    activeRequestId: requestId,
    runningRequestId: requestId,
    agentState: 'starting',
    events: [],
    errorMessage: null,
    warnings: [],
    streamingDelta: '',
    lastApplyResult: null,
    lastUndoResult: null,
    verificationTests: null,
  };
}

export type BridgeAction = HostToWebview | { type: 'local.submit' };

export function bridgeReducer(state: BridgeState, msg: BridgeAction): BridgeState {
  switch (msg.type) {
    case 'host.workspace':
      return { ...state, workspace: { available: msg.available, name: msg.name } };

    case 'host.error':
      return { ...state, errorMessage: msg.message };

    case 'host.model':
      return { ...state, activeModel: msg.model };

    case 'local.submit':
      // The user sent a new instruction: clear the old banners right away; the new
      // requestId arrives with its first agent.status event.
      return { ...state, errorMessage: null, warnings: [], streamingDelta: '' };

    case 'host.event':
      return applyEvent(state, msg.event);

    default:
      return state;
  }
}

function applyEvent(state: BridgeState, e: RepoPilotEvent): BridgeState {
  let next = state;
  if (e.requestId !== state.activeRequestId) {
    const startsNewRequest = e.type === 'agent.status' && (e.state === 'starting' || state.activeRequestId === null);
    if (!startsNewRequest) {
      return state; // belongs to an earlier (or unrelated) request
    }
    next = freshRequest(state, e.requestId);
  }

  next = { ...next, events: [...next.events, e] };

  switch (e.type) {
    case 'agent.status':
      return {
        ...next,
        agentState: e.state,
        runningRequestId: TERMINAL_STATES.has(e.state) ? null : e.requestId,
      };
    case 'agent.error':
      return { ...next, agentState: 'error', errorMessage: e.error.message, runningRequestId: null };
    case 'agent.warning':
      return { ...next, warnings: [...next.warnings, e.message] };
    case 'agent.delta':
      return { ...next, streamingDelta: next.streamingDelta + e.text };
    case 'change.proposed':
      // A new plan replaces any earlier apply/undo outcome for this request.
      return { ...next, lastApplyResult: null, lastUndoResult: null };
    case 'change.applied':
      return { ...next, lastApplyResult: e.result, lastUndoResult: null };
    case 'change.undone':
      return { ...next, lastUndoResult: e.result };
    case 'verification.started':
      return { ...next, verificationTests: e.tests };
    case 'verification.completed':
      return { ...next, verificationTests: null };
    default:
      return next;
  }
}

/** True when the shown request's changes are on disk (applied and not undone since). */
export function isPlanApplied(state: BridgeState): boolean {
  return state.lastApplyResult?.status === 'applied' && state.lastUndoResult?.status !== 'undone';
}
