// OWNER: Member 1 — central orchestration (brief §5 Phase C). Pure TS: no "vscode" import.
//
// submit():  starting → retrieving_context → analysing_impact → planning → review_required
//            (or completed when nothing is proposed). ImpactLens runs before planning and again
//            on the proposed files (D-14); an ImpactLens failure is a warning, never a blocker.
// applyDecisions(): applies accepted hunks only (EditService), then runs TestSheriff unless
//            repopilot.tests.requireApproval is on (D-12), in which case runVerification() is
//            called after the user agrees.
// cancel():  aborts the run and discards the pending plan; no file is changed.
import type {
  AgentController,
  AgentState,
  ApplyResult,
  ChangePlan,
  ChangeRequest,
  Disposable,
  EditService,
  HunkDecision,
  ImpactAnalyser,
  ImpactReport,
  RepoPilotEvent,
  RepositoryIntelligence,
  UndoResult,
  VerificationReport,
  VerificationService,
} from '../shared/contracts';
import { toSafeError } from '../shared/contracts';
import { CancellationError, isAbortLike } from './errors';
import type { AgentPlanner } from './planner';

export interface AgentDependencies {
  repository: RepositoryIntelligence;
  impact: ImpactAnalyser;
  verification: VerificationService;
  edits: EditService;
  /** The TrueForge agent loop. Without it, submit() reports that planning is not configured. */
  planner?: AgentPlanner;
}

export interface ControllerOptions {
  /** When set, repository.initialize(workspaceRoot) runs once before the first request. */
  workspaceRoot?: string;
  /** D-12: true (default) = tests run only after runVerification() is called. */
  requireTestApproval?: boolean;
  testTimeoutMs?: number;
  /** Shown when no planner is configured (e.g. repopilot.trueforge.baseUrl is empty). */
  plannerUnavailableReason?: string;
}

export class RepoPilotController implements AgentController {
  private readonly listeners = new Set<(e: RepoPilotEvent) => void>();
  private readonly active = new Map<string, AbortController>();
  private readonly plans = new Map<string, ChangePlan>();
  private readonly applied = new Map<string, ApplyResult>();
  private initialized?: Promise<void>;

  constructor(
    private readonly deps: AgentDependencies,
    private readonly options: ControllerOptions = {},
  ) {}

  private readonly cleanups: Array<() => void | Promise<void>> = [];

  /** Registers something to close when the controller is disposed (e.g. the MCP connector server). */
  addCleanup(cleanup: () => void | Promise<void>): void {
    this.cleanups.push(cleanup);
  }

  /** Cancels running requests and closes owned resources. */
  async dispose(): Promise<void> {
    for (const abort of this.active.values()) {
      abort.abort();
    }
    await Promise.allSettled(this.cleanups.splice(0).map((c) => c()));
  }

  onEvent(listener: (e: RepoPilotEvent) => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  cancel(requestId: string): void {
    this.active.get(requestId)?.abort();
  }

  async submit(request: ChangeRequest): Promise<void> {
    const { requestId } = request;
    if (this.active.has(requestId)) {
      this.emit({ type: 'agent.warning', requestId, message: 'This request is already running.' });
      return;
    }
    const abort = new AbortController();
    this.active.set(requestId, abort);
    const { signal } = abort;

    try {
      this.status(requestId, 'starting', 'Request received.');
      await this.ensureInitialized();
      this.throwIfCancelled(requestId, signal);

      // 1. Context (Member 2)
      this.status(requestId, 'retrieving_context', 'Retrieving repository context…');
      const context = await this.deps.repository.getContext(request, signal);
      this.throwIfCancelled(requestId, signal);
      this.emit({ type: 'context.ready', requestId, context });

      // 2. Impact before planning (Member 3)
      this.status(requestId, 'analysing_impact', 'Analysing impact…');
      let impact = await this.tryImpact(request, context, [], signal);
      this.throwIfCancelled(requestId, signal);

      // 3. Planning (TrueForge agent loop)
      this.status(requestId, 'planning', 'Planning…');
      if (!this.deps.planner) {
        this.emit({
          type: 'agent.warning',
          requestId,
          message: this.options.plannerUnavailableReason ?? 'Agent loop is not configured: no changes proposed.',
        });
        this.status(requestId, 'completed', 'Finished without proposing changes.');
        return;
      }
      const result = await this.deps.planner.plan({ request, context, impact, signal, emit: (e) => this.emit(e) });
      this.throwIfCancelled(requestId, signal);

      if (result.proposals.length === 0) {
        this.emit({ type: 'agent.warning', requestId, message: 'The agent finished without proposing file changes.' });
        this.status(requestId, 'completed', result.summary);
        return;
      }

      // 4. Proposal (diff only) + second impact pass on the proposed files (D-14)
      const plan = await this.deps.edits.propose(requestId, result.summary, result.proposals, result.rationale);
      const second = await this.tryImpact(request, context, plan.files.map((f) => f.path), signal);
      impact = second ?? impact;
      this.throwIfCancelled(requestId, signal);
      const reviewed: ChangePlan = impact ? { ...plan, impactReport: impact } : plan;
      this.plans.set(requestId, reviewed);
      this.emit({ type: 'change.proposed', requestId, plan: reviewed });
      this.status(requestId, 'review_required', 'Review the proposed hunks. Nothing has been written.');
    } catch (err) {
      this.deps.edits.discard(requestId); // cancel or error before approval ⇒ no file changes
      this.plans.delete(requestId);
      if (isAbortLike(err) || signal.aborted) {
        this.status(requestId, 'cancelled', 'Cancelled. No files were changed.');
      } else {
        const safe = toSafeError(err);
        this.emit({ type: 'agent.error', requestId, error: safe });
        this.status(requestId, 'error', safe.message);
      }
    } finally {
      this.active.delete(requestId);
    }
  }

  async applyDecisions(requestId: string, decisions: HunkDecision[]): Promise<ApplyResult> {
    if (this.active.has(requestId)) {
      const result: ApplyResult = {
        requestId,
        status: 'nothing_to_apply',
        appliedPaths: [],
        appliedHunkIds: [],
        stalePaths: [],
        message: 'The request is still running; wait for the proposal.',
      };
      this.emit({ type: 'change.applied', requestId, result });
      return result;
    }

    this.status(requestId, 'applying', 'Applying accepted hunks…');
    let result: ApplyResult;
    try {
      result = await this.deps.edits.apply(requestId, decisions);
    } catch (err) {
      result = { requestId, status: 'error', appliedPaths: [], appliedHunkIds: [], stalePaths: [], message: toSafeError(err).message };
    }
    this.emit({ type: 'change.applied', requestId, result });

    if (result.status !== 'applied') {
      const state: AgentState = result.status === 'error' ? 'error' : 'review_required';
      this.status(requestId, state, result.message ?? `Nothing was written (${result.status}).`);
      return result;
    }

    this.applied.set(requestId, result);
    if (this.options.requireTestApproval ?? true) {
      this.status(requestId, 'completed', `Applied ${result.appliedHunkIds.length} hunk(s). Tests not run yet: waiting for your approval.`);
    } else {
      await this.runVerification(requestId);
    }
    return result;
  }

  /** D-12: runs TestSheriff for the files applied in this request, after the user agreed. */
  async runVerification(requestId: string): Promise<VerificationReport | undefined> {
    const applied = this.applied.get(requestId);
    if (!applied) {
      this.emit({ type: 'agent.warning', requestId, message: 'No applied changes to verify for this request.' });
      return undefined;
    }
    const candidates = this.plans.get(requestId)?.impactReport?.testCandidates ?? [];
    this.status(requestId, 'verifying', 'Running relevant tests…');
    this.emit({ type: 'verification.started', requestId, tests: candidates.map((c) => c.path) });
    let report: VerificationReport;
    try {
      report = await this.deps.verification.verify({
        requestId,
        changedFiles: applied.appliedPaths,
        candidateTests: candidates,
        ...(this.options.testTimeoutMs ? { timeoutMs: this.options.testTimeoutMs } : {}),
      });
    } catch (err) {
      const safe = toSafeError(err);
      this.emit({ type: 'agent.error', requestId, error: safe });
      this.status(requestId, 'error', safe.message);
      return undefined;
    }
    this.emit({ type: 'verification.completed', requestId, report });
    this.status(requestId, 'completed', `Tests: ${report.status.replace('_', ' ')}.`);
    return report;
  }

  async undo(requestId: string): Promise<UndoResult> {
    let result: UndoResult;
    try {
      result = await this.deps.edits.undo(requestId);
    } catch (err) {
      result = { requestId, status: 'error', restoredPaths: [], message: toSafeError(err).message };
    }
    if (result.status === 'undone') {
      this.applied.delete(requestId);
    }
    this.emit({ type: 'change.undone', requestId, result });
    return result;
  }

  private ensureInitialized(): Promise<void> {
    if (!this.options.workspaceRoot) {
      return Promise.resolve();
    }
    this.initialized ??= this.deps.repository.initialize(this.options.workspaceRoot).catch((err) => {
      this.initialized = undefined; // allow a retry on the next request
      throw err;
    });
    return this.initialized;
  }

  private async tryImpact(
    request: ChangeRequest,
    context: Parameters<ImpactAnalyser['analyseImpact']>[1],
    proposedFiles: string[],
    signal: AbortSignal,
  ): Promise<ImpactReport | undefined> {
    try {
      const report = await this.deps.impact.analyseImpact(request, context, proposedFiles, signal);
      if (!signal.aborted) {
        this.emit({ type: 'impact.ready', requestId: request.requestId, report });
      }
      return report;
    } catch (err) {
      if (signal.aborted) {
        return undefined;
      }
      this.emit({
        type: 'agent.warning',
        requestId: request.requestId,
        message: `ImpactLens unavailable: ${toSafeError(err).message}`,
      });
      return undefined;
    }
  }

  private status(requestId: string, state: AgentState, message: string): void {
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

  private throwIfCancelled(requestId: string, signal: AbortSignal): void {
    if (signal.aborted) {
      throw new CancellationError(requestId);
    }
  }
}
