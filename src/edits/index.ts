// OWNER: Member 1 — edit proposal / hunk apply / undo (brief §5 Phase C–D)
// STUB: keeps plans in memory and NEVER writes to disk. Replace apply/undo with
// hash-checked, per-file atomic WorkspaceEdit application (jsdiff for hunks).
import type {
  ApplyResult,
  ChangePlan,
  EditService,
  FileProposal,
  HunkDecision,
  UndoResult,
} from '../shared/contracts';

export function createEditService(): EditService {
  const pending = new Map<string, ChangePlan>();

  return {
    async propose(requestId: string, summary: string, proposals: FileProposal[], rationale: string[]): Promise<ChangePlan> {
      const plan: ChangePlan = {
        requestId,
        summary,
        rationale,
        // Real implementation: read disk, hash it, compute unifiedDiff + hunks with stable hunkIds.
        files: proposals.map((p) => ({
          path: p.path,
          changeType: 'modify',
          originalContentHash: '',
          proposedContent: p.proposedContent,
          unifiedDiff: '',
          hunks: [],
        })),
      };
      pending.set(requestId, plan);
      return plan;
    },

    async apply(requestId: string, decisions: HunkDecision[]): Promise<ApplyResult> {
      const accepted = decisions.filter((d) => d.decision === 'accept');
      if (!pending.has(requestId) || accepted.length === 0) {
        return { requestId, status: 'nothing_to_apply', appliedPaths: [], appliedHunkIds: [], stalePaths: [] };
      }
      return {
        requestId,
        status: 'error',
        appliedPaths: [],
        appliedHunkIds: [],
        stalePaths: [],
        message: 'Edit service is a stub: nothing was written.',
      };
    },

    async undo(requestId: string): Promise<UndoResult> {
      return { requestId, status: 'nothing_to_undo', restoredPaths: [] };
    },

    discard(requestId: string): void {
      pending.delete(requestId);
    },
  };
}
