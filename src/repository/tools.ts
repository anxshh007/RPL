/**
 * Repository Intelligence: plain MCP tool handlers (Member 2).
 *
 * Four read-only tools, named in src/mcp/tool-names.ts:
 *  - search_workspace       finds code matching query text or regex patterns;
 *  - read_file              reads a bounded slice or full file from the workspace;
 *  - find_symbol            locates symbol declarations across workspace Python files;
 *  - get_repository_context assembles ranked, budgeted context for a ChangeRequest.
 *
 * Exported here as plain handler functions and descriptions; registered in
 * src/mcp/ by Member 1 (docs/DECISIONS.md D-07).
 *
 * A handler never throws. It resolves to:
 *   { ok: true, value }   on success, or
 *   { ok: false, error }  with a SafeError (src/shared/contracts/errors.ts).
 */

import { TOOL_NAMES } from '../mcp/tool-names';
import type { ToolName } from '../mcp/tool-names';
import { RepoPilotError, toSafeError } from '../shared/contracts';
import type {
  ChangeRequest,
  RepositoryContext,
  RepositoryIntelligence,
  SafeError,
  SearchResult,
  SymbolRecord,
} from '../shared/contracts';
import { createRepositoryIntelligence } from './index';

// ───────────────────────────── Shapes ─────────────────────────────

export interface SearchWorkspaceInput {
  query: string;
  limit?: number;
}

export interface ReadFileInput {
  filePath?: string;
  path?: string;
  startLine?: number;
  endLine?: number;
}

export interface ReadFileResult {
  filePath: string;
  content: string;
  startLine?: number;
  endLine?: number;
}

export interface FindSymbolInput {
  name: string;
  fileHint?: string;
}

export interface GetRepositoryContextInput {
  request: ChangeRequest;
}

export type ToolResult<T> = { ok: true; value: T } | { ok: false; error: SafeError };

// ─────────────────────────── Descriptions ───────────────────────────

const STRING_LIST = { type: 'array', items: { type: 'string' } } as const;

export const SEARCH_WORKSPACE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  required: ['query'],
  properties: {
    query: {
      type: 'string',
      description: 'The text or regex to search for in workspace files.',
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of matches to return (default 50, max 200).',
    },
  },
} as const;

export const READ_FILE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  required: ['filePath'],
  properties: {
    filePath: {
      type: 'string',
      description: 'Workspace-relative POSIX path to the file to read.',
    },
    startLine: {
      type: 'integer',
      description: '1-based starting line number (optional).',
    },
    endLine: {
      type: 'integer',
      description: '1-based ending line number (optional).',
    },
  },
} as const;

export const FIND_SYMBOL_TOOL_INPUT_SCHEMA = {
  type: 'object',
  required: ['name'],
  properties: {
    name: {
      type: 'string',
      description: 'The exact identifier or declaration name to look up.',
    },
    fileHint: {
      type: 'string',
      description: 'Optional workspace-relative file path hint to constrain search.',
    },
  },
} as const;

export const GET_REPOSITORY_CONTEXT_TOOL_INPUT_SCHEMA = {
  type: 'object',
  required: ['request'],
  properties: {
    request: {
      type: 'object',
      description: 'The ChangeRequest being analyzed.',
      required: ['requestId', 'instruction', 'mode', 'explicitFileMentions', 'explicitSymbolMentions'],
      properties: {
        requestId: { type: 'string' },
        instruction: { type: 'string' },
        mode: { type: 'string', enum: ['inline', 'agent'] },
        activeFile: { type: 'string', description: 'Workspace-relative POSIX path.' },
        selectedText: { type: 'string' },
        selectionRange: {
          type: 'object',
          properties: {
            startLine: { type: 'integer' },
            endLine: { type: 'integer' },
          },
        },
        explicitFileMentions: STRING_LIST,
        explicitSymbolMentions: STRING_LIST,
      },
    },
  },
} as const;

export interface RepositoryToolDefinition {
  readonly name: ToolName;
  readonly description: string;
  readonly inputSchema: object;
}

export const REPOSITORY_TOOL_DEFINITIONS: readonly RepositoryToolDefinition[] = [
  {
    name: TOOL_NAMES.searchWorkspace,
    description:
      'Search files across the workspace for matching text or regex patterns, respecting ignores and limits.',
    inputSchema: SEARCH_WORKSPACE_TOOL_INPUT_SCHEMA,
  },
  {
    name: TOOL_NAMES.readFile,
    description:
      'Read bounded text or a specific line range from a workspace-relative file.',
    inputSchema: READ_FILE_TOOL_INPUT_SCHEMA,
  },
  {
    name: TOOL_NAMES.findSymbol,
    description:
      'Find symbol declarations (functions, classes, methods) in workspace Python files.',
    inputSchema: FIND_SYMBOL_TOOL_INPUT_SCHEMA,
  },
  {
    name: TOOL_NAMES.getRepositoryContext,
    description:
      'Assemble relevant files, symbols, dependency edges, and token budget details for a ChangeRequest.',
    inputSchema: GET_REPOSITORY_CONTEXT_TOOL_INPUT_SCHEMA,
  },
] as const;

// ──────────────────────────── Validation ────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function validateSearchWorkspaceInput(
  input: unknown,
): ToolResult<SearchWorkspaceInput> {
  if (!isRecord(input) || typeof input.query !== 'string' || input.query.trim().length === 0) {
    return {
      ok: false,
      error: new RepoPilotError('validation', 'Input for search_workspace must include a non-empty "query" string.').toSafe(),
    };
  }
  if (input.limit !== undefined && (typeof input.limit !== 'number' || input.limit < 1)) {
    return {
      ok: false,
      error: new RepoPilotError('validation', 'Field "limit" for search_workspace must be a positive integer.').toSafe(),
    };
  }
  return {
    ok: true,
    value: {
      query: input.query,
      limit: input.limit as number | undefined,
    },
  };
}

export function validateReadFileInput(
  input: unknown,
): ToolResult<ReadFileInput & { resolvedPath: string }> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: new RepoPilotError('validation', 'Input for read_file must be an object.').toSafe(),
    };
  }
  const rawPath = typeof input.filePath === 'string'
    ? input.filePath
    : typeof input.path === 'string'
      ? input.path
      : undefined;
  if (!rawPath || rawPath.trim().length === 0) {
    return {
      ok: false,
      error: new RepoPilotError('validation', 'Input for read_file must include a non-empty "filePath".').toSafe(),
    };
  }
  if (input.startLine !== undefined && (typeof input.startLine !== 'number' || input.startLine < 1)) {
    return {
      ok: false,
      error: new RepoPilotError('validation', 'Field "startLine" must be a positive integer.').toSafe(),
    };
  }
  if (input.endLine !== undefined && (typeof input.endLine !== 'number' || input.endLine < 1)) {
    return {
      ok: false,
      error: new RepoPilotError('validation', 'Field "endLine" must be a positive integer.').toSafe(),
    };
  }
  return {
    ok: true,
    value: {
      filePath: rawPath,
      resolvedPath: rawPath,
      startLine: input.startLine as number | undefined,
      endLine: input.endLine as number | undefined,
    },
  };
}

export function validateFindSymbolInput(
  input: unknown,
): ToolResult<FindSymbolInput> {
  if (!isRecord(input) || typeof input.name !== 'string' || input.name.trim().length === 0) {
    return {
      ok: false,
      error: new RepoPilotError('validation', 'Input for find_symbol must include a non-empty "name" string.').toSafe(),
    };
  }
  if (input.fileHint !== undefined && typeof input.fileHint !== 'string') {
    return {
      ok: false,
      error: new RepoPilotError('validation', 'Field "fileHint" must be a string when present.').toSafe(),
    };
  }
  return {
    ok: true,
    value: {
      name: input.name,
      fileHint: input.fileHint as string | undefined,
    },
  };
}

export function validateGetRepositoryContextInput(
  input: unknown,
): ToolResult<GetRepositoryContextInput> {
  if (!isRecord(input) || !isRecord(input.request)) {
    return {
      ok: false,
      error: new RepoPilotError('validation', 'Input for get_repository_context must include a "request" object.').toSafe(),
    };
  }
  const request = input.request;
  const problems: string[] = [];
  if (typeof request.requestId !== 'string' || request.requestId.length === 0) {
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

  if (problems.length > 0) {
    return {
      ok: false,
      error: new RepoPilotError('validation', `Invalid input for get_repository_context: ${problems.join('; ')}.`).toSafe(),
    };
  }
  return {
    ok: true,
    value: {
      request: request as unknown as ChangeRequest,
    },
  };
}

// ───────────────────────────── Handlers ─────────────────────────────

export async function handleSearchWorkspace(
  repo: RepositoryIntelligence,
  input: unknown,
  signal?: AbortSignal,
): Promise<ToolResult<SearchResult[]>> {
  try {
    if (signal?.aborted === true) {
      return { ok: false, error: new RepoPilotError('cancelled', 'Request cancelled.').toSafe() };
    }
    const validated = validateSearchWorkspaceInput(input);
    if (!validated.ok) return validated;
    const results = await repo.search(validated.value.query, validated.value.limit);
    return { ok: true, value: results };
  } catch (error) {
    return { ok: false, error: toSafeError(error) };
  }
}

export async function handleReadFile(
  repo: RepositoryIntelligence,
  input: unknown,
  signal?: AbortSignal,
): Promise<ToolResult<ReadFileResult>> {
  try {
    if (signal?.aborted === true) {
      return { ok: false, error: new RepoPilotError('cancelled', 'Request cancelled.').toSafe() };
    }
    const validated = validateReadFileInput(input);
    if (!validated.ok) return validated;
    const { resolvedPath, startLine, endLine } = validated.value;
    const content = await repo.readFile(resolvedPath, startLine, endLine);
    return {
      ok: true,
      value: {
        filePath: resolvedPath,
        content,
        startLine,
        endLine,
      },
    };
  } catch (error) {
    return { ok: false, error: toSafeError(error) };
  }
}

export async function handleFindSymbol(
  repo: RepositoryIntelligence,
  input: unknown,
  signal?: AbortSignal,
): Promise<ToolResult<SymbolRecord[]>> {
  try {
    if (signal?.aborted === true) {
      return { ok: false, error: new RepoPilotError('cancelled', 'Request cancelled.').toSafe() };
    }
    const validated = validateFindSymbolInput(input);
    if (!validated.ok) return validated;
    const symbols = await repo.findSymbol(validated.value.name, validated.value.fileHint);
    return { ok: true, value: symbols };
  } catch (error) {
    return { ok: false, error: toSafeError(error) };
  }
}

export async function handleGetRepositoryContext(
  repo: RepositoryIntelligence,
  input: unknown,
  signal?: AbortSignal,
): Promise<ToolResult<RepositoryContext>> {
  try {
    if (signal?.aborted === true) {
      return { ok: false, error: new RepoPilotError('cancelled', 'Request cancelled.').toSafe() };
    }
    const validated = validateGetRepositoryContextInput(input);
    if (!validated.ok) return validated;
    const context = await repo.getContext(validated.value.request, signal);
    return { ok: true, value: context };
  } catch (error) {
    return { ok: false, error: toSafeError(error) };
  }
}

/**
 * Creates all four repository tool handlers bound to a RepositoryIntelligence instance.
 */
export function createRepositoryToolHandlers(
  repo: RepositoryIntelligence = createRepositoryIntelligence(),
): {
  [TOOL_NAMES.searchWorkspace]: (
    input: unknown,
    signal?: AbortSignal,
  ) => Promise<ToolResult<SearchResult[]>>;
  [TOOL_NAMES.readFile]: (
    input: unknown,
    signal?: AbortSignal,
  ) => Promise<ToolResult<ReadFileResult>>;
  [TOOL_NAMES.findSymbol]: (
    input: unknown,
    signal?: AbortSignal,
  ) => Promise<ToolResult<SymbolRecord[]>>;
  [TOOL_NAMES.getRepositoryContext]: (
    input: unknown,
    signal?: AbortSignal,
  ) => Promise<ToolResult<RepositoryContext>>;
} {
  return {
    [TOOL_NAMES.searchWorkspace]: (input, signal) => handleSearchWorkspace(repo, input, signal),
    [TOOL_NAMES.readFile]: (input, signal) => handleReadFile(repo, input, signal),
    [TOOL_NAMES.findSymbol]: (input, signal) => handleFindSymbol(repo, input, signal),
    [TOOL_NAMES.getRepositoryContext]: (input, signal) => handleGetRepositoryContext(repo, input, signal),
  };
}
