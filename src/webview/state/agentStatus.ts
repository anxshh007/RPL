// OWNER: Member 5 — how each AgentState (src/shared/contracts/events.ts) is shown in the panel header.
import type { AgentState } from '../../shared/contracts';

/** Badge colours for every AgentState in src/shared/contracts/events.ts, plus the panel's own 'idle'. */
export function getStatusBadge(state: AgentState | string): { bg: string; text: string; border: string } {
  switch (state) {
    case 'starting':
    case 'retrieving_context':
    case 'analysing_impact':
    case 'planning':
    case 'applying':
    case 'verifying':
      return { bg: '#dafbe1', text: '#1a7f37', border: '#4ac26b' };
    case 'review_required':
      return { bg: '#fff8c5', text: '#9a6700', border: '#d4a72c' };
    case 'completed':
      return { bg: '#ddf4ff', text: '#0969da', border: '#54aeff' };
    case 'error':
      return { bg: '#ffebe9', text: '#cf222e', border: '#ff8182' };
    case 'cancelled':
    case 'idle':
    default:
      return { bg: '#f6f8fa', text: '#57606a', border: '#d0d7de' };
  }
}

/** States in which the agent is still working (the user can cancel). review_required waits for the user. */
export function isAgentRunning(state: AgentState | string): boolean {
  return ['starting', 'retrieving_context', 'analysing_impact', 'planning', 'applying', 'verifying'].includes(state);
}
