<<<<<<< HEAD
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
=======
import {
  type ChangeRequest,
  type RepositoryIntelligence,
  type RepositoryContext,
  type SearchResult,
  type SymbolRecord,
  type SafeError,
  toSafeError,
} from '../shared/contracts';
import { TOOL_NAMES } from '../mcp/tool-names';
import { normalizeWorkspacePath } from './path-safety';

type SearchRepository = Pick<RepositoryIntelligence, 'search'>;
type ReadRepository = Pick<RepositoryIntelligence, 'readFile'>;
type SymbolRepository = Pick<RepositoryIntelligence, 'findSymbol'>;
type ContextRepository = Pick<RepositoryIntelligence, 'getContext'>;
>>>>>>> e8815f6 (feat: complete repository intelligence module)

export interface SearchWorkspaceInput {
  query: string;
  limit?: number;
}

export interface ReadFileInput {
<<<<<<< HEAD
  filePath?: string;
  path?: string;
  startLine?: number;
  endLine?: number;
}

export interface ReadFileResult {
  filePath: string;
  content: string;
=======
  path: string;
>>>>>>> e8815f6 (feat: complete repository intelligence module)
  startLine?: number;
  endLine?: number;
}

export interface FindSymbolInput {
  name: string;
  fileHint?: string;
}

<<<<<<< HEAD
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

=======
export type GetRepositoryContextInput = ChangeRequest;

export const REPOSITORY_TOOL_DESCRIPTIONS = {
  [TOOL_NAMES.searchWorkspace]: 'Search workspace text. Provide a non-empty query and optionally a result limit from 1 to 1000.',
  [TOOL_NAMES.readFile]: 'Read a safe workspace-relative file path, optionally restricting the result to a 1-based line range.',
  [TOOL_NAMES.findSymbol]: 'Find a Python symbol by exact name, optionally restricting the search to a workspace-relative file path.',
  [TOOL_NAMES.getRepositoryContext]: 'Assemble relevant repository context using a ChangeRequest with requestId, instruction, mode, explicit mention arrays, and optional active-file selection.',
} as const;

export const REPOSITORY_TOOL_INPUT_DESCRIPTIONS = {
  [TOOL_NAMES.searchWorkspace]: {
    query: 'Required non-empty text to search for.',
    limit: 'Optional positive integer result limit; maximum 1000. Defaults to the repository search default.',
  },
  [TOOL_NAMES.readFile]: {
    path: 'Required workspace-relative POSIX path. Absolute paths, traversal, sensitive paths, and excluded directories are not allowed.',
    startLine: 'Optional 1-based starting line.',
    endLine: 'Optional 1-based ending line, greater than or equal to startLine.',
  },
  [TOOL_NAMES.findSymbol]: {
    name: 'Required exact symbol name.',
    fileHint: 'Optional safe workspace-relative Python file path.',
  },
  [TOOL_NAMES.getRepositoryContext]: {
    ChangeRequest: 'The input object itself must have requestId, instruction, mode, explicitFileMentions, explicitSymbolMentions, and optional activeFile, selectedText, and selectionRange.',
  },
} as const;

>>>>>>> e8815f6 (feat: complete repository intelligence module)
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

<<<<<<< HEAD
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
=======
function validationError(message: string): SafeError {
  return { kind: 'validation', message, retryable: false };
}

function operationError(error: unknown): SafeError {
  const safe = toSafeError(error);
  return {
    kind: safe.kind,
    message: safe.kind === 'cancelled' ? 'Request cancelled.' : 'Repository operation failed.',
    retryable: safe.retryable,
  };
}

function isOptionalLine(value: unknown): value is number | undefined {
  return value === undefined || (
    typeof value === 'number' && Number.isInteger(value) && value >= 1
  );
}

function isOptionalSearchLimit(value: unknown): value is number | undefined {
  return value === undefined || (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 1000
  );
}

function isChangeRequest(value: unknown): value is ChangeRequest {
  if (!isRecord(value)) return false;
  const range = value.selectionRange;
  const validRange = range === undefined ||
    (isRecord(range) &&
      typeof range.startLine === 'number' &&
      Number.isInteger(range.startLine) &&
      typeof range.endLine === 'number' &&
      Number.isInteger(range.endLine) &&
      range.startLine >= 1 &&
      range.endLine >= range.startLine);

  return typeof value.requestId === 'string' &&
    value.requestId.trim().length > 0 &&
    typeof value.instruction === 'string' &&
    (value.mode === 'inline' || value.mode === 'agent') &&
    Array.isArray(value.explicitFileMentions) &&
    value.explicitFileMentions.every((item) => typeof item === 'string') &&
    Array.isArray(value.explicitSymbolMentions) &&
    value.explicitSymbolMentions.every((item) => typeof item === 'string') &&
    (value.activeFile === undefined || typeof value.activeFile === 'string') &&
    (value.selectedText === undefined || typeof value.selectedText === 'string') &&
    validRange;
}

export async function handleSearchWorkspace(
  repository: SearchRepository,
  input: unknown,
): Promise<SearchResult[] | SafeError> {
  if (!isRecord(input) ||
      typeof input.query !== 'string' ||
      input.query.trim().length === 0 ||
      !isOptionalSearchLimit(input.limit)) {
    return validationError('Search input must include a non-empty query and an optional integer limit from 1 to 1000.');
  }

  try {
    return await repository.search(input.query.trim(), input.limit);
  } catch (error) {
    return operationError(error);
>>>>>>> e8815f6 (feat: complete repository intelligence module)
  }
}

export async function handleReadFile(
<<<<<<< HEAD
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
=======
  repository: ReadRepository,
  input: unknown,
): Promise<string | SafeError> {
  if (!isRecord(input) ||
      typeof input.path !== 'string' ||
      !isOptionalLine(input.startLine) ||
      !isOptionalLine(input.endLine) ||
      (input.endLine !== undefined &&
        input.startLine !== undefined &&
        input.endLine < input.startLine)) {
    return validationError('Read-file input must include a workspace-relative path and an optional valid 1-based line range.');
  }

  let safePath: string;
  try {
    safePath = normalizeWorkspacePath(input.path);
  } catch {
    return validationError('Read-file path must be a safe workspace-relative path.');
  }

  try {
    return await repository.readFile(
      safePath,
      input.startLine,
      input.endLine,
    );
  } catch (error) {
    return operationError(error);
>>>>>>> e8815f6 (feat: complete repository intelligence module)
  }
}

export async function handleFindSymbol(
<<<<<<< HEAD
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
=======
  repository: SymbolRepository,
  input: unknown,
): Promise<SymbolRecord[] | SafeError> {
  if (!isRecord(input) ||
      typeof input.name !== 'string' ||
      input.name.trim().length === 0 ||
      (input.fileHint !== undefined && typeof input.fileHint !== 'string')) {
    return validationError('Find-symbol input must include a non-empty symbol name and an optional file path.');
  }

  let fileHint: string | undefined;
  if (typeof input.fileHint === 'string') {
    try {
      fileHint = normalizeWorkspacePath(input.fileHint);
    } catch {
      return validationError('Symbol file hint must be a safe workspace-relative path.');
    }
  }

  try {
    return await repository.findSymbol(input.name.trim(), fileHint);
  } catch (error) {
    return operationError(error);
>>>>>>> e8815f6 (feat: complete repository intelligence module)
  }
}

export async function handleGetRepositoryContext(
<<<<<<< HEAD
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
=======
  repository: ContextRepository,
  input: unknown,
): Promise<RepositoryContext | SafeError> {
  if (!isChangeRequest(input)) {
    return validationError('Repository-context input must match the ChangeRequest contract.');
  }

  if (input.activeFile !== undefined) {
    try {
      normalizeWorkspacePath(input.activeFile);
    } catch {
      return validationError('Active file must be a safe workspace-relative path.');
    }
  }

  try {
    const context = await repository.getContext(input);
    return {
      ...context,
      warnings: context.warnings.map((warning) =>
        warning.startsWith('Explicit file mention could not be resolved:')
          ? 'An explicit file mention could not be resolved.'
          : warning,
      ),
    };
  } catch (error) {
    return operationError(error);
  }
}
>>>>>>> e8815f6 (feat: complete repository intelligence module)
