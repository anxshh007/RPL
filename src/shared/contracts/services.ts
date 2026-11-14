/**
 * Service interfaces between modules. Each owner implements one; everyone else
 * codes against the interface, so modules can be built in parallel with stubs.
 *
 * Rule: no interface here may expose an operation that writes to disk without an
 * explicit HunkDecision list (see EditService.apply).
 */
import type {
  ApplyResult,
  ChangePlan,
  ChangeRequest,
  DependencyEdge,
  HunkDecision,
  ImpactReport,
  RepositoryContext,
  SearchResult,
  SymbolRecord,
  TestCandidate,
  TestRunRequest,
  UndoResult,
  VerificationReport,
} from './domain';
import type { RepoPilotEvent } from './events';

export interface Disposable {
  dispose(): void;
}

/** Owner: Member 2 — src/repository/ */
export interface RepositoryIntelligence {
  initialize(root: string): Promise<void>;
  search(query: string, limit?: number): Promise<SearchResult[]>;
  readFile(path: string, startLine?: number, endLine?: number): Promise<string>;
  findSymbol(name: string, fileHint?: string): Promise<SymbolRecord[]>;
  getContext(request: ChangeRequest, signal?: AbortSignal): Promise<RepositoryContext>;
  getDependencies(paths: string[]): Promise<DependencyEdge[]>;
  invalidate(paths: string[]): void;
  reindex(paths: string[]): Promise<void>;
}

/** Owner: Member 3 — src/impact/. Read-only: never edits, never runs tests. */
export interface ImpactAnalyser {
  analyseImpact(
    request: ChangeRequest,
    context: RepositoryContext,
    proposedFiles?: string[],
    signal?: AbortSignal,
  ): Promise<ImpactReport>;
}

/** Owner: Member 4 — src/verification/. Never edits code. Allowlisted runners only. */
export interface VerificationService {
  discoverTests(changedFiles: string[], candidates: TestCandidate[]): Promise<TestCandidate[]>;
  verify(request: TestRunRequest, signal?: AbortSignal): Promise<VerificationReport>;
}

/** Proposed content for one file, before diffing. */
export interface FileProposal {
  path: string;
  proposedContent: string;
}

/** Owner: Member 1 — src/edits/. The ONLY module allowed to write workspace files. */
export interface EditService {
  /** Computes diffs against current disk content. MUST NOT write to disk. */
  propose(requestId: string, summary: string, proposals: FileProposal[], rationale: string[]): Promise<ChangePlan>;
  /** Applies accepted hunks only; refuses if a file's hash changed since propose(). */
  apply(requestId: string, decisions: HunkDecision[]): Promise<ApplyResult>;
  undo(requestId: string): Promise<UndoResult>;
  /** Drops a pending plan (e.g. on cancel) without touching disk. */
  discard(requestId: string): void;
}

/** Owner: Member 1 — src/agent/. The single entry point used by the UI (Member 5). */
export interface AgentController {
  submit(request: ChangeRequest): Promise<void>;
  cancel(requestId: string): void;
  applyDecisions(requestId: string, decisions: HunkDecision[]): Promise<ApplyResult>;
  undo(requestId: string): Promise<UndoResult>;
  onEvent(listener: (event: RepoPilotEvent) => void): Disposable;
}
