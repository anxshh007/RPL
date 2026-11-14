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
 * It also provides a small cache of built graphs (see GraphCache).
 *
 * Pure logic: no file access, no network, no mutation of the input.
 */
import type { DependencyEdge, Evidence, UnresolvedImport } from '../shared/contracts';

/** At most this many detailed warning lines per category; the rest are counted. */
export const MAX_DETAILED_WARNINGS = 10;

// ───────────────────────────── Paths ─────────────────────────────

export type PathRejectionReason =
  | 'not_a_string'
  | 'empty'
  | 'absolute'
  | 'parent_segment'
  | 'restricted';

/** Folders and files no module may touch (AGENTS.md, path safety). Compared in lower case. */
const RESTRICTED_SEGMENTS: ReadonlySet<string> = new Set(['.git', 'node_modules', '.env']);

/** True for anything inside .git or node_modules, and for .env and .env.* files. */
function isRestricted(segments: readonly string[]): boolean {
  const lower = segments.map((segment) => segment.toLowerCase());
  const basename = lower[lower.length - 1] ?? '';
  return lower.some((segment) => RESTRICTED_SEGMENTS.has(segment)) || basename.startsWith('.env.');
}

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
 * prefix or a drive letter), any path with a ".." segment, anything inside
 * .git or node_modules, and .env files.
 *
 * Symlink escapes cannot be checked here: this module never touches the disk.
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
  if (isRestricted(segments)) {
    return { ok: false, reason: 'restricted' };
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
    case 'restricted':
      return 'paths in .git or node_modules, and .env files, are not allowed';
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
  /**
   * True when part of the input was ignored: a missing list, a malformed
   * entry or a rejected path. Edges from a file to itself do not count.
   */
  readonly droppedInput: boolean;
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
    droppedInput:
      state.structural.length > 0 ||
      rejectedPaths.length > 0 ||
      state.malformedEdges > 0 ||
      state.malformedUnresolved > 0,
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

// ───────────────────────────── Cache ─────────────────────────────

/** A cache keeps at most this many graphs unless told otherwise. */
export const DEFAULT_GRAPH_CACHE_SIZE = 8;

/**
 * Remembers recently built graphs so that repeated calls with the same edges
 * do not rebuild them. The agent calls ImpactLens twice per request with the
 * same context (before planning, and again with the proposed files), so the
 * second call is a hit.
 *
 * The key is the content of the context's edge set, not the identity of the
 * object:
 *  - the same edges and unresolved imports in any order are a hit;
 *  - any difference in an edge, its kind or its evidence is a miss.
 * Because the key is the content, a stale graph can never be returned.
 * `invalidate` is therefore not needed for correctness. It exists to release
 * the graphs of files known to have changed.
 *
 * Limits: the key is a string about as large as the edge list, and the least
 * recently used graph is dropped when the cache is full. A context with a
 * missing list is built every time and never stored.
 */
export interface GraphCache {
  /** The graph for this source: from the cache, or built and remembered. */
  get(source: GraphSource | null | undefined): DependencyGraph;
  /**
   * Drops every cached graph that contains one of these files and returns how
   * many were dropped. Paths are normalised first; bad paths are ignored.
   * With no argument, drops everything.
   */
  invalidate(paths?: readonly string[]): number;
  /** Number of graphs currently held. */
  readonly size: number;
  /** Lookups since creation. A miss is a build. */
  stats(): { hits: number; misses: number };
}

/** A string field as itself; anything else as the label used in warnings. */
function keyField(value: unknown): unknown {
  return typeof value === 'string' ? value : [displayPath(value)];
}

function sortedKeyLines(entries: readonly unknown[], fields: readonly string[]): string {
  return entries
    .map((entry) =>
      isRecord(entry) ? JSON.stringify(fields.map((field) => keyField(entry[field]))) : '0',
    )
    .sort(compareStrings)
    .join('\n');
}

/**
 * The cache key for a source: one line per edge and per unresolved import,
 * sorted so that input order does not matter. Returns undefined when a list is
 * missing; such a source is not cached.
 */
export function graphCacheKey(source: GraphSource | null | undefined): string | undefined {
  if (!isRecord(source)) {
    return undefined;
  }
  const { dependencyEdges, unresolvedImports } = source;
  if (!Array.isArray(dependencyEdges) || !Array.isArray(unresolvedImports)) {
    return undefined;
  }
  return [
    sortedKeyLines(dependencyEdges, ['from', 'to', 'kind', 'evidence']),
    sortedKeyLines(unresolvedImports, ['file', 'module']),
  ].join('\n#\n');
}

interface CacheEntry {
  readonly graph: DependencyGraph;
  /** Every file the graph knows about, for invalidate. */
  readonly files: ReadonlySet<string>;
}

export function createGraphCache(maxEntries: number = DEFAULT_GRAPH_CACHE_SIZE): GraphCache {
  const limit = Number.isInteger(maxEntries) && maxEntries >= 1 ? maxEntries : DEFAULT_GRAPH_CACHE_SIZE;
  // A Map keeps insertion order, so the first key is the least recently used.
  const entries = new Map<string, CacheEntry>();
  let hits = 0;
  let misses = 0;

  function remember(key: string, graph: DependencyGraph): void {
    const files = new Set([...graph.files, ...graph.unresolvedImports.map((item) => item.file)]);
    entries.set(key, { graph, files });
    const oldest = entries.keys().next();
    if (entries.size > limit && oldest.done !== true) {
      entries.delete(oldest.value);
    }
  }

  return {
    get(source: GraphSource | null | undefined): DependencyGraph {
      const key = graphCacheKey(source);
      const cached = key === undefined ? undefined : entries.get(key);
      if (key !== undefined && cached !== undefined) {
        hits += 1;
        // Move to the end: most recently used.
        entries.delete(key);
        entries.set(key, cached);
        return cached.graph;
      }
      misses += 1;
      const graph = buildDependencyGraph(source);
      if (key !== undefined) {
        remember(key, graph);
      }
      return graph;
    },

    invalidate(paths?: readonly string[]): number {
      if (paths === undefined) {
        const dropped = entries.size;
        entries.clear();
        return dropped;
      }
      const targets = new Set<string>();
      for (const path of Array.isArray(paths) ? paths : []) {
        const result = normalisePath(path);
        if (result.ok) {
          targets.add(result.path);
        }
      }
      let dropped = 0;
      for (const [key, entry] of [...entries]) {
        if ([...targets].some((target) => entry.files.has(target))) {
          entries.delete(key);
          dropped += 1;
        }
      }
      return dropped;
    },

    get size(): number {
      return entries.size;
    },

    stats(): { hits: number; misses: number } {
      return { hits, misses };
    },
  };
}
