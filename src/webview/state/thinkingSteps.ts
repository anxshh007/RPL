// OWNER: Member 5 — the step list shown in the ThinkingBar, derived from agent.status events.
// Pure (no React), so it is unit-tested.
import type { RepoPilotEvent } from '../../shared/contracts';

export interface DerivedStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed';
}

/** States after which the agent is not working any more (the last step is finished, not spinning). */
const IDLE_AFTER = new Set(['completed', 'cancelled', 'error', 'review_required']);

/**
 * One step per agent.status event. Every step except the latest is finished: a later status means
 * the earlier one is over. The latest step spins only while the agent is still working.
 */
export function deriveThinkingSteps(events: readonly RepoPilotEvent[]): DerivedStep[] {
  const statuses = events.flatMap((e, idx) => (e.type === 'agent.status' ? [{ e, idx }] : []));
  return statuses.map(({ e, idx }, i) => {
    const isLast = i === statuses.length - 1;
    const finished = !isLast || IDLE_AFTER.has(e.state);
    return { id: `status-${idx}`, label: e.message, status: finished ? 'completed' : 'running' };
  });
}
