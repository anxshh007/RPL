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

export const DEFAULT_TOKEN_BUDGET = 16000;

export function createRepositoryIntelligence(tokenBudget = DEFAULT_TOKEN_BUDGET): RepositoryIntelligence {
  return {
    async initialize(_root: string): Promise<void> {},
    async search(_query: string, _limit?: number): Promise<SearchResult[]> {
      return [];
    },
    async readFile(_path: string): Promise<string> {
      throw new Error('readFile not implemented yet (Member 2).');
    },
    async findSymbol(_name: string): Promise<SymbolRecord[]> {
      return [];
    },
    async getContext(request: ChangeRequest): Promise<RepositoryContext> {
      return {
        requestId: request.requestId,
        relevantFiles: [],
        relevantSymbols: [],
        dependencyEdges: [],
        unresolvedImports: [],
        tokenEstimate: 0,
        tokenBudget,
        budgetConflicts: [],
        warnings: ['Repository intelligence is a stub: no files were retrieved.'],
      };
    },
    async getDependencies(_paths: string[]): Promise<DependencyEdge[]> {
      return [];
    },
    invalidate(_paths: string[]): void {},
    async reindex(_paths: string[]): Promise<void> {},
  };
}
