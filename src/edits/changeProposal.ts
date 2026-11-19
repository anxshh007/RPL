// OWNER: Member 1 — in-memory diff and hunk generation. Never touches disk.
import * as crypto from 'node:crypto';
import * as Diff from 'diff';
import type { Hunk, ProposedFileChange } from '../shared/contracts';

export const DIFF_CONTEXT_LINES = 3;

export class ChangeProposalService {
  /** SHA-256 of the content with CRLF normalised to LF, so line-ending noise is not "stale". */
  static computeContentHash(content: string): string {
    return crypto.createHash('sha256').update(content.replace(/\r\n/g, '\n'), 'utf-8').digest('hex');
  }

  /** Stable hunk id: hash of the path (no collisions between "a/b.py" and "a_b.py") + index. */
  static hunkId(filePath: string, index: number): string {
    const pathHash = crypto.createHash('sha256').update(filePath, 'utf-8').digest('hex').slice(0, 8);
    return `hunk-${pathHash}-${index + 1}`;
  }

  static structuredPatch(filePath: string, original: string, proposed: string): Diff.ParsedDiff {
    return Diff.structuredPatch(
      filePath,
      filePath,
      original.replace(/\r\n/g, '\n'),
      proposed.replace(/\r\n/g, '\n'),
      'original',
      'proposed',
      { context: DIFF_CONTEXT_LINES },
    );
  }

  static createProposal(
    filePath: string,
    originalContent: string,
    proposedContent: string,
    fileExists: boolean,
  ): ProposedFileChange {
    const changeType: ProposedFileChange['changeType'] = !fileExists
      ? 'create'
      : proposedContent.length === 0
        ? 'delete'
        : 'modify';

    const patch = this.structuredPatch(filePath, originalContent, proposedContent);
    const hunks: Hunk[] = patch.hunks.map((h, index) => ({
      hunkId: this.hunkId(filePath, index),
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      diffText: [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join('\n'),
    }));

    return {
      path: filePath,
      changeType,
      originalContentHash: this.computeContentHash(originalContent),
      proposedContent,
      unifiedDiff: Diff.createTwoFilesPatch(
        filePath,
        filePath,
        originalContent.replace(/\r\n/g, '\n'),
        proposedContent.replace(/\r\n/g, '\n'),
        'original',
        'proposed',
        { context: DIFF_CONTEXT_LINES },
      ),
      hunks,
    };
  }
}
