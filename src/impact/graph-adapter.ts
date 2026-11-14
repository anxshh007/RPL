/**
 * ImpactLens: graph data for the UI.
 *
 * Turns the analysis into the nodes and edges of the shared contract, ready
 * for a graph view (React Flow uses `source` and `target`).
 *
 *  - Node id is the file path. Edge id is `${source}→${target}:${kind}`.
 *  - An edge runs from the dependant (`source`) to what it depends on
 *    (`target`), the same direction as a repository edge's `from` and `to`.
 *  - Nodes are the changed files, the affected files, and any other file that
 *    lies on a relationship path. Edges are every known link between them.
 *  - The graph is capped (50 nodes by default): changed files first, then
 *    affected files from highest risk down. Trimming adds a warning. It never
 *    removes anything from `affectedFiles`.
 *
 * Output is semantic only: `highlight`, `risk`, `kind` and `evidence`. There
 * are no colours, styles or layout here. The UI maps these values to its own
 * theme.
 *
 * Pure logic: no file access, no network, no mutation of the input.
 */
import type { AffectedFile, GraphEdge, GraphNode } from '../shared/contracts';
import { compareStrings } from './dependency-graph';
import type { DependencyGraph } from './dependency-graph';
import { isTestFile } from './impact-rules';

/** The graph shows at most this many nodes unless configured otherwise. */
export const DEFAULT_MAX_GRAPH_NODES = 50;

export interface ImpactGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Set when the graph was trimmed or a limit was invalid. */
  warnings: string[];
}

export interface GraphAdapterInput {
  readonly graph: DependencyGraph;
  /** Normalised changed files. */
  readonly changedTargets: readonly string[];
  /** In report order: highest risk first. That order decides what survives the cap. */
  readonly affectedFiles: readonly AffectedFile[];
  /** A positive integer. Default 50. */
  readonly maxNodes?: number;
}

/** Stable edge id: `${source}→${target}:${kind}`. */
export function edgeId(source: string, target: string, kind: GraphEdge['kind']): string {
  return `${source}→${target}:${kind}`;
}

function labelOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function toNode(
  path: string,
  highlight: GraphNode['highlight'],
  risk?: GraphNode['risk'],
): GraphNode {
  const node: GraphNode = {
    id: path,
    label: labelOf(path),
    kind: isTestFile(path) ? 'test' : 'file',
    path,
    highlight,
  };
  if (risk !== undefined) {
    node.risk = risk;
  }
  return node;
}

/**
 * Every node in priority order: changed files, then affected files as given,
 * then other files that lie on a relationship path.
 */
function orderedNodes(input: GraphAdapterInput): GraphNode[] {
  const nodes = new Map<string, GraphNode>();

  for (const path of [...new Set(input.changedTargets)].sort(compareStrings)) {
    nodes.set(path, toNode(path, 'changed'));
  }
  for (const file of input.affectedFiles) {
    if (!nodes.has(file.path)) {
      nodes.set(file.path, toNode(file.path, 'affected', file.risk));
    }
  }
  const onPaths = new Set(input.affectedFiles.flatMap((file) => file.relationshipPath));
  for (const path of [...onPaths].sort(compareStrings)) {
    if (!nodes.has(path)) {
      nodes.set(path, toNode(path, 'none'));
    }
  }
  return [...nodes.values()];
}

function resolveMaxNodes(value: number | undefined, warnings: string[]): number {
  if (value === undefined) {
    return DEFAULT_MAX_GRAPH_NODES;
  }
  if (Number.isInteger(value) && value >= 1) {
    return value;
  }
  warnings.push(
    `Invalid maxGraphNodes (${String(value)}); using the default of ${DEFAULT_MAX_GRAPH_NODES}.`,
  );
  return DEFAULT_MAX_GRAPH_NODES;
}

/** Builds the capped, deterministic node and edge lists for one report. */
export function buildGraphData(input: GraphAdapterInput): ImpactGraphData {
  const warnings: string[] = [];
  const maxNodes = resolveMaxNodes(input.maxNodes, warnings);

  const all = orderedNodes(input);
  const nodes = all.slice(0, maxNodes);
  if (all.length > nodes.length) {
    warnings.push(
      `The impact graph is limited to ${maxNodes} files and shows ${nodes.length} of ${all.length}; ` +
        'affectedFiles lists them all.',
    );
  }

  const shown = new Set(nodes.map((node) => node.id));
  // graph.edges is already sorted by from, to and kind, and has no duplicates.
  const edges = input.graph.edges
    .filter((edge) => shown.has(edge.from) && shown.has(edge.to))
    .map((edge) => ({
      id: edgeId(edge.from, edge.to, edge.kind),
      source: edge.from,
      target: edge.to,
      kind: edge.kind,
      evidence: edge.evidence,
    }));

  return { nodes, edges, warnings };
}
