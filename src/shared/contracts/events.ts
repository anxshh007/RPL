/**
 * The ONE event stream from the agent to the UI (merges Member 1 §4 and Member 5 §6).
 * The UI must never infer state from missing data — only from these events.
 */
import type {
  ApplyResult,
  ChangePlan,
  ImpactReport,
  RepositoryContext,
  UndoResult,
  VerificationReport,
} from './domain';
import type { SafeError } from './errors';

export type AgentState =
  | 'idle'
  | 'starting'
  | 'retrieving_context'
  | 'analysing_impact'
  | 'planning'
  | 'review_required'
  | 'applying'
  | 'verifying'
  | 'completed'
  | 'cancelled'
  | 'error';

export type RepoPilotEvent =
  | { type: 'agent.status'; requestId: string; state: AgentState; message: string }
  | { type: 'agent.delta'; requestId: string; text: string }
  | { type: 'agent.tool'; requestId: string; tool: string; status: 'started' | 'succeeded' | 'failed'; detail?: string }
  | { type: 'agent.warning'; requestId: string; message: string }
  | { type: 'context.ready'; requestId: string; context: RepositoryContext }
  | { type: 'impact.ready'; requestId: string; report: ImpactReport }
  | { type: 'change.proposed'; requestId: string; plan: ChangePlan }
  | { type: 'change.applied'; requestId: string; result: ApplyResult }
  | { type: 'change.undone'; requestId: string; result: UndoResult }
  | { type: 'verification.started'; requestId: string; tests: string[] }
  | { type: 'verification.completed'; requestId: string; report: VerificationReport }
  | { type: 'agent.error'; requestId: string; error: SafeError };

export type RepoPilotEventType = RepoPilotEvent['type'];
