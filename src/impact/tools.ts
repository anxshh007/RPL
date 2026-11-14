/**
 * ImpactLens: tool handlers for the MCP layer.
 *
 * Two read-only tools, named in src/mcp/tool-names.ts:
 *  - analyse_impact    returns the full ImpactReport;
 *  - get_impact_graph  returns only the graph data (nodes and edges).
 *
 * This file exports plain functions and plain descriptions. It does not
 * register anything and does not import any MCP SDK: the agent module's owner
 * registers the handlers in src/mcp/ (docs/DECISIONS.md D-07).
 *
 * A handler never throws. It resolves to
 *   { ok: true, value }    on success, or
 *   { ok: false, error }   with a SafeError (src/shared/contracts/errors.ts).
 *
 * What counts as an error, and what does not:
 *  - Input of the wrong shape (a missing field, a wrong type) is a
 *    "validation" error.
 *  - Content the analyser can work around (a bad path, a malformed edge) is
 *    not an error: the report is returned with warnings.
 *  - A signal that is already aborted is a "cancelled" error.
 */
import { TOOL_NAMES } from '../mcp/tool-names';
import type { ToolName } from '../mcp/tool-names';
import { RepoPilotError, toSafeError } from '../shared/contracts';
import type {
  ChangeRequest,
  GraphEdge,
  GraphNode,
  ImpactAnalyser,
  ImpactReport,
  RepositoryContext,
  SafeError,
} from '../shared/contracts';
import { createImpactAnalyser } from './index';

// ───────────────────────────── Shapes ─────────────────────────────

/** Input of both tools. */
export interface AnalyseImpactInput {
  request: ChangeRequest;
  context: RepositoryContext;
  /** When non-empty, these replace the request's active file and mentions. */
  proposedFiles?: string[];
}

export type GetImpactGraphInput = AnalyseImpactInput;

/** Output of get_impact_graph: the graph part of an ImpactReport. */
export interface ImpactGraphResult {
  requestId: string;
  generatedAt: string;
  changedTargets: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
  /** Same meaning as ImpactReport.summary.incomplete. */
  incomplete: boolean;
}

export type ToolResult<T> = { ok: true; value: T } | { ok: false; error: SafeError };

// ─────────────────────────── Descriptions ───────────────────────────

const STRING_LIST = { type: 'array', items: { type: 'string' } } as const;

/**
 * The input both tools accept, as a JSON Schema object. It mirrors
 * ChangeRequest and RepositoryContext in src/shared/contracts; of the context,
 * only the fields ImpactLens reads are listed.
 */
export const IMPACT_TOOL_INPUT_SCHEMA = {
  type: 'object',
  required: ['request', 'context'],
  properties: {
    request: {
      type: 'object',
      description: 'The ChangeRequest being handled.',
      required: ['requestId', 'instruction', 'mode', 'explicitFileMentions', 'explicitSymbolMentions'],
      properties: {
        requestId: { type: 'string' },
        instruction: { type: 'string' },
        mode: { type: 'string', enum: ['inline', 'agent'] },
        activeFile: { type: 'string', description: 'Workspace-relative POSIX path.' },
        explicitFileMentions: STRING_LIST,
        explicitSymbolMentions: STRING_LIST,
      },
    },
    context: {
      type: 'object',
      description:
        'The RepositoryContext from the repository module. ImpactLens reads requestId, ' +
        'dependencyEdges and unresolvedImports.',
      required: ['requestId', 'dependencyEdges', 'unresolvedImports'],
      properties: {
        requestId: { type: 'string' },
        dependencyEdges: {
          type: 'array',
          description: 'Each edge means "from depends on to".',
          items: {
            type: 'object',
            required: ['from', 'to', 'kind', 'evidence'],
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              kind: { type: 'string', enum: ['imports', 'references', 'tests'] },
              evidence: { type: 'string', enum: ['observed', 'inferred'] },
            },
          },
        },
        unresolvedImports: {
          type: 'array',
          items: {
            type: 'object',
            required: ['file', 'module'],
            properties: { file: { type: 'string' }, module: { type: 'string' } },
          },
        },
      },
    },
    proposedFiles: {
      ...STRING_LIST,
      description:
        'Workspace-relative POSIX paths of the files the plan proposes to change. When non-empty, ' +
        'they replace the active file and file mentions of the request.',
    },
  },
} as const;

export interface ImpactToolDefinition {
  readonly name: ToolName;
  /** For the model: what the tool does and when to call it. */
  readonly description: string;
  /** Both tools only read their input. Nothing is edited, run or fetched. */
  readonly readOnly: true;
  readonly inputSchema: typeof IMPACT_TOOL_INPUT_SCHEMA;
  /** What a successful call returns. */
  readonly outputDescription: string;
}

export const IMPACT_TOOL_DEFINITIONS: readonly ImpactToolDefinition[] = Object.freeze([
  {
    name: TOOL_NAMES.analyseImpact,
    description:
      'Estimates which files may be affected if the given files change, and why. Read-only ' +
      'static analysis of the dependency edges in the repository context; it does not prove ' +
      'runtime impact. Call it before planning, and again with proposedFiles once a plan exists.',
    readOnly: true,
    inputSchema: IMPACT_TOOL_INPUT_SCHEMA,
    outputDescription:
      'An ImpactReport (src/shared/contracts): changedTargets, affectedFiles (each with risk, ' +
      'reasons, relationshipPath, confidence and matchedRule), testCandidates, nodes, edges, ' +
      'summary, warnings and limitations.',
  },
  {
    name: TOOL_NAMES.getImpactGraph,
    description:
      'Returns the impact graph for the given files: nodes (changed and affected files) and the ' +
      'edges between them, capped for display. Same analysis and input as analyse_impact, ' +
      'without the per-file explanations.',
    readOnly: true,
    inputSchema: IMPACT_TOOL_INPUT_SCHEMA,
    outputDescription:
      'requestId, generatedAt, changedTargets, nodes (id, label, kind, path, highlight, risk), ' +
      'edges (id, source, target, kind, evidence), warnings and incomplete.',
  },
]);

// ─────────────────────────── Validation ───────────────────────────

// TODO(zod): replace this structural check with the shared Zod schemas once
// src/shared/contracts/schemas.ts exists (docs/DECISIONS.md D-11).

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function checkRequest(request: unknown, problems: string[]): void {
  if (!isRecord(request)) {
    problems.push('request must be an object');
    return;
  }
  if (typeof request.requestId !== 'string' || request.requestId.trim() === '') {
    problems.push('request.requestId must be a non-empty string');
  }
  if (typeof request.instruction !== 'string') {
    problems.push('request.instruction must be a string');
  }
  if (request.mode !== 'inline' && request.mode !== 'agent') {
    problems.push('request.mode must be "inline" or "agent"');
  }
  if (request.activeFile !== undefined && typeof request.activeFile !== 'string') {
    problems.push('request.activeFile must be a string when present');
  }
  if (!isStringList(request.explicitFileMentions)) {
    problems.push('request.explicitFileMentions must be an array of strings');
  }
  if (!isStringList(request.explicitSymbolMentions)) {
    problems.push('request.explicitSymbolMentions must be an array of strings');
  }
}

function checkContext(context: unknown, problems: string[]): void {
  if (!isRecord(context)) {
    problems.push('context must be an object');
    return;
  }
  if (typeof context.requestId !== 'string') {
    problems.push('context.requestId must be a string');
  }
  if (!Array.isArray(context.dependencyEdges)) {
    problems.push('context.dependencyEdges must be an array');
  }
  if (!Array.isArray(context.unresolvedImports)) {
    problems.push('context.unresolvedImports must be an array');
  }
}

/**
 * Checks the shape of a tool input. The message names the fields that are
 * wrong and never echoes their values.
 */
export function validateImpactToolInput(
  toolName: ToolName,
  input: unknown,
): ToolResult<AnalyseImpactInput> {
  const problems: string[] = [];
  if (!isRecord(input)) {
    problems.push('input must be an object with "request" and "context"');
  } else {
    checkRequest(input.request, problems);
    checkContext(input.context, problems);
    if (input.proposedFiles !== undefined && !isStringList(input.proposedFiles)) {
      problems.push('proposedFiles must be an array of strings when present');
    }
  }
  if (problems.length > 0 || !isRecord(input)) {
    const error = new RepoPilotError(
      'validation',
      `Invalid input for ${toolName}: ${problems.join('; ')}.`,
    );
    return { ok: false, error: error.toSafe() };
  }
  // The checks above establish these shapes; entries inside the lists are
  // left to the analyser, which reports bad ones as warnings.
  const value: AnalyseImpactInput = {
    request: input.request as ChangeRequest,
    context: input.context as RepositoryContext,
  };
  if (isStringList(input.proposedFiles)) {
    value.proposedFiles = input.proposedFiles;
  }
  return { ok: true, value };
}

// ───────────────────────────── Handlers ─────────────────────────────

async function run<T>(
  toolName: ToolName,
  analyser: ImpactAnalyser,
  input: unknown,
  signal: AbortSignal | undefined,
  project: (report: ImpactReport) => T,
): Promise<ToolResult<T>> {
  try {
    if (signal?.aborted === true) {
      return { ok: false, error: new RepoPilotError('cancelled', 'Request cancelled.').toSafe() };
    }
    const parsed = validateImpactToolInput(toolName, input);
    if (!parsed.ok) {
      return parsed;
    }
    const { request, context, proposedFiles } = parsed.value;
    const report = await analyser.analyseImpact(request, context, proposedFiles, signal);
    return { ok: true, value: project(report) };
  } catch (error) {
    return { ok: false, error: toSafeError(error) };
  }
}

function toGraphResult(report: ImpactReport): ImpactGraphResult {
  return {
    requestId: report.requestId,
    generatedAt: report.generatedAt,
    changedTargets: report.changedTargets,
    nodes: report.nodes,
    edges: report.edges,
    warnings: report.warnings,
    incomplete: report.summary.incomplete,
  };
}

/** Handler for the `analyse_impact` tool. */
export function handleAnalyseImpact(
  analyser: ImpactAnalyser,
  input: unknown,
  signal?: AbortSignal,
): Promise<ToolResult<ImpactReport>> {
  return run(TOOL_NAMES.analyseImpact, analyser, input, signal, (report) => report);
}

/** Handler for the `get_impact_graph` tool. */
export function handleGetImpactGraph(
  analyser: ImpactAnalyser,
  input: unknown,
  signal?: AbortSignal,
): Promise<ToolResult<ImpactGraphResult>> {
  return run(TOOL_NAMES.getImpactGraph, analyser, input, signal, toGraphResult);
}

/**
 * Both handlers bound to one analyser and keyed by tool name, ready to be
 * registered. Pass the same analyser the agent uses so they share its graph
 * cache; with no argument a new analyser is created.
 */
export function createImpactToolHandlers(analyser: ImpactAnalyser = createImpactAnalyser()): {
  [TOOL_NAMES.analyseImpact]: (
    input: unknown,
    signal?: AbortSignal,
  ) => Promise<ToolResult<ImpactReport>>;
  [TOOL_NAMES.getImpactGraph]: (
    input: unknown,
    signal?: AbortSignal,
  ) => Promise<ToolResult<ImpactGraphResult>>;
} {
  return {
    [TOOL_NAMES.analyseImpact]: (input, signal) => handleAnalyseImpact(analyser, input, signal),
    [TOOL_NAMES.getImpactGraph]: (input, signal) => handleGetImpactGraph(analyser, input, signal),
  };
}
