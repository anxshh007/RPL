export interface ContextRankingWeights {
  explicitFile: number;
  explicitSymbol: number;
  activeSelection: number;
  exactSymbol: number;
  filenameMatch: number;
  textMatch: number;
  dependency: number;
  testOrDocumentation: number;
  namingConvention: number;
}

/** Scores are additive heuristic points, not probabilities; explicit signals dominate. */
export const DEFAULT_CONTEXT_RANKING_WEIGHTS: Readonly<ContextRankingWeights> = {
  explicitFile: 1000,
  explicitSymbol: 950,
  activeSelection: 900,
  exactSymbol: 700,
  filenameMatch: 250,
  textMatch: 100,
  dependency: 150,
  testOrDocumentation: 120,
  namingConvention: 25,
};

export type ContextRankingSignal = keyof ContextRankingWeights;

export interface RankedContextCandidate {
  path: string;
  score: number;
  signals: ContextRankingSignal[];
  reasons: string[];
}

export function rankContextCandidates(
  candidates: RankedContextCandidate[],
): RankedContextCandidate[] {
  return [...candidates].sort((left, right) =>
    right.score - left.score || left.path.localeCompare(right.path),
  );
}
