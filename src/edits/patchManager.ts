// OWNER: Member 1 — applies only the accepted hunks of a proposal to the current content.
// Rejected hunks keep the original lines. The original line ending (CRLF or LF) is kept.
import type { ProposedFileChange } from '../shared/contracts';
import { ValidationError } from '../agent/errors';
import { ChangeProposalService } from './changeProposal';

export class PatchManager {
  static detectLineEnding(content: string): '\r\n' | '\n' {
    return content.includes('\r\n') ? '\r\n' : '\n';
  }

  /** Returns the patched content. Hunks are re-derived from the same diff that propose() used. */
  static applyApprovedHunks(original: string, proposal: ProposedFileChange, acceptedHunkIds: ReadonlySet<string>): string {
    const lineEnding = this.detectLineEnding(original);
    const patch = ChangeProposalService.structuredPatch(proposal.path, original, proposal.proposedContent);
    if (original === '') {
      // A new (or empty) file has exactly one hunk: the whole content.
      const id = ChangeProposalService.hunkId(proposal.path, 0);
      return acceptedHunkIds.has(id) ? proposal.proposedContent : original;
    }
    const lines = original.replace(/\r\n/g, '\n').split('\n');

    const hunks = patch.hunks
      .map((hunk, index) => ({ hunk, hunkId: ChangeProposalService.hunkId(proposal.path, index) }))
      .filter((h) => acceptedHunkIds.has(h.hunkId))
      .sort((a, b) => b.hunk.oldStart - a.hunk.oldStart); // bottom-up keeps earlier indexes valid

    for (const { hunk, hunkId } of hunks) {
      const replacement = hunk.lines
        .filter((l) => l.startsWith('+') || l.startsWith(' '))
        .map((l) => l.slice(1));
      // jsdiff reports oldStart 0 for a hunk inserted into an empty file.
      const start = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1;
      if (start < 0 || start > lines.length) {
        throw new ValidationError(`Hunk ${hunkId} does not fit the current file.`, 'PATCH_OUT_OF_BOUNDS');
      }
      lines.splice(start, hunk.oldLines, ...replacement);
    }

    return lines.join('\n').replace(/\n/g, lineEnding);
  }
}
