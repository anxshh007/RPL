import { TOOL_NAMES } from '../mcp/tool-names';
import type { ToolName } from '../mcp/tool-names';
import {
  RepoPilotError,
  toSafeError,
} from '../shared/contracts';
import type {
  ChangeRequest,
  RepositoryContext,
  RepositoryIntelligence,
  SafeError,
  SearchResult,
  SymbolRecord,
} from '../shared/contracts';
import { normalizeWorkspacePath } from './path-safety';
import { createRepositoryIntelligence } from './index';

type SearchRepository = Pick<RepositoryIntelligence, 'search'>;
type ReadRepository = Pick<RepositoryIntelligence, 'readFile'>;
type SymbolRepository = Pick<RepositoryIntelligence, 'findSymbol'>;
type ContextRepository = Pick<RepositoryIntelligence, 'getContext'>;

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

export interface RepositoryToolDefinition {
  readonly name: ToolName;
  readonly description: string;
  readonly inputSchema: object;
}

export type ToolResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SafeError };

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
      description: 'Maximum number of matches to return (default 50, max 1000).',
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

export const REPOSITORY_TOOL_DESCRIPTIONS = {
  [TOOL_NAMES.searchWorkspace]: 'Search workspace text.',
  [TOOL_NAMES.readFile]: 'Read a safe workspace-relative file path and optional line range.',
  [TOOL_NAMES.findSymbol]: 'Find a Python symbol by exact name and optional file path.',
  [TOOL_NAMES.getRepositoryContext]: 'Assemble repository context from a ChangeRequest.',
} as const;

export const REPOSITORY_TOOL_INPUT_DESCRIPTIONS = {
  [TOOL_NAMES.searchWorkspace]: {
    query: 'Required non-empty text to search for.',
    limit: 'Optional positive integer result limit; maximum 1000.',
  },
  [TOOL_NAMES.readFile]: {
    path: 'Required safe workspace-relative path.',
    startLine: 'Optional 1-based starting line.',
    endLine: 'Optional 1-based ending line, greater than or equal to startLine.',
  },
  [TOOL_NAMES.findSymbol]: {
    name: 'Required exact symbol name.',
    fileHint: 'Optional safe workspace-relative Python file path.',
  },
  [TOOL_NAMES.getRepositoryContext]: {
    ChangeRequest: 'The input must match the ChangeRequest contract; it may be passed directly or in a request property.',
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validationError<T>(message: string): ToolResult<T> {
  return {
    ok: false,
    error: new RepoPilotError('validation', message).toSafe(),
  };
}

function operationError(error: unknown): SafeError {
  const safe = toSafeError(error);
  return {
    kind: safe.kind,
    message: safe.kind === 'cancelled'
      ? 'Request cancelled.'
      : 'Repository operation failed.',
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

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
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
    isStringList(value.explicitFileMentions) &&
    isStringList(value.explicitSymbolMentions) &&
    (value.activeFile === undefined || typeof value.activeFile === 'string') &&
    (value.selectedText === undefined || typeof value.selectedText === 'string') &&
    validRange;
}

export function validateSearchWorkspaceInput(
  input: unknown,
): ToolResult<SearchWorkspaceInput> {
  if (!isRecord(input) ||
      typeof input.query !== 'string' ||
      input.query.trim().length === 0 ||
      !isOptionalSearchLimit(input.limit)) {
    return validationError(
      'Search input must include a non-empty query and an optional integer limit from 1 to 1000.',
    );
  }
  return {
    ok: true,
    value: { query: input.query.trim(), limit: input.limit },
  };
}

export function validateReadFileInput(
  input: unknown,
): ToolResult<ReadFileInput & { resolvedPath: string }> {
  if (!isRecord(input)) {
    return validationError('Read-file input must be an object.');
  }
  const rawPath = typeof input.filePath === 'string'
    ? input.filePath
    : typeof input.path === 'string'
      ? input.path
      : undefined;
  if (!rawPath || rawPath.trim().length === 0) {
    return validationError('Read-file input must include a non-empty filePath or path.');
  }
  if (!isOptionalLine(input.startLine) || !isOptionalLine(input.endLine) ||
      (input.endLine !== undefined &&
        input.startLine !== undefined &&
        input.endLine < input.startLine)) {
    return validationError('Read-file input must include an optional valid 1-based line range.');
  }

  let resolvedPath: string;
  try {
    resolvedPath = normalizeWorkspacePath(rawPath);
  } catch {
    return validationError('Read-file path must be a safe workspace-relative path.');
  }
  return {
    ok: true,
    value: {
      filePath: resolvedPath,
      path: resolvedPath,
      resolvedPath,
      startLine: input.startLine,
      endLine: input.endLine,
    },
  };
}

export function validateFindSymbolInput(
  input: unknown,
): ToolResult<FindSymbolInput> {
  if (!isRecord(input) ||
      typeof input.name !== 'string' ||
      input.name.trim().length === 0 ||
      (input.fileHint !== undefined && typeof input.fileHint !== 'string')) {
    return validationError(
      'Find-symbol input must include a non-empty symbol name and an optional file path.',
    );
  }

  let fileHint: string | undefined;
  if (typeof input.fileHint === 'string') {
    try {
      fileHint = normalizeWorkspacePath(input.fileHint);
    } catch {
      return validationError('Symbol file hint must be a safe workspace-relative path.');
    }
  }
  return { ok: true, value: { name: input.name.trim(), fileHint } };
}

export function validateGetRepositoryContextInput(
  input: unknown,
): ToolResult<GetRepositoryContextInput> {
  const request = isRecord(input) && 'request' in input ? input.request : input;
  if (!isChangeRequest(request)) {
    return validationError(
      'Repository-context input must match the ChangeRequest contract.',
    );
  }

  let normalizedRequest = request;
  if (request.activeFile !== undefined) {
    try {
      normalizedRequest = {
        ...request,
        activeFile: normalizeWorkspacePath(request.activeFile),
      };
    } catch {
      return validationError('Active file must be a safe workspace-relative path.');
    }
  }
  return { ok: true, value: { request: normalizedRequest } };
}

function cancelled<T>(): ToolResult<T> {
  return {
    ok: false,
    error: new RepoPilotError('cancelled', 'Request cancelled.').toSafe(),
  };
}

export async function handleSearchWorkspace(
  repo: SearchRepository,
  input: unknown,
  signal?: AbortSignal,
): Promise<ToolResult<SearchResult[]>> {
  if (signal?.aborted) return cancelled();
  const validated = validateSearchWorkspaceInput(input);
  if (!validated.ok) return validated;
  try {
    return {
      ok: true,
      value: await repo.search(validated.value.query, validated.value.limit),
    };
  } catch (error) {
    return { ok: false, error: operationError(error) };
  }
}

export async function handleReadFile(
  repo: ReadRepository,
  input: unknown,
  signal?: AbortSignal,
): Promise<ToolResult<ReadFileResult>> {
  if (signal?.aborted) return cancelled();
  const validated = validateReadFileInput(input);
  if (!validated.ok) return validated;
  try {
    const { resolvedPath, startLine, endLine } = validated.value;
    return {
      ok: true,
      value: {
        filePath: resolvedPath,
        content: await repo.readFile(resolvedPath, startLine, endLine),
        startLine,
        endLine,
      },
    };
  } catch (error) {
    return { ok: false, error: operationError(error) };
  }
}

export async function handleFindSymbol(
  repo: SymbolRepository,
  input: unknown,
  signal?: AbortSignal,
): Promise<ToolResult<SymbolRecord[]>> {
  if (signal?.aborted) return cancelled();
  const validated = validateFindSymbolInput(input);
  if (!validated.ok) return validated;
  try {
    return {
      ok: true,
      value: await repo.findSymbol(validated.value.name, validated.value.fileHint),
    };
  } catch (error) {
    return { ok: false, error: operationError(error) };
  }
}

export async function handleGetRepositoryContext(
  repo: ContextRepository,
  input: unknown,
  signal?: AbortSignal,
): Promise<ToolResult<RepositoryContext>> {
  if (signal?.aborted) return cancelled();
  const validated = validateGetRepositoryContextInput(input);
  if (!validated.ok) return validated;
  try {
    const context = await repo.getContext(validated.value.request, signal);
    return {
      ok: true,
      value: {
        ...context,
        warnings: context.warnings.map((warning) =>
          warning.startsWith('Explicit file mention could not be resolved:')
            ? 'An explicit file mention could not be resolved.'
            : warning,
        ),
      },
    };
  } catch (error) {
    return { ok: false, error: operationError(error) };
  }
}

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
    [TOOL_NAMES.searchWorkspace]: (input, signal) =>
      handleSearchWorkspace(repo, input, signal),
    [TOOL_NAMES.readFile]: (input, signal) =>
      handleReadFile(repo, input, signal),
    [TOOL_NAMES.findSymbol]: (input, signal) =>
      handleFindSymbol(repo, input, signal),
    [TOOL_NAMES.getRepositoryContext]: (input, signal) =>
      handleGetRepositoryContext(repo, input, signal),
  };
}
