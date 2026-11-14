/**
 * ImpactLens: which files are affected by a change, and through which links.
 *
 * This file answers three questions:
 *  1. Which files are being changed? (resolveChangedTargets)
 *  2. Which files depend directly on them? (findDirectDependants)
 *  3. Which files depend on them within a bounded number of hops? (traceImpact)
 *
 * Results are structural facts only: paths, hops and the edges that connect
 * them. Risk and confidence are decided separately, in impact-rules.
 *
 * Pure logic: no file access, no network, no mutation of the input.
 */
import type { ChangeRequest, DependencyEdge, Evidence } from '../shared/contracts';
import {
  compareStrings,
  dependantEdgesOf,
  dependencyEdgesOf,
  describeRejection,
  displayPath,
  normalisePath,
} from './dependency-graph';
import type { DependencyGraph } from './dependency-graph';

// ───────────────────────── Changed targets ─────────────────────────

/** Where the list of changed files came from. */
export type ChangedTargetSource = 'proposed_files' | 'request' | 'none';

export interface ChangedTargets {
  /** Normalised, deduplicated and sorted. */
  readonly targets: readonly string[];
  readonly source: ChangedTargetSource;
  /** Rejected paths, and a note when there is nothing to analyse. Sorted. */
  readonly warnings: readonly string[];
  /** How many distinct paths were rejected. */
  readonly rejectedCount: number;
}

function requestCandidates(request: ChangeRequest | null | undefined): unknown[] {
  if (typeof request !== 'object' || request === null) {
    return [];
  }
  const candidates: unknown[] = [];
  if (request.activeFile !== undefined && request.activeFile !== null) {
    candidates.push(request.activeFile);
  }
  if (Array.isArray(request.explicitFileMentions)) {
    candidates.push(...request.explicitFileMentions);
  }
  return candidates;
}

/**
 * Decides which files count as changed.
 *
 *  - Non-empty `proposedFiles` are used on their own; the request is ignored.
 *  - Otherwise the request's active file and explicit file mentions are used.
 *  - Absolute paths and paths containing ".." are rejected with a warning.
 *  - With no valid file left, `targets` is empty and a warning says so.
 *
 * If proposed files are given but every one is rejected, the result is empty.
 * It does not fall back to the request, because that would report impact for
 * files the caller did not ask about.
 */
export function resolveChangedTargets(
  request: ChangeRequest | null | undefined,
  proposedFiles?: readonly string[] | null,
): ChangedTargets {
  const useProposed = Array.isArray(proposedFiles) && proposedFiles.length > 0;
  const candidates: readonly unknown[] = useProposed ? proposedFiles : requestCandidates(request);

  const targets = new Set<string>();
  const rejections = new Set<string>();
  for (const candidate of candidates) {
    const result = normalisePath(candidate);
    if (result.ok) {
      targets.add(result.path);
    } else {
      rejections.add(
        `Ignored changed file "${displayPath(candidate)}": ${describeRejection(result.reason)}.`,
      );
    }
  }

  const warnings = [...rejections].sort(compareStrings);
  if (targets.size === 0) {
    warnings.push(
      candidates.length === 0
        ? 'No changed files were given (no proposed files, active file or file mentions); nothing to analyse.'
        : 'No valid changed files remain after rejecting bad paths; nothing to analyse.',
    );
  }

  let source: ChangedTargetSource = 'none';
  if (useProposed) {
    source = 'proposed_files';
  } else if (candidates.length > 0) {
    source = 'request';
  }
  return {
    targets: [...targets].sort(compareStrings),
    source,
    warnings,
    rejectedCount: rejections.size,
  };
}

// ───────────────────────── Direct dependants ─────────────────────────

/** How one affected file is reached from the changed files. */
export interface ImpactTrace {
  /** The affected file. Never one of the changed files. */
  readonly path: string;
  /** Hops from the nearest changed file. 1 = depends on it directly. */
  readonly distance: number;
  /**
   * From the changed file to this file, e.g.
   * ["src/flask/helpers.py", "src/flask/app.py"]. Length is distance + 1.
   */
  readonly relationshipPath: readonly string[];
  /**
   * The edges along relationshipPath, in the same order:
   * pathEdges[i] goes from relationshipPath[i + 1] to relationshipPath[i].
   */
  readonly pathEdges: readonly DependencyEdge[];
  /** "observed" only if every edge on the path is observed. */
  readonly pathEvidence: Evidence;
  /**
   * Every edge from this file straight to a changed file, sorted by target
   * then kind. Usually empty when distance is more than 1. The exception is a
   * file with an inferred direct link and a longer all-observed path: the
   * observed path is reported, and the inferred link is kept here.
   */
  readonly directLinks: readonly DependencyEdge[];
}

function evidenceRank(evidence: Evidence): number {
  return evidence === 'observed' ? 0 : 1;
}

/**
 * Orders the links one file has to changed files, best first: observed before
 * inferred, then by target path, then by kind. The first one becomes the
 * relationship path, so the choice never depends on input order.
 */
function compareLinkPreference(a: DependencyEdge, b: DependencyEdge): number {
  return (
    evidenceRank(a.evidence) - evidenceRank(b.evidence) ||
    compareStrings(a.to, b.to) ||
    compareStrings(a.kind, b.kind)
  );
}

function compareLinkOrder(a: DependencyEdge, b: DependencyEdge): number {
  return compareStrings(a.to, b.to) || compareStrings(a.kind, b.kind);
}

function directTrace(path: string, links: readonly DependencyEdge[]): ImpactTrace | undefined {
  const primary = [...links].sort(compareLinkPreference)[0];
  if (primary === undefined) {
    return undefined;
  }
  return {
    path,
    distance: 1,
    relationshipPath: [primary.to, path],
    pathEdges: [primary],
    pathEvidence: primary.evidence,
    directLinks: [...links].sort(compareLinkOrder),
  };
}

/**
 * Finds the files that depend directly on any changed file.
 *
 *  - A changed file is never reported as affected, even if it depends on
 *    another changed file.
 *  - Each affected file appears once. If it links to several changed files,
 *    all the links are in `directLinks`, and the relationship path uses the
 *    best one (see compareLinkPreference).
 *  - A changed file that is not in the graph simply has no known dependants.
 *
 * `changedTargets` must already be normalised (see resolveChangedTargets).
 * The result is sorted by path.
 */
export function findDirectDependants(
  graph: DependencyGraph,
  changedTargets: readonly string[],
): ImpactTrace[] {
  const changed = new Set(changedTargets);
  const linksByDependant = new Map<string, DependencyEdge[]>();

  for (const target of changed) {
    for (const edge of dependantEdgesOf(graph, target)) {
      if (changed.has(edge.from)) {
        continue;
      }
      const links = linksByDependant.get(edge.from);
      if (links === undefined) {
        linksByDependant.set(edge.from, [edge]);
      } else {
        links.push(edge);
      }
    }
  }

  const traces: ImpactTrace[] = [];
  for (const [path, links] of linksByDependant) {
    const trace = directTrace(path, links);
    if (trace !== undefined) {
      traces.push(trace);
    }
  }
  return traces.sort((a, b) => compareStrings(a.path, b.path));
}

// ───────────────────────── Bounded traversal ─────────────────────────

/** Files more than this many hops from a changed file are not reported. */
export const DEFAULT_MAX_DEPTH = 2;
/** At most this many affected files are collected before the analysis stops. */
export const DEFAULT_MAX_VISITED_FILES = 500;

export interface TraversalOptions {
  /** Maximum hops from a changed file. A positive integer. Default 2. */
  maxDepth?: number;
  /**
   * Maximum number of affected files to collect. A positive integer.
   * Default 500. The changed files themselves do not count towards it.
   */
  maxVisitedFiles?: number;
  /** Checked before each file is expanded; an aborted signal stops the walk. */
  signal?: AbortSignal;
}

/** Why the traversal ended. Anything but "completed" means partial results. */
export type TraversalStop = 'completed' | 'visit_cap' | 'aborted';

export interface TraversalResult {
  /** One trace per affected file, sorted by path. */
  readonly traces: readonly ImpactTrace[];
  /** The depth actually used, after validation. */
  readonly maxDepth: number;
  /** The cap actually used, after validation. */
  readonly maxVisitedFiles: number;
  readonly stoppedBy: TraversalStop;
  /** True when the cap was hit or the signal was aborted. */
  readonly incomplete: boolean;
  readonly warnings: readonly string[];
}

/** How one file was first reached during a walk. */
interface Step {
  readonly parent: string;
  readonly edge: DependencyEdge;
  readonly distance: number;
}

interface Walk {
  readonly steps: Map<string, Step>;
  readonly stoppedBy: TraversalStop;
}

interface WalkLimits {
  readonly observedOnly: boolean;
  readonly maxDepth: number;
  readonly signal: AbortSignal | undefined;
  /** How many new files this walk may still collect. */
  readonly budget: number;
  /** Files already collected by an earlier walk; they cost nothing here. */
  readonly alreadyCollected: ReadonlyMap<string, Step>;
}

const NOTHING_COLLECTED: ReadonlyMap<string, Step> = new Map();

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
  warnings: string[],
): number {
  if (value === undefined) {
    return fallback;
  }
  if (Number.isInteger(value) && value >= 1) {
    return value;
  }
  warnings.push(`Invalid ${name} (${String(value)}); using the default of ${fallback}.`);
  return fallback;
}

/**
 * The best link from each dependant of one file: observed before inferred,
 * then by kind. `edges` is sorted by `from`, so the result is too.
 */
function bestLinkPerDependant(
  edges: readonly DependencyEdge[],
  observedOnly: boolean,
): DependencyEdge[] {
  const best = new Map<string, DependencyEdge>();
  for (const edge of edges) {
    if (observedOnly && edge.evidence !== 'observed') {
      continue;
    }
    const current = best.get(edge.from);
    if (current === undefined || compareLinkPreference(edge, current) < 0) {
      best.set(edge.from, edge);
    }
  }
  return [...best.values()];
}

/**
 * Breadth-first walk from the changed files along "who depends on this".
 *
 *  - Level by level, so the first time a file is reached is by a shortest path.
 *  - Each level is expanded in path order, so ties between equally short paths
 *    always resolve the same way.
 *  - The visited set starts with the changed files: cycles terminate, and a
 *    changed file is never collected.
 */
function walk(graph: DependencyGraph, targets: readonly string[], limits: WalkLimits): Walk {
  const steps = new Map<string, Step>();
  const visited = new Set<string>(targets);
  let used = 0;
  let frontier: readonly string[] = targets;

  for (let distance = 1; distance <= limits.maxDepth && frontier.length > 0; distance += 1) {
    const next: string[] = [];
    for (const parent of frontier) {
      if (limits.signal?.aborted === true) {
        return { steps, stoppedBy: 'aborted' };
      }
      const links = bestLinkPerDependant(dependantEdgesOf(graph, parent), limits.observedOnly);
      for (const edge of links) {
        const file = edge.from;
        if (visited.has(file)) {
          continue;
        }
        if (!limits.alreadyCollected.has(file)) {
          if (used >= limits.budget) {
            return { steps, stoppedBy: 'visit_cap' };
          }
          used += 1;
        }
        visited.add(file);
        steps.set(file, { parent, edge, distance });
        next.push(file);
      }
    }
    frontier = next.sort(compareStrings);
  }
  return { steps, stoppedBy: 'completed' };
}

/** Follows the steps back from a file to the changed file it was reached from. */
function buildTrace(
  file: string,
  steps: ReadonlyMap<string, Step>,
  changed: ReadonlySet<string>,
  graph: DependencyGraph,
): ImpactTrace {
  const reversedPath: string[] = [file];
  const reversedEdges: DependencyEdge[] = [];
  let step = steps.get(file);
  while (step !== undefined) {
    reversedEdges.push(step.edge);
    reversedPath.push(step.parent);
    step = steps.get(step.parent);
  }
  const pathEdges = reversedEdges.reverse();
  return {
    path: file,
    distance: pathEdges.length,
    relationshipPath: reversedPath.reverse(),
    pathEdges,
    pathEvidence: pathEdges.every((edge) => edge.evidence === 'observed') ? 'observed' : 'inferred',
    directLinks: dependencyEdgesOf(graph, file).filter((edge) => changed.has(edge.to)),
  };
}

function stopWarning(stoppedBy: TraversalStop, maxVisitedFiles: number): string | undefined {
  switch (stoppedBy) {
    case 'visit_cap':
      return (
        `Stopped after reaching the limit of ${maxVisitedFiles} affected files; ` +
        'more files may be affected.'
      );
    case 'aborted':
      return 'Analysis was cancelled before it finished; the results are partial.';
    case 'completed':
      return undefined;
  }
}

/**
 * Finds every file that depends on a changed file within `maxDepth` hops.
 *
 * Which path is reported for a file:
 *  1. the shortest path made only of observed edges, if one exists within
 *     `maxDepth`;
 *  2. otherwise the shortest path of any evidence, which then contains at
 *     least one inferred edge and is marked "inferred".
 *
 * So observed evidence always wins over a shorter inferred shortcut. This is
 * done with two walks: observed edges only, then all edges. A file found by
 * the first walk keeps that trace.
 *
 * Limits:
 *  - `maxDepth` bounds the hops. Stopping at the depth limit is by design and
 *    does not make the result incomplete.
 *  - `maxVisitedFiles` bounds the number of affected files. Hitting it stops
 *    the walk, sets `incomplete` and adds a warning. Nearer files and observed
 *    links are collected first, so those are the ones kept.
 *  - An aborted signal stops the walk the same way. Nothing is thrown.
 *
 * `changedTargets` must already be normalised (see resolveChangedTargets).
 */
export function traceImpact(
  graph: DependencyGraph,
  changedTargets: readonly string[],
  options: TraversalOptions = {},
): TraversalResult {
  const warnings: string[] = [];
  const maxDepth = positiveInteger(options.maxDepth, DEFAULT_MAX_DEPTH, 'maxDepth', warnings);
  const maxVisitedFiles = positiveInteger(
    options.maxVisitedFiles,
    DEFAULT_MAX_VISITED_FILES,
    'maxVisitedFiles',
    warnings,
  );
  const targets = [...new Set(changedTargets)].sort(compareStrings);
  const changed: ReadonlySet<string> = new Set(targets);
  const { signal } = options;

  const observed = walk(graph, targets, {
    observedOnly: true,
    maxDepth,
    signal,
    budget: maxVisitedFiles,
    alreadyCollected: NOTHING_COLLECTED,
  });
  const traces: ImpactTrace[] = [];
  for (const file of observed.steps.keys()) {
    traces.push(buildTrace(file, observed.steps, changed, graph));
  }

  let stoppedBy = observed.stoppedBy;
  if (stoppedBy === 'completed') {
    const any = walk(graph, targets, {
      observedOnly: false,
      maxDepth,
      signal,
      budget: maxVisitedFiles - observed.steps.size,
      alreadyCollected: observed.steps,
    });
    for (const file of any.steps.keys()) {
      if (!observed.steps.has(file)) {
        traces.push(buildTrace(file, any.steps, changed, graph));
      }
    }
    stoppedBy = any.stoppedBy;
  }

  const warning = stopWarning(stoppedBy, maxVisitedFiles);
  if (warning !== undefined) {
    warnings.push(warning);
  }
  return {
    traces: traces.sort((a, b) => compareStrings(a.path, b.path)),
    maxDepth,
    maxVisitedFiles,
    stoppedBy,
    incomplete: stoppedBy !== 'completed',
    warnings,
  };
}
