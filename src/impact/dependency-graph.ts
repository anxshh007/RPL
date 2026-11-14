/**
 * ImpactLens: dependency graph normalisation.
 *
 * Turns the raw edges supplied by the repository module into a clean graph:
 *  - every path is a workspace-relative POSIX path with no leading "./";
 *  - absolute paths and paths containing ".." are rejected, never followed;
 *  - duplicate edges collapse to one (an observed copy beats an inferred one);
 *  - forward and reverse maps are built (the reverse map answers
 *    "who depends on X?");
 *  - unresolved imports and rejected paths are kept aside and reported as
 *    warnings instead of being dropped silently;
 *  - output order never depends on input order.
 *
 * Pure logic: no file access, no network, no mutation of the input.
 */
import type { DependencyEdge, Evidence, UnresolvedImport } from '../shared/contracts';

/** At most this many detailed warning lines per category; the rest are counted. */
export const MAX_DETAILED_WARNINGS = 10;

// ───────────────────────────── Paths ─────────────────────────────

export type PathRejectionReason = 'not_a_string' | 'empty' | 'absolute' | 'parent_segment';

export type PathResult =
  | { ok: true; path: string }
  | { ok: false; reason: PathRejectionReason };

/**
 * Normalises one path, or says why it is rejected.
 *
 * Accepted input is tidied: "\" becomes "/", repeated slashes collapse, and
 * "." segments (including a leading "./") and a trailing slash are removed.
 * Case is preserved.
 *
 * Rejected: non-strings, empty paths, absolute paths (a leading slash, a UNC
 * prefix or a drive letter) and any path with a ".." segment.
 */
export function normalisePath(raw: unknown): PathResult {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'not_a_string' };
  }
  const posix = raw.replace(/\\/g, '/');
  if (posix.trim() === '') {
    return { ok: false, reason: 'empty' };
  }
  if (posix.startsWith('/') || /^[A-Za-z]:/.test(posix)) {
    return { ok: false, reason: 'absolute' };
  }
  const segments = posix.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) {
    return { ok: false, reason: 'parent_segment' };
  }
  if (segments.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  return { ok: true, path: segments.join('/') };
}

/** Plain-English explanation of a rejection, for warnings. */
export function describeRejection(reason: PathRejectionReason): string {
  switch (reason) {
    case 'not_a_string':
      return 'the path is not a string';
    case 'empty':
      return 'the path is empty';
    case 'absolute':
      return 'absolute paths are not allowed';
    case 'parent_segment':
      return 'paths containing ".." are not allowed';
  }
}

// ───────────────────────────── Graph ─────────────────────────────

export interface RejectedPath {
  /** The path as it was supplied (or "<type>" when it was not a string). */
  readonly path: string;
  readonly reason: PathRejectionReason;
  /** Where the path came from. */
  readonly source: 'dependency_edge' | 'unresolved_import';
  /** How many edges or unresolved imports were ignored because of it. */
  readonly occurrences: number;
}

export interface DependencyGraph {
  /** Every file that appears in an accepted edge, sorted. */
  readonly files: readonly string[];
  /** Accepted edges, deduplicated, sorted by from, then to, then kind. */
  readonly edges: readonly DependencyEdge[];
  /** file → edges where it is `from`: what the file depends on. Sorted by `to`. */
  readonly forward: ReadonlyMap<string, readonly DependencyEdge[]>;
  /** file → edges where it is `to`: who depends on the file. Sorted by `from`. */
  readonly reverse: ReadonlyMap<string, readonly DependencyEdge[]>;
  /** Deduplicated, with normalised file paths, sorted by file then module. */
  readonly unresolvedImports: readonly UnresolvedImport[];
  /** Sorted by source, then path. */
  readonly rejectedPaths: readonly RejectedPath[];
  /** Plain-English warnings in a fixed order. */
  readonly warnings: readonly string[];
}

/** The part of RepositoryContext the graph is built from. */
export interface GraphSource {
  dependencyEdges?: readonly DependencyEdge[] | null;
  unresolvedImports?: readonly UnresolvedImport[] | null;
}

const EDGE_KINDS: ReadonlySet<string> = new Set<DependencyEdge['kind']>([
  'imports',
  'references',
  'tests',
]);
const EVIDENCE_VALUES: ReadonlySet<string> = new Set<Evidence>(['observed', 'inferred']);
const NO_EDGES: readonly DependencyEdge[] = Object.freeze([]);
const KEY_SEPARATOR = '\u0000';

/** Locale-independent ordering, so results are the same on every machine. */
export function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEdgeKind(value: unknown): value is DependencyEdge['kind'] {
  return typeof value === 'string' && EDGE_KINDS.has(value);
}

function isEvidence(value: unknown): value is Evidence {
  return typeof value === 'string' && EVIDENCE_VALUES.has(value);
}

/** A path as supplied, for warnings: the string itself, or "<type>" for a non-string. */
export function displayPath(raw: unknown): string {
  return typeof raw === 'string' ? raw : `<${raw === null ? 'null' : typeof raw}>`;
}

function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

interface MutableRejectedPath {
  path: string;
  reason: PathRejectionReason;
  source: RejectedPath['source'];
  occurrences: number;
}

/** Working state while one graph is being built. */
interface BuildState {
  readonly rejected: Map<string, MutableRejectedPath>;
  malformedEdges: number;
  selfEdges: number;
  malformedUnresolved: number;
  readonly structural: string[];
}

function recordRejection(
  state: BuildState,
  source: RejectedPath['source'],
  raw: unknown,
  reason: PathRejectionReason,
): void {
  const path = displayPath(raw);
  const key = [source, path, reason].join(KEY_SEPARATOR);
  const existing = state.rejected.get(key);
  if (existing === undefined) {
    state.rejected.set(key, { path, reason, source, occurrences: 1 });
  } else {
    existing.occurrences += 1;
  }
}

function toList(value: unknown, label: string, state: BuildState): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  state.structural.push(`${label} is missing or not a list; treated as empty.`);
  return [];
}

/** Validates, normalises and deduplicates edges. Keyed by from, to and kind. */
function collectEdges(rawEdges: readonly unknown[], state: BuildState): DependencyEdge[] {
  const byKey = new Map<string, DependencyEdge>();
  for (const raw of rawEdges) {
    if (!isRecord(raw) || !isEdgeKind(raw.kind) || !isEvidence(raw.evidence)) {
      state.malformedEdges += 1;
      continue;
    }
    const from = normalisePath(raw.from);
    const to = normalisePath(raw.to);
    if (!from.ok || !to.ok) {
      if (!from.ok) {
        recordRejection(state, 'dependency_edge', raw.from, from.reason);
      }
      if (!to.ok && !(!from.ok && raw.to === raw.from)) {
        recordRejection(state, 'dependency_edge', raw.to, to.reason);
      }
      continue;
    }
    if (from.path === to.path) {
      state.selfEdges += 1;
      continue;
    }
    const key = [from.path, to.path, raw.kind].join(KEY_SEPARATOR);
    const existing = byKey.get(key);
    // The same link reported twice keeps the stronger evidence.
    if (existing === undefined || (existing.evidence === 'inferred' && raw.evidence === 'observed')) {
      byKey.set(key, { from: from.path, to: to.path, kind: raw.kind, evidence: raw.evidence });
    }
  }
  return [...byKey.values()].sort(
    (a, b) =>
      compareStrings(a.from, b.from) || compareStrings(a.to, b.to) || compareStrings(a.kind, b.kind),
  );
}

function collectUnresolved(rawImports: readonly unknown[], state: BuildState): UnresolvedImport[] {
  const byKey = new Map<string, UnresolvedImport>();
  for (const raw of rawImports) {
    if (!isRecord(raw) || typeof raw.module !== 'string' || raw.module.trim() === '') {
      state.malformedUnresolved += 1;
      continue;
    }
    const file = normalisePath(raw.file);
    if (!file.ok) {
      recordRejection(state, 'unresolved_import', raw.file, file.reason);
      continue;
    }
    byKey.set([file.path, raw.module].join(KEY_SEPARATOR), { file: file.path, module: raw.module });
  }
  return [...byKey.values()].sort(
    (a, b) => compareStrings(a.file, b.file) || compareStrings(a.module, b.module),
  );
}

function sortRejected(state: BuildState): RejectedPath[] {
  return [...state.rejected.values()].sort(
    (a, b) =>
      compareStrings(a.source, b.source) ||
      compareStrings(a.path, b.path) ||
      compareStrings(a.reason, b.reason),
  );
}

/**
 * Keeps the first MAX_DETAILED_WARNINGS lines and counts the rest.
 * `singular` and `plural` name what one hidden line stands for.
 */
function capped(lines: readonly string[], singular: string, plural: string): string[] {
  if (lines.length <= MAX_DETAILED_WARNINGS) {
    return [...lines];
  }
  const hidden = lines.length - MAX_DETAILED_WARNINGS;
  return [
    ...lines.slice(0, MAX_DETAILED_WARNINGS),
    `${hidden} more ${hidden === 1 ? singular : plural} not listed.`,
  ];
}

function rejectionWarnings(rejected: readonly RejectedPath[], source: RejectedPath['source']): string[] {
  const noun = source === 'dependency_edge' ? 'dependency edge' : 'unresolved import';
  const lines = rejected
    .filter((entry) => entry.source === source)
    .map(
      (entry) =>
        `Ignored ${countOf(entry.occurrences, noun)} with path "${entry.path}": ` +
        `${describeRejection(entry.reason)}.`,
    );
  return capped(lines, `rejected ${noun} path`, `rejected ${noun} paths`);
}

function unresolvedWarnings(unresolved: readonly UnresolvedImport[]): string[] {
  const modulesByFile = new Map<string, string[]>();
  for (const { file, module } of unresolved) {
    const modules = modulesByFile.get(file);
    if (modules === undefined) {
      modulesByFile.set(file, [module]);
    } else {
      modules.push(module);
    }
  }
  const lines = [...modulesByFile].map(([file, modules]) =>
    modules.length === 1
      ? `Unresolved import in ${file}: ${modules[0]} (impact through it is not analysed).`
      : `Unresolved imports in ${file}: ${modules.join(', ')} (impact through them is not analysed).`,
  );
  return capped(lines, 'file with unresolved imports', 'files with unresolved imports');
}

function buildWarnings(
  state: BuildState,
  rejected: readonly RejectedPath[],
  unresolved: readonly UnresolvedImport[],
): string[] {
  const warnings = [...state.structural, ...rejectionWarnings(rejected, 'dependency_edge')];
  if (state.malformedEdges > 0) {
    warnings.push(
      `Ignored ${countOf(state.malformedEdges, 'malformed dependency edge')} ` +
        '(not an object, or an invalid kind or evidence).',
    );
  }
  if (state.selfEdges > 0) {
    warnings.push(`Ignored ${countOf(state.selfEdges, 'dependency edge')} from a file to itself.`);
  }
  warnings.push(...rejectionWarnings(rejected, 'unresolved_import'));
  if (state.malformedUnresolved > 0) {
    warnings.push(
      `Ignored ${countOf(state.malformedUnresolved, 'malformed unresolved import')} ` +
        '(not an object, or no module name).',
    );
  }
  warnings.push(...unresolvedWarnings(unresolved));
  return warnings;
}

function buildMaps(
  files: readonly string[],
  edges: readonly DependencyEdge[],
): Pick<DependencyGraph, 'forward' | 'reverse'> {
  const forward = new Map<string, DependencyEdge[]>();
  const reverse = new Map<string, DependencyEdge[]>();
  for (const file of files) {
    forward.set(file, []);
    reverse.set(file, []);
  }
  // `edges` is sorted by from, to, kind, so each list comes out sorted too.
  for (const edge of edges) {
    forward.get(edge.from)?.push(edge);
    reverse.get(edge.to)?.push(edge);
  }
  return { forward, reverse };
}

/**
 * Builds the normalised graph from a repository context (or the part of one
 * that holds the edges). A missing source, a missing list or a bad entry
 * produces a warning, never an exception.
 */
export function buildDependencyGraph(source: GraphSource | null | undefined): DependencyGraph {
  const state: BuildState = {
    rejected: new Map(),
    malformedEdges: 0,
    selfEdges: 0,
    malformedUnresolved: 0,
    structural: [],
  };

  let rawEdges: readonly unknown[] = [];
  let rawUnresolved: readonly unknown[] = [];
  if (isRecord(source)) {
    rawEdges = toList(source.dependencyEdges, 'dependencyEdges', state);
    rawUnresolved = toList(source.unresolvedImports, 'unresolvedImports', state);
  } else {
    state.structural.push('Repository context is missing; the dependency graph is empty.');
  }

  const edges = collectEdges(rawEdges, state);
  const unresolvedImports = collectUnresolved(rawUnresolved, state);
  const rejectedPaths = sortRejected(state);
  const files = [...new Set(edges.flatMap((edge) => [edge.from, edge.to]))].sort(compareStrings);

  return {
    files,
    edges,
    ...buildMaps(files, edges),
    unresolvedImports,
    rejectedPaths,
    warnings: buildWarnings(state, rejectedPaths, unresolvedImports),
  };
}

// ──────────────────────────── Lookups ────────────────────────────

/** Edges from files that depend directly on `path`. Empty for an unknown file. */
export function dependantEdgesOf(graph: DependencyGraph, path: string): readonly DependencyEdge[] {
  return graph.reverse.get(path) ?? NO_EDGES;
}

/** Edges to the files that `path` depends on directly. Empty for an unknown file. */
export function dependencyEdgesOf(graph: DependencyGraph, path: string): readonly DependencyEdge[] {
  return graph.forward.get(path) ?? NO_EDGES;
}
