/**
 * ImpactLens: public entry point.
 *
 * Before RepoPilot edits anything, ImpactLens answers: "If these files change,
 * which other files might be affected, and why?"
 *
 * It is a deterministic, read-only analysis service called by the central
 * agent. It never calls a model or the network, never edits files, never runs
 * tests or commands, and never imports vscode. Its output is an estimate based
 * on static relationships, not proof of runtime impact.
 *
 * Usage:
 *   const impact = createImpactAnalyser();
 *   const report = await impact.analyseImpact(request, context);            // before planning
 *   const again = await impact.analyseImpact(request, context, proposed);   // with proposed files
 */
import { toSafeError } from '../shared/contracts';
import type {
  ChangeRequest,
  ImpactAnalyser,
  ImpactReport,
  RepositoryContext,
} from '../shared/contracts';
import { createGraphCache } from './dependency-graph';
import type { GraphCache } from './dependency-graph';
import { resolveChangedTargets, traceImpact } from './impact-analyser';
import { STATIC_ANALYSIS_LIMITATION, assembleReport } from './impact-report';

export interface ImpactAnalyserOptions {
  /** Maximum hops from a changed file. Default 2. */
  maxDepth?: number;
  /** Maximum number of affected files to collect. Default 500. */
  maxVisitedFiles?: number;
  /** Maximum number of nodes in the UI graph. Default 50. */
  maxGraphNodes?: number;
  /**
   * Clock used for `generatedAt`. Everything else in a report depends only on
   * the input; pass a fixed clock to make the whole report reproducible.
   */
  now?: () => Date;
}

function requestIdOf(
  request: ChangeRequest | null | undefined,
  context: RepositoryContext | null | undefined,
): string {
  if (typeof request?.requestId === 'string') {
    return request.requestId;
  }
  return typeof context?.requestId === 'string' ? context.requestId : 'unknown';
}

function timestamp(now: (() => Date) | undefined): string {
  try {
    return (now === undefined ? new Date() : now()).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/** A valid, empty, clearly partial report for when the analysis itself fails. */
function failureReport(requestId: string, generatedAt: string, error: unknown): ImpactReport {
  return {
    requestId,
    generatedAt,
    changedTargets: [],
    affectedFiles: [],
    testCandidates: [],
    nodes: [],
    edges: [],
    summary: { analysedFiles: 0, affectedCount: 0, high: 0, medium: 0, low: 0, incomplete: true },
    warnings: [`ImpactLens could not complete the analysis: ${toSafeError(error).message}`],
    limitations: [STATIC_ANALYSIS_LIMITATION],
  };
}

function analyse(
  options: ImpactAnalyserOptions,
  cache: GraphCache,
  request: ChangeRequest,
  context: RepositoryContext,
  proposedFiles: string[] | undefined,
  signal: AbortSignal | undefined,
): ImpactReport {
  const requestId = requestIdOf(request, context);
  const generatedAt = timestamp(options.now);
  try {
    const changed = resolveChangedTargets(request, proposedFiles);
    const graph = cache.get(context);
    const traversal = traceImpact(graph, changed.targets, {
      maxDepth: options.maxDepth,
      maxVisitedFiles: options.maxVisitedFiles,
      signal,
    });
    return assembleReport({
      requestId,
      generatedAt,
      changed,
      graph,
      traversal,
      maxGraphNodes: options.maxGraphNodes,
    });
  } catch (error) {
    return failureReport(requestId, generatedAt, error);
  }
}

/** The shared ImpactAnalyser, plus a way to release cached graphs. */
export interface ImpactLensService extends ImpactAnalyser {
  /**
   * Drops the cached dependency graphs that contain any of these files, and
   * returns how many were dropped. With no argument, drops them all.
   *
   * Calling this is optional. The cache is keyed by the content of the
   * context's edges, so a changed context is never served a stale graph. Use
   * it after files change to release memory for graphs that will not recur.
   */
  invalidate(paths?: readonly string[]): number;
}

/**
 * Creates the ImpactLens service. The agent module calls it by this name.
 *
 * `analyseImpact` never rejects: bad input produces warnings, and an
 * unexpected failure produces an empty report marked incomplete.
 *
 * Each service keeps its own small cache of dependency graphs, so the second
 * call for a request (with the proposed files) does not rebuild the graph.
 */
export function createImpactAnalyser(options: ImpactAnalyserOptions = {}): ImpactLensService {
  const cache = createGraphCache();
  return {
    async analyseImpact(
      request: ChangeRequest,
      context: RepositoryContext,
      proposedFiles?: string[],
      signal?: AbortSignal,
    ): Promise<ImpactReport> {
      return analyse(options, cache, request, context, proposedFiles, signal);
    },
    invalidate(paths?: readonly string[]): number {
      return cache.invalidate(paths);
    },
  };
}
