/**
 * RepoPilot AI — canonical domain contracts.
 *
 * This is the ONE place these types are defined. Every module imports from
 * "src/shared/contracts". Never redefine them locally (see AGENTS.md).
 * Changes need a PR reviewed by all module owners (see docs/DECISIONS.md D-03).
 *
 * Conventions:
 *  - Paths are workspace-relative POSIX paths ("src/flask/cli.py"), never absolute.
 *  - Line numbers are 1-based.
 *  - Collections are [] when empty, never null.
 *  - Unknown numbers are null, never a guessed 0.
 *  - Statuses use snake_case ("not_run", "timed_out").
 */

export type RiskLevel = 'low' | 'medium' | 'high';
export type Confidence = 'high' | 'medium' | 'low';
/** observed = seen in source (an import line); inferred = heuristic (naming convention). */
export type Evidence = 'observed' | 'inferred';

// ───────────────────────── Request (Member 1) ─────────────────────────

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface ChangeRequest {
  requestId: string;
  instruction: string;
  mode: 'inline' | 'agent';
  activeFile?: string;
  selectedText?: string;
  selectionRange?: LineRange;
  explicitFileMentions: string[];
  explicitSymbolMentions: string[];
}

// ─────────────────── Repository context (Member 2) ───────────────────

export interface Excerpt extends LineRange {
  text: string;
}

export type ContextSource =
  | 'explicit_mention'
  | 'active_selection'
  | 'symbol_match'
  | 'text_match'
  | 'dependency'
  | 'test_or_doc';

export interface ContextFile {
  path: string;
  /** Human-readable reason shown in the UI. */
  reason: string;
  /** Heuristic ranking score; higher = more relevant. Not a probability. */
  score: number;
  source: ContextSource;
  excerpts: Excerpt[];
}

export type SymbolKind = 'function' | 'method' | 'class' | 'variable' | 'module';

export interface SymbolRecord {
  name: string;
  kind: SymbolKind;
  file: string;
  startLine: number;
  endLine: number;
  parent?: string;
}

/** Repository-level dependency edge (file → file). */
export interface DependencyEdge {
  from: string;
  to: string;
  kind: 'imports' | 'references' | 'tests';
  evidence: Evidence;
}

export interface UnresolvedImport {
  file: string;
  module: string;
}

export interface SearchResult {
  path: string;
  line: number;
  text: string;
}

export interface RepositoryContext {
  requestId: string;
  relevantFiles: ContextFile[];
  relevantSymbols: SymbolRecord[];
  dependencyEdges: DependencyEdge[];
  unresolvedImports: UnresolvedImport[];
  /** Conservative character-based estimate — not exact. */
  tokenEstimate: number;
  tokenBudget: number;
  /** Explicit mentions that did not fit the budget (reported, never silently dropped). */
  budgetConflicts: string[];
  warnings: string[];
}

// ─────────────────────── ImpactLens (Member 3) ───────────────────────

export interface TestCandidate {
  path: string;
  reason: string;
  source: 'explicit' | 'impact' | 'convention' | 'configuration';
  confidence: Confidence;
}

export interface AffectedFile {
  path: string;
  risk: RiskLevel;
  /** Heuristic, not statistically calibrated. Optional. */
  heuristicScore?: number;
  /** At least one human-readable reason. */
  reasons: string[];
  /** e.g. ["src/flask/helpers.py", "src/flask/app.py"] */
  relationshipPath: string[];
  confidence: Confidence;
  relatedSymbols: string[];
  /** Name of the rule in impact-rules that produced this level. */
  matchedRule: string;
}

/** Graph data for the UI (React Flow uses source/target). */
export interface GraphNode {
  id: string;
  label: string;
  kind: 'file' | 'symbol' | 'test';
  path?: string;
  highlight: 'changed' | 'affected' | 'none';
  risk?: RiskLevel;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: 'imports' | 'references' | 'exports' | 'tests';
  evidence: Evidence;
}

export interface ImpactSummary {
  analysedFiles: number;
  affectedCount: number;
  high: number;
  medium: number;
  low: number;
  incomplete: boolean;
}

export interface ImpactReport {
  requestId: string;
  generatedAt: string;
  changedTargets: string[];
  affectedFiles: AffectedFile[];
  testCandidates: TestCandidate[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  summary: ImpactSummary;
  warnings: string[];
  limitations: string[];
}

// ──────────────── Proposed edits & review (Member 1) ────────────────

export interface Hunk {
  hunkId: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  diffText: string;
}

export interface ProposedFileChange {
  path: string;
  changeType: 'modify' | 'create' | 'delete';
  /** Hash of disk content when the diff was computed; apply is refused if it changed. */
  originalContentHash: string;
  proposedContent: string;
  unifiedDiff: string;
  hunks: Hunk[];
}

export interface ChangePlan {
  requestId: string;
  summary: string;
  files: ProposedFileChange[];
  impactReport?: ImpactReport;
  rationale: string[];
}

export interface HunkDecision {
  path: string;
  hunkId: string;
  decision: 'accept' | 'reject';
}

export interface ApplyResult {
  requestId: string;
  status: 'applied' | 'nothing_to_apply' | 'stale' | 'error';
  appliedPaths: string[];
  appliedHunkIds: string[];
  /** Files whose content changed since the proposal (status "stale"). */
  stalePaths: string[];
  message?: string;
}

export interface UndoResult {
  requestId: string;
  status: 'undone' | 'nothing_to_undo' | 'error';
  restoredPaths: string[];
  message?: string;
}

// ─────────────────────── TestSheriff (Member 4) ───────────────────────

export type VerificationStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'error'
  | 'not_run';

export interface TestRunRequest {
  requestId: string;
  changedFiles: string[];
  candidateTests: TestCandidate[];
  timeoutMs?: number;
}

export interface TestCounts {
  /** null = unknown (not run, or output could not be parsed). Never guessed. */
  total: number | null;
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  errors: number | null;
}

export interface TestFailure {
  testName: string;
  file?: string;
  message: string;
}

export interface VerificationReport {
  requestId: string;
  status: VerificationStatus;
  runner: 'pytest' | 'none';
  /** Safe display label, e.g. "python -m pytest tests/test_cli.py -q". */
  commandLabel: string;
  selectedTests: Array<{ path: string; reason: string }>;
  counts: TestCounts;
  parsingComplete: boolean;
  exitCode: number | null;
  durationMs: number | null;
  startedAt?: string;
  completedAt?: string;
  failures: TestFailure[];
  stdoutTail: string;
  stderrTail: string;
  outputTruncated: boolean;
  limitations: string[];
}
