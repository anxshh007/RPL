// OWNER: Member 3 — ImpactLens (brief: docs/briefs/03_member3_impactlens.md)
// STUB: returns an honest empty/partial report. Replace with graph + bounded traversal + rules.
import type { ChangeRequest, ImpactAnalyser, ImpactReport, RepositoryContext } from '../shared/contracts';

export function createImpactAnalyser(): ImpactAnalyser {
  return {
    async analyseImpact(
      request: ChangeRequest,
      context: RepositoryContext,
      proposedFiles: string[] = [],
    ): Promise<ImpactReport> {
      return {
        requestId: request.requestId,
        generatedAt: new Date().toISOString(),
        changedTargets: proposedFiles,
        affectedFiles: [],
        testCandidates: [],
        nodes: [],
        edges: [],
        summary: {
          analysedFiles: context.relevantFiles.length,
          affectedCount: 0,
          high: 0,
          medium: 0,
          low: 0,
          incomplete: true,
        },
        warnings: ['ImpactLens is a stub: no dependency analysis was performed.'],
        limitations: ['Static analysis only; does not prove runtime impact.'],
      };
    },
  };
}
