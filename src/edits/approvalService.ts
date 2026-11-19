// OWNER: Member 1 — the ONLY module that writes workspace files (services.ts EditService).
//
// - propose(): reads disk, hashes it and computes diffs/hunks in memory. Never writes.
// - apply():   writes only hunks the user accepted (matched by path + hunkId), refuses
//              the whole apply if any target changed since propose() (status "stale"),
//              writes each file atomically (temp file + rename) and rolls back on error.
// - undo():    restores the pre-apply content, refusing if a file changed after apply.
// - discard(): drops a pending plan without touching disk.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ApplyResult,
  ChangePlan,
  EditService,
  FileProposal,
  HunkDecision,
  ProposedFileChange,
  UndoResult,
} from '../shared/contracts';
import { PathSecurityValidator } from '../mcp/safety';
import { ChangeHistory } from './changeHistory';
import { ChangeProposalService } from './changeProposal';
import { PatchManager } from './patchManager';

export class SafeEditingService implements EditService {
  readonly history = new ChangeHistory();
  private readonly pending = new Map<string, Map<string, ProposedFileChange>>();

  constructor(private readonly security: PathSecurityValidator) {}

  async propose(
    requestId: string,
    summary: string,
    proposals: FileProposal[],
    rationale: string[],
  ): Promise<ChangePlan> {
    const files = new Map(this.pending.get(requestId) ?? []);
    for (const item of proposals) {
      const safePath = this.security.resolveSafePath(item.path);
      const relPath = toPosix(item.path);
      const original = fs.existsSync(safePath) ? fs.readFileSync(safePath, 'utf-8') : '';
      const exists = fs.existsSync(safePath);
      files.set(relPath, ChangeProposalService.createProposal(relPath, original, item.proposedContent, exists));
    }
    this.pending.set(requestId, files);
    return { requestId, summary, files: [...files.values()], rationale };
  }

  /** Proposals awaiting a decision for this request (read-only view). */
  getPending(requestId: string): ProposedFileChange[] {
    return [...(this.pending.get(requestId)?.values() ?? [])];
  }

  async apply(requestId: string, decisions: HunkDecision[]): Promise<ApplyResult> {
    const base = { requestId, appliedPaths: [] as string[], appliedHunkIds: [] as string[], stalePaths: [] as string[] };
    const proposals = this.pending.get(requestId);
    const accepted = new Set(
      decisions.filter((d) => d.decision === 'accept').map((d) => hunkKey(toPosix(d.path), d.hunkId)),
    );
    if (!proposals || proposals.size === 0 || accepted.size === 0) {
      return { ...base, status: 'nothing_to_apply' };
    }

    const targets = [...proposals.values()]
      .map((proposal) => ({
        proposal,
        hunkIds: proposal.hunks.filter((h) => accepted.has(hunkKey(proposal.path, h.hunkId))).map((h) => h.hunkId),
      }))
      .filter((t) => t.hunkIds.length > 0);

    if (targets.length === 0) {
      return { ...base, status: 'nothing_to_apply', message: 'No accepted hunk matches the pending proposal.' };
    }

    // Pre-flight: every target must still match the hash taken at propose().
    const staged: Array<{ proposal: ProposedFileChange; hunkIds: string[]; safePath: string; current: string; existed: boolean }> = [];
    const stalePaths: string[] = [];
    for (const t of targets) {
      const safePath = this.security.resolveSafePath(t.proposal.path);
      const existed = fs.existsSync(safePath);
      const current = existed ? fs.readFileSync(safePath, 'utf-8') : '';
      if (ChangeProposalService.computeContentHash(current) !== t.proposal.originalContentHash) {
        stalePaths.push(t.proposal.path);
      } else {
        staged.push({ ...t, safePath, current, existed });
      }
    }
    if (stalePaths.length > 0) {
      return {
        ...base,
        status: 'stale',
        stalePaths,
        message: `Changed on disk since the proposal: ${stalePaths.join(', ')}. Nothing was written.`,
      };
    }

    const written: Array<{ safePath: string; current: string; existed: boolean }> = [];
    const appliedPaths: string[] = [];
    const appliedHunkIds: string[] = [];
    try {
      for (const s of staged) {
        if (s.proposal.changeType === 'delete') {
          fs.unlinkSync(s.safePath);
          written.push(s);
          this.record(requestId, s.proposal, s.current, '', 'delete');
        } else {
          const patched = PatchManager.applyApprovedHunks(s.current, s.proposal, new Set(s.hunkIds));
          writeAtomic(s.safePath, patched);
          written.push(s);
          this.record(requestId, s.proposal, s.current, patched, s.existed ? 'modify' : 'create');
        }
        appliedPaths.push(s.proposal.path);
        appliedHunkIds.push(...s.hunkIds);
      }
    } catch (err) {
      for (const w of written.reverse()) {
        try {
          if (w.existed) {
            writeAtomic(w.safePath, w.current);
          } else if (fs.existsSync(w.safePath)) {
            fs.unlinkSync(w.safePath);
          }
        } catch {
          // best effort: the error result below tells the user to check the files
        }
      }
      this.history.clear(requestId);
      return { ...base, status: 'error', message: `Apply failed and was rolled back: ${errorMessage(err)}` };
    }

    this.pending.delete(requestId);
    return { requestId, status: 'applied', appliedPaths, appliedHunkIds, stalePaths: [] };
  }

  async undo(requestId: string): Promise<UndoResult> {
    const records = this.history.getRecords(requestId);
    if (records.length === 0) {
      return { requestId, status: 'nothing_to_undo', restoredPaths: [] };
    }

    const changedSince: string[] = [];
    for (const r of records) {
      const safePath = this.security.resolveSafePath(r.path);
      const exists = fs.existsSync(safePath);
      const now = exists ? ChangeProposalService.computeContentHash(fs.readFileSync(safePath, 'utf-8')) : null;
      const expected = r.changeType === 'delete' ? null : r.postApplyHash;
      if (now !== expected) {
        changedSince.push(r.path);
      }
    }
    if (changedSince.length > 0) {
      return {
        requestId,
        status: 'error',
        restoredPaths: [],
        message: `Not undone: changed after apply: ${changedSince.join(', ')}. Nothing was written.`,
      };
    }

    const restoredPaths: string[] = [];
    try {
      for (const r of [...records].reverse()) {
        const safePath = this.security.resolveSafePath(r.path);
        if (r.changeType === 'create') {
          if (fs.existsSync(safePath)) {
            fs.unlinkSync(safePath);
          }
        } else {
          writeAtomic(safePath, r.previousContent);
        }
        restoredPaths.push(r.path);
      }
    } catch (err) {
      return { requestId, status: 'error', restoredPaths, message: `Undo stopped: ${errorMessage(err)}` };
    }
    this.history.clear(requestId);
    return { requestId, status: 'undone', restoredPaths };
  }

  discard(requestId: string): void {
    this.pending.delete(requestId);
  }

  private record(
    requestId: string,
    proposal: ProposedFileChange,
    previousContent: string,
    appliedContent: string,
    changeType: 'modify' | 'create' | 'delete',
  ): void {
    this.history.recordApplication({
      requestId,
      path: proposal.path,
      appliedAt: new Date().toISOString(),
      previousContent,
      changeType,
      postApplyHash: ChangeProposalService.computeContentHash(appliedContent),
    });
  }
}

/** Creates the edit service for one workspace. The root is required (no process.cwd() fallback). */
export function createEditService(workspaceRoot: string): SafeEditingService {
  if (!workspaceRoot || !workspaceRoot.trim()) {
    throw new Error('createEditService requires the workspace root folder.');
  }
  return new SafeEditingService(new PathSecurityValidator(workspaceRoot));
}

function hunkKey(filePath: string, hunkId: string): string {
  return `${filePath}\u0000${hunkId}`;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function writeAtomic(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.repopilot-${process.pid}-${Date.now()}.tmp`,
  );
  fs.writeFileSync(temp, content, 'utf-8');
  try {
    fs.renameSync(temp, target);
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
