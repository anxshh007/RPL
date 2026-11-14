// OWNER: Member 2 — Repository Intelligence (brief: docs/briefs/02_member2_repository_intelligence.md)
// STUB: replace with the real scanner / search / symbol index / ranker. Keep the exported factory name.
import type {
  ChangeRequest,
  DependencyEdge,
  RepositoryContext,
  RepositoryIntelligence,
  SearchResult,
  SymbolRecord,
} from '../shared/contracts';
import { realpath } from 'node:fs/promises';
import { analyzePythonDependencies } from './dependency-index';
import { listWorkspaceFiles } from './workspace-scanner';
import { readWorkspaceFile, searchWorkspace } from './ripgrep-search';
import {
  indexWorkspacePythonFile,
  indexWorkspacePythonFiles,
  type PythonWorkspaceIndex,
} from './python-symbol-index';
import { normalizeWorkspacePath } from './path-safety';
import { assembleRepositoryContext } from './repository-service';
import {
  DEFAULT_CONTEXT_RANKING_WEIGHTS,
  type ContextRankingWeights,
} from './context-ranker';

export { getFileMetadata } from './file-metadata';
export type { FileMetadata } from './file-metadata';
export { listWorkspaceFiles } from './workspace-scanner';
export { readWorkspaceFile, searchWorkspace } from './ripgrep-search';
export type { WorkspaceSearchOptions } from './ripgrep-search';
export {
  findPythonSymbols,
  indexWorkspacePythonFile,
  indexWorkspacePythonFiles,
  parsePythonSource,
} from './python-symbol-index';
export type {
  PythonFileAnalysis,
  PythonImportRecord,
  PythonParseOptions,
  PythonParseStatus,
  PythonWorkspaceIndex,
} from './python-symbol-index';
export { analyzePythonDependencies, getPythonDependencies } from './dependency-index';
export type {
  PythonDependencyIndex,
  PythonExternalImport,
} from './dependency-index';
export { parsePythonImports } from './python-import-parser';
export type { PythonImportParseResult } from './python-import-parser';
export { parseRepositoryMentions } from './mention-parser';
export type { ParsedMentions } from './mention-parser';
export { rankContextCandidates, DEFAULT_CONTEXT_RANKING_WEIGHTS } from './context-ranker';
export type {
  ContextRankingSignal,
  ContextRankingWeights,
  RankedContextCandidate,
} from './context-ranker';
export { estimateContextTokens, fitContextToBudget } from './context-budget';
export type { ContextBudgetResult } from './context-budget';
export { assembleRepositoryContext } from './repository-service';
export type { RepositoryServiceOptions } from './repository-service';

export const DEFAULT_TOKEN_BUDGET = 16000;

export function createRepositoryIntelligence(
  tokenBudget = DEFAULT_TOKEN_BUDGET,
  rankingWeights: Partial<ContextRankingWeights> = DEFAULT_CONTEXT_RANKING_WEIGHTS,
): RepositoryIntelligence {
  if (!Number.isInteger(tokenBudget) || tokenBudget < 1 || tokenBudget > 20000) {
    throw new Error('Context token budget must be an integer between 1 and 20000.');
  }

  let workspaceRoot: string | undefined;
  let pythonIndex: PythonWorkspaceIndex | undefined;
  let dependencyIndex: Awaited<ReturnType<typeof analyzePythonDependencies>> | undefined;
  const pendingInvalidations = new Set<string>();
  let reindexQueue: Promise<void> = Promise.resolve();

  function getWorkspaceRoot(): string {
    if (!workspaceRoot) {
      throw new Error('Repository intelligence has not been initialized.');
    }
    return workspaceRoot;
  }

  function assertIndexesFresh(): void {
    if (pendingInvalidations.size > 0) {
      const paths = [...pendingInvalidations].sort((left, right) => left.localeCompare(right));
      throw new Error(
        `Repository indexes are invalidated; call reindex() before querying: ${paths.join(', ')}`,
      );
    }
  }

  async function getPythonIndex(): Promise<PythonWorkspaceIndex> {
    assertIndexesFresh();
    pythonIndex ??= await indexWorkspacePythonFiles(getWorkspaceRoot());
    return pythonIndex;
  }

  async function getDependencyIndex(): Promise<
    Awaited<ReturnType<typeof analyzePythonDependencies>>
  > {
    assertIndexesFresh();
    dependencyIndex ??= await analyzePythonDependencies(
      getWorkspaceRoot(),
      undefined,
      await getPythonIndex(),
    );
    return dependencyIndex;
  }

  async function performReindex(paths: Set<string>): Promise<void> {
    const root = getWorkspaceRoot();
    const filesToRefresh = new Set([...pendingInvalidations, ...paths]);

    if (!pythonIndex) {
      pythonIndex = await indexWorkspacePythonFiles(root);
    } else {
      const scan = await listWorkspaceFiles(root);
      const currentFiles = new Set(scan.files);
      const analyses = new Map(pythonIndex.files.map((analysis) => [analysis.file, analysis]));

      for (const file of filesToRefresh) {
        if (!currentFiles.has(file) || !file.toLowerCase().endsWith('.py')) {
          analyses.delete(file);
          continue;
        }
        analyses.set(file, await indexWorkspacePythonFile(root, file));
      }

      for (const file of analyses.keys()) {
        if (!currentFiles.has(file)) analyses.delete(file);
      }

      const indexedFiles = [...analyses.values()].sort((left, right) =>
        left.file.localeCompare(right.file),
      );
      pythonIndex = {
        files: indexedFiles,
        incomplete: scan.incomplete ||
          indexedFiles.some((analysis) => analysis.status !== 'complete'),
        warnings: [
          ...scan.warnings,
          ...indexedFiles.flatMap((analysis) =>
            analysis.warnings.map((warning) => `${analysis.file}: ${warning}`),
          ),
        ],
      };
    }

    dependencyIndex = await analyzePythonDependencies(root, undefined, pythonIndex);
    for (const file of filesToRefresh) pendingInvalidations.delete(file);
  }

  return {
    async initialize(root: string): Promise<void> {
      workspaceRoot = await realpath(root);
      pythonIndex = undefined;
      dependencyIndex = undefined;
      pendingInvalidations.clear();
    },
    async search(query: string, limit?: number): Promise<SearchResult[]> {
      return searchWorkspace(getWorkspaceRoot(), query, undefined, limit);
    },
    async readFile(filePath: string, startLine?: number, endLine?: number): Promise<string> {
      return readWorkspaceFile(getWorkspaceRoot(), filePath, startLine, endLine);
    },
    async findSymbol(name: string, fileHint?: string): Promise<SymbolRecord[]> {
      const normalizedHint = fileHint ? normalizeWorkspacePath(fileHint) : undefined;
      if (normalizedHint && !normalizedHint.toLowerCase().endsWith('.py')) return [];
      const index = await getPythonIndex();
      return index.files
        .filter((file) => !normalizedHint || file.file === normalizedHint)
        .flatMap((file) => file.symbols)
        .filter((symbol) => symbol.name === name);
    },
    async getContext(request: ChangeRequest, signal?: AbortSignal): Promise<RepositoryContext> {
      if (!workspaceRoot) {
        return {
          requestId: request.requestId,
          relevantFiles: [],
          relevantSymbols: [],
          dependencyEdges: [],
          unresolvedImports: [],
          tokenEstimate: 0,
          tokenBudget,
          budgetConflicts: [],
          warnings: ['Repository intelligence is not initialized; no context was assembled.'],
        };
      }
      return assembleRepositoryContext(
        workspaceRoot,
        request,
        { tokenBudget, rankingWeights },
        signal,
      );
    },
    async getDependencies(paths: string[]): Promise<DependencyEdge[]> {
      if (paths.length === 0) return (await getDependencyIndex()).dependencyEdges;
      const requested = new Set(paths.map(normalizeWorkspacePath));
      return (await getDependencyIndex()).dependencyEdges.filter((edge) =>
        requested.has(edge.from) || requested.has(edge.to),
      );
    },
    invalidate(paths: string[]): void {
      getWorkspaceRoot();
      for (const file of paths.map(normalizeWorkspacePath)) {
        pendingInvalidations.add(file);
      }
    },
    reindex(paths: string[]): Promise<void> {
      getWorkspaceRoot();
      const normalizedPaths = new Set(paths.map(normalizeWorkspacePath));
      for (const file of normalizedPaths) pendingInvalidations.add(file);

      const task = reindexQueue.then(() => performReindex(normalizedPaths));
      reindexQueue = task.catch(() => undefined);
      return task;
    },
  };
}
