// OWNER: Member 1 — central orchestration (brief §5 Phase C). Pure TS: no "vscode" import.
// Implements the request lifecycle skeleton. The TrueForge agent loop plugs in at PLANNING.
import {
  AgentController,
  ApplyResult,
  ChangeRequest,
  Disposable,
  EditService,
  HunkDecision,
  ImpactAnalyser,
  ImpactReport,
  RepoPilotEvent,
  RepositoryIntelligence,
  UndoResult,
  VerificationService,
  toSafeError,
} from '../shared/contracts';

export interface AgentDependencies {
  repository: RepositoryIntelligence;
  impact: ImpactAnalyser;
  verification: VerificationService;
  edits: EditService;
}

export class RepoPilotController implements AgentController {
  private readonly listeners = new Set<(e: RepoPilotEvent) => void>();
  private readonly active = new Map<string, AbortController>();

  constructor(private readonly deps: AgentDependencies) {}

  onEvent(listener: (e: RepoPilotEvent) => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  cancel(requestId: string): void {
    this.active.get(requestId)?.abort();
  }

  async submit(request: ChangeRequest): Promise<void> {
    const abort = new AbortController();
    this.active.set(request.requestId, abort);
    const { requestId } = request;
    const { signal } = abort;

    try {
      this.status(requestId, 'starting', 'Request received.');

      // 1. Context (Member 2)
      this.status(requestId, 'retrieving_context', 'Retrieving repository context…');
      const context = await this.deps.repository.getContext(request, signal);
      this.throwIfCancelled(signal);
      this.emit({ type: 'context.ready', requestId, context });

      // 2. Impact before planning (Member 3) — optional: failure is a warning, not a blocker
      this.status(requestId, 'analysing_impact', 'Analysing impact…');
      let impact: ImpactReport | undefined;
      try {
        impact = await this.deps.impact.analyseImpact(request, context, [], signal);
        this.emit({ type: 'impact.ready', requestId, report: impact });
      } catch (err) {
        this.throwIfCancelled(signal);
        this.emit({ type: 'agent.warning', requestId, message: `ImpactLens unavailable: ${toSafeError(err).message}` });
      }
      this.throwIfCancelled(signal);

      // 3. Planning — TODO(Member 1): TrueForge session + MCP tool loop goes here.
      //    It must end with this.deps.edits.propose(...) and emit 'change.proposed',
      //    then wait for applyDecisions() — never write to disk directly.
      //    Per DECISIONS D-14, call impact.analyseImpact again with the proposed file paths.
      this.status(requestId, 'planning', 'Planning…');
      this.emit({ type: 'agent.warning', requestId, message: 'Agent loop not implemented yet: no changes proposed.' });
      this.status(requestId, 'completed', 'Finished (stub pipeline).');
    } catch (err) {
      const safe = toSafeError(err);
      this.deps.edits.discard(requestId); // cancel/error before approval ⇒ no file changes
      if (safe.kind === 'cancelled') {
        this.status(requestId, 'cancelled', 'Cancelled. No files were changed.');
      } else {
        this.emit({ type: 'agent.error', requestId, error: safe });
        this.status(requestId, 'error', safe.message);
      }
    } finally {
      this.active.delete(requestId);
    }
  }

  async applyDecisions(requestId: string, decisions: HunkDecision[]): Promise<ApplyResult> {
    this.status(requestId, 'applying', 'Applying approved hunks…');
    const result = await this.deps.edits.apply(requestId, decisions);
    this.emit({ type: 'change.applied', requestId, result });

    if (result.status === 'applied') {
      this.status(requestId, 'verifying', 'Running relevant tests…');
      this.emit({ type: 'verification.started', requestId, tests: [] });
      const report = await this.deps.verification.verify({
        requestId,
        changedFiles: result.appliedPaths,
        candidateTests: [],
      });
      this.emit({ type: 'verification.completed', requestId, report });
    }
    this.status(requestId, 'completed', `Apply finished: ${result.status}.`);
    return result;
  }

  async undo(requestId: string): Promise<UndoResult> {
    const result = await this.deps.edits.undo(requestId);
    this.emit({ type: 'change.undone', requestId, result });
    return result;
  }

  private status(requestId: string, state: Extract<RepoPilotEvent, { type: 'agent.status' }>['state'], message: string) {
    this.emit({ type: 'agent.status', requestId, state, message });
  }

  private emit(event: RepoPilotEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // a broken listener must not break the pipeline
      }
    }
  }

  private throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) {
      const e = new Error('Request cancelled.');
      e.name = 'AbortError';
      throw e;
    }
  }
}
