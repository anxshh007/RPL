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
      return { bg: 'var(--rp-status-working-bg, #dafbe1)', text: 'var(--rp-status-working-text, #1a7f37)', border: 'var(--rp-status-working-border, #4ac26b)' };
    case 'review_required':
      return { bg: 'var(--rp-status-review-bg, #fff8c5)', text: 'var(--rp-status-review-text, #9a6700)', border: 'var(--rp-status-review-border, #d4a72c)' };
    case 'completed':
      return { bg: 'var(--rp-status-done-bg, #ddf4ff)', text: 'var(--rp-status-done-text, #0969da)', border: 'var(--rp-status-done-border, #54aeff)' };
    case 'error':
      return { bg: 'var(--rp-status-error-bg, #ffebe9)', text: 'var(--rp-status-error-text, #cf222e)', border: 'var(--rp-status-error-border, #ff8182)' };
    case 'cancelled':
    case 'idle':
    default:
      return { bg: 'var(--rp-status-idle-bg, #f6f8fa)', text: 'var(--rp-status-idle-text, #57606a)', border: 'var(--rp-status-idle-border, #d0d7de)' };
  }
}

/** States in which the agent is still working (the user can cancel). review_required waits for the user. */
export function isAgentRunning(state: AgentState | string): boolean {
  return ['starting', 'retrieving_context', 'analysing_impact', 'planning', 'applying', 'verifying'].includes(state);
}
