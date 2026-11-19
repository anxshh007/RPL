// OWNER: Member 5 — remembers the proposed plans the agent sent, so "Open diff" can show them.
// No "vscode" import: this part is unit-tested in plain Node.
import type { ProposedFileChange, RepoPilotEvent } from '../shared/contracts';

/** How many recent requests to keep (older plans are dropped; their diff can no longer be opened). */
export const MAX_REMEMBERED_PLANS = 10;

export class ProposedPlans {
  private readonly plans = new Map<string, Map<string, ProposedFileChange>>();

  /** Feed every agent event here; only change.proposed is kept. */
  record(event: RepoPilotEvent): void {
    if (event.type !== 'change.proposed') {
      return;
    }
    this.plans.delete(event.requestId); // re-insert so it counts as the newest
    this.plans.set(event.requestId, new Map(event.plan.files.map((f) => [f.path, f])));
    while (this.plans.size > MAX_REMEMBERED_PLANS) {
      const oldest = this.plans.keys().next().value as string;
      this.plans.delete(oldest);
    }
  }

  /**
   * The proposed change for one file, or undefined. Only paths that are in the agent's own plan
   * are returned, so a path sent by the webview can never open an arbitrary file.
   */
  get(requestId: string, path: string): ProposedFileChange | undefined {
    return this.plans.get(requestId)?.get(path);
  }
}
