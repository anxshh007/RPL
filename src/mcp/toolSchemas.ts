// OWNER: Member 1 — Zod schemas (D-11) for the tool inputs Member 1 owns, and for the
// short model-facing inputs of tools whose full input (request + context) the agent supplies.
import { z } from 'zod';

const relPath = z.string().min(1, 'path is required');

export const ListDirectorySchema = z.object({
  path: relPath.optional(),
}).strict();

export const FindFilesSchema = z.object({
  pattern: z.string().min(1, 'pattern is required'),
  path: relPath.optional(),
  limit: z.number().int().positive().max(1000).optional(),
}).strict();

/** propose_edit: diff-only; collected for the user's hunk review, never written. */
export const ProposeEditSchema = z.object({
  path: relPath,
  proposedContent: z.string(),
  rationale: z.string().optional(),
}).strict();

/** analyse_impact / get_impact_graph as the model calls them; request and context come from the run. */
export const ImpactToolModelSchema = z.object({
  files: z.array(relPath).optional(),
}).strict();

/** get_repository_context as the model calls it; the request comes from the run. */
export const RepositoryContextModelSchema = z.object({}).strict();

export const DiscoverTestsSchema = z.object({
  changedFiles: z.array(relPath).default([]),
}).strict();

export const GetTestResultsSchema = z.object({}).strict();

/** User-only tools (never offered to the model). */
export const ApplyApprovedHunksSchema = z.object({
  decisions: z.array(
    z.object({
      path: relPath,
      hunkId: z.string().min(1),
      decision: z.enum(['accept', 'reject']),
    }).strict(),
  ),
}).strict();

export const UndoChangesSchema = z.object({}).strict();

export const RunTestsSchema = z.object({
  changedFiles: z.array(relPath).default([]),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
}).strict();

export type ProposeEditArgs = z.infer<typeof ProposeEditSchema>;
