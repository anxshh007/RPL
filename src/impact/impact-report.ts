/**
 * ImpactLens: report assembly.
 *
 * Takes the pieces produced by the other files (changed targets, the graph,
 * the traversal) and fills in the shared ImpactReport: affected files, test
 * candidates, graph data for the UI, summary counts, warnings and limitations.
 *
 * When `summary.incomplete` is true (always with a warning that explains why):
 *  - the traversal stopped early (file cap reached, or cancelled);
 *  - part of the input was ignored (missing list, malformed entry, bad path);
 *  - a changed-file path was rejected;
 *  - the repository context has no dependency edges at all.
 *
 * Unresolved imports are reported as warnings but do not, on their own, mark
 * the report incomplete. The repository module lists external imports
 * (third-party packages) as unresolved, so they are present in almost every
 * real context; treating them as "incomplete" would make the flag meaningless.
 *
 * Pure logic: no file access, no network, no mutation of the input.
 */
import type {
  AffectedFile,
  ImpactReport,
  ImpactSummary,
  RiskLevel,
  TestCandidate,
} from '../shared/contracts';
import { compareStrings } from './dependency-graph';
import type { DependencyGraph } from './dependency-graph';
import { buildGraphData } from './graph-adapter';
import type { ChangedTargets, ImpactTrace, TraversalResult } from './impact-analyser';
import { classifyImpact, isTestFile } from './impact-rules';

/** Always the first limitation in every report. */
export const STATIC_ANALYSIS_LIMITATION = 'Static analysis only; does not prove runtime impact.';
export const ESTIMATE_LIMITATION =
  'Risk levels and confidence are rule-based estimates, not measured probabilities.';
export const CONTEXT_LIMITATION =
  'Only relationships supplied in the repository context are considered; unresolved imports are not followed.';
export const NO_EDGES_WARNING =
  'The repository context has no dependency edges, so no affected files can be found.';

export function depthLimitation(maxDepth: number): string {
  return `Only files within ${maxDepth} ${maxDepth === 1 ? 'hop' : 'hops'} of a changed file are reported.`;
}

export interface ReportInputs {
  readonly requestId: string;
  /** ISO 8601 timestamp. */
  readonly generatedAt: string;
  readonly changed: ChangedTargets;
  readonly graph: DependencyGraph;
  readonly traversal: TraversalResult;
  /** Cap on the UI graph's nodes. Default 50. Does not limit affectedFiles. */
  readonly maxGraphNodes?: number;
}

const RISK_ORDER: Readonly<Record<RiskLevel, number>> = { high: 0, medium: 1, low: 2 };

/** One affected file as the shared contract describes it. */
export function toAffectedFile(trace: ImpactTrace): AffectedFile {
  const classification = classifyImpact(trace);
  return {
    path: trace.path,
    risk: classification.risk,
    reasons: classification.reasons,
    relationshipPath: [...trace.relationshipPath],
    confidence: classification.confidence,
    // Edges carry no symbol-level evidence, so naming symbols would be a guess.
    relatedSymbols: [],
    matchedRule: classification.matchedRule,
  };
}

function candidateReason(trace: ImpactTrace): string {
  const target = trace.relationshipPath[0] ?? 'a changed file';
  if (trace.pathEvidence === 'inferred') {
    return `Linked to ${target}, which is being changed, by an inferred relationship (not observed in source).`;
  }
  if (trace.distance === 1) {
    return `Depends directly on ${target}, which is being changed.`;
  }
  return `Depends on ${target}, which is being changed, through ${trace.distance} hops.`;
}

interface Entry {
  readonly trace: ImpactTrace;
  readonly file: AffectedFile;
}

/** Highest risk first, then nearest, then by path. */
function compareEntries(a: Entry, b: Entry): number {
  return (
    RISK_ORDER[a.file.risk] - RISK_ORDER[b.file.risk] ||
    a.trace.distance - b.trace.distance ||
    compareStrings(a.file.path, b.file.path)
  );
}

/**
 * Affected test files, as hints for the test runner. They stay in
 * affectedFiles as well. The test runner decides what to run.
 */
function toTestCandidates(entries: readonly Entry[]): TestCandidate[] {
  return entries
    .filter((entry) => isTestFile(entry.file.path))
    .map((entry) => ({
      path: entry.file.path,
      reason: candidateReason(entry.trace),
      source: 'impact' as const,
      confidence: entry.file.confidence,
    }));
}

function summarise(
  inputs: ReportInputs,
  affectedFiles: readonly AffectedFile[],
  incomplete: boolean,
): ImpactSummary {
  const count = (risk: RiskLevel): number =>
    affectedFiles.filter((file) => file.risk === risk).length;
  return {
    analysedFiles: new Set([...inputs.graph.files, ...inputs.changed.targets]).size,
    affectedCount: affectedFiles.length,
    high: count('high'),
    medium: count('medium'),
    low: count('low'),
    incomplete,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Assembles the complete ImpactReport. Every collection is an array, never null. */
export function assembleReport(inputs: ReportInputs): ImpactReport {
  const { changed, graph, traversal } = inputs;

  const entries = traversal.traces
    .map((trace) => ({ trace, file: toAffectedFile(trace) }))
    .sort(compareEntries);
  const affectedFiles = entries.map((entry) => entry.file);
  const graphData = buildGraphData({
    graph,
    changedTargets: changed.targets,
    affectedFiles,
    maxNodes: inputs.maxGraphNodes,
  });

  const noEdges = graph.edges.length === 0;
  const incomplete =
    traversal.incomplete || graph.droppedInput || changed.rejectedCount > 0 || noEdges;

  const warnings = unique([
    ...changed.warnings,
    ...graph.warnings,
    // A dropped-input warning already explains an empty graph.
    ...(noEdges && !graph.droppedInput ? [NO_EDGES_WARNING] : []),
    ...traversal.warnings,
    // A trimmed graph is a display limit, not missing analysis: it warns but
    // does not mark the report incomplete.
    ...graphData.warnings,
  ]);

  return {
    requestId: inputs.requestId,
    generatedAt: inputs.generatedAt,
    changedTargets: [...changed.targets],
    affectedFiles,
    testCandidates: toTestCandidates(entries),
    nodes: graphData.nodes,
    edges: graphData.edges,
    summary: summarise(inputs, affectedFiles, incomplete),
    warnings,
    limitations: [
      STATIC_ANALYSIS_LIMITATION,
      ESTIMATE_LIMITATION,
      depthLimitation(traversal.maxDepth),
      CONTEXT_LIMITATION,
    ],
  };
}
