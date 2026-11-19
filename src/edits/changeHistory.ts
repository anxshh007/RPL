// OWNER: Member 1 — in-memory record of applied changes, used only by undo().

export interface AppliedChangeRecord {
  requestId: string;
  path: string;
  appliedAt: string;
  /** Disk content before apply ('' when the file was created). */
  previousContent: string;
  changeType: 'modify' | 'create' | 'delete';
  /** Hash of the content written by apply; undo refuses if the file no longer matches. */
  postApplyHash: string;
}

export class ChangeHistory {
  private readonly records = new Map<string, AppliedChangeRecord[]>();

  recordApplication(record: AppliedChangeRecord): void {
    const list = this.records.get(record.requestId) ?? [];
    list.push(record);
    this.records.set(record.requestId, list);
  }

  getRecords(requestId: string): ReadonlyArray<AppliedChangeRecord> {
    return this.records.get(requestId) ?? [];
  }

  hasChanges(requestId: string): boolean {
    return this.getRecords(requestId).length > 0;
  }

  clear(requestId: string): void {
    this.records.delete(requestId);
  }
}
