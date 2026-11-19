// OWNER: Member 1 — edit proposal / hunk apply / undo. The only module that writes workspace files.
export { SafeEditingService, createEditService } from './approvalService';
export { ChangeHistory } from './changeHistory';
export type { AppliedChangeRecord } from './changeHistory';
export { ChangeProposalService } from './changeProposal';
export { PatchManager } from './patchManager';
