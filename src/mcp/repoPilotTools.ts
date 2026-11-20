// OWNER: Member 1 — registers every module's own tool handlers (D-07) in one ToolRegistry.
//   Member 2: src/repository/tools.ts   Member 3: src/impact/tools.ts
//   Member 4: src/verification/tools.ts Member 1: propose_edit, apply_approved_hunks, undo_changes
import type { ZodTypeAny } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  EditService,
  ImpactAnalyser,
  RepositoryIntelligence,
  VerificationService,
} from '../shared/contracts';
import { createImpactToolHandlers, IMPACT_TOOL_DEFINITIONS } from '../impact/tools';
import { createRepositoryToolHandlers, REPOSITORY_TOOL_DEFINITIONS } from '../repository';
import { createVerificationToolHandlers } from '../verification';
import { PathSecurityValidator } from './safety';
import { TOOL_NAMES } from './tool-names';
import { refuse, ToolRegistry } from './toolRegistry';
import type { ToolCallContext, ToolOutcome } from './toolRegistry';
import { listWorkspaceFiles } from '../repository/workspace-scanner';
import {
  ApplyApprovedHunksSchema,
  DiscoverTestsSchema,
  GetTestResultsSchema,
  ImpactToolModelSchema,
  ListDirectorySchema,
  FindFilesSchema,
  ProposeEditSchema,
  RepositoryContextModelSchema,
  RunTestsSchema,
  UndoChangesSchema,
} from './toolSchemas';

// zod-to-json-schema's generic signature is very expensive for the type checker; call it untyped.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { zodToJsonSchema } = require('zod-to-json-schema') as { zodToJsonSchema: (schema: unknown) => object };

export interface RepoPilotToolDependencies {
  workspaceRoot: string;
  repository: RepositoryIntelligence;
  impact: ImpactAnalyser;
  verification: VerificationService;
  edits: EditService;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\/+/, '');
  let source = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        if (normalized[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`, 'i');
}

export function createRepoPilotTools(deps: RepoPilotToolDependencies): ToolRegistry {
  const registry = new ToolRegistry();
  const security = new PathSecurityValidator(deps.workspaceRoot);
  const repoTools = createRepositoryToolHandlers(deps.repository);
  const impactTools = createImpactToolHandlers(deps.impact);
  const testTools = createVerificationToolHandlers(deps.verification);

  registry.register({
    name: TOOL_NAMES.listDirectory,
    description:
      'List files and folders in a workspace directory. Paths are workspace-relative; omit path to list the workspace root.',
    inputSchema: jsonSchema(ListDirectorySchema),
    handler: async (input) => {
      const parsed = parse(ListDirectorySchema, input);
      if (!parsed.ok) return parsed.outcome;
      const requestedPath = typeof parsed.value.path === 'string' ? parsed.value.path : '.';
      const directory = security.resolveSafePath(requestedPath);
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const relativeDirectory = requestedPath === '.'
        ? ''
        : requestedPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      return {
        ok: true,
        value: {
          path: relativeDirectory || '.',
          entries: entries
            .filter((entry) => !entry.isSymbolicLink())
            .sort((a, b) => {
              if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
              return a.name.localeCompare(b.name);
            })
            .map((entry) => ({
              name: entry.name,
              kind: entry.isDirectory() ? 'directory' : 'file',
              path: relativeDirectory ? path.posix.join(relativeDirectory, entry.name) : entry.name,
            })),
        },
      };
    },
  });

  registry.register({
    name: TOOL_NAMES.findFiles,
    description:
      'Find workspace files by glob pattern such as **/*.html or src/**/*.ts. Results are workspace-relative.',
    inputSchema: jsonSchema(FindFilesSchema),
    handler: async (input) => {
      const parsed = parse(FindFilesSchema, input);
      if (!parsed.ok) return parsed.outcome;
      const basePath = parsed.value.path ?? '.';
      security.resolveSafePath(basePath);
      const scan = await listWorkspaceFiles(deps.workspaceRoot);
      const base = basePath === '.' ? '' : basePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const matcher = globToRegExp(parsed.value.pattern);
      const limit = parsed.value.limit ?? 100;
      const matches = scan.files
        .filter((file) => !base || file === base || file.startsWith(`${base}/`))
        .filter((file) => matcher.test(base ? file.slice(base.length + 1) : file))
        .slice(0, limit);
      return {
        ok: true,
        value: { pattern: parsed.value.pattern, path: base || '.', files: matches, incomplete: scan.incomplete },
      };
    },
  });

  // ── Member 2: repository (handlers validate their own input) ──
  for (const def of REPOSITORY_TOOL_DEFINITIONS) {
    if (def.name === TOOL_NAMES.getRepositoryContext) {
      continue;
    }

    const handler = repoTools[def.name as keyof typeof repoTools];
    registry.register({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      handler: (input, ctx) => handler(input, ctx.signal) as Promise<ToolOutcome>,
    });
  }
  registry.register({
    name: TOOL_NAMES.getRepositoryContext,
    description: 'Returns the ranked repository context for the current request.',
    inputSchema: jsonSchema(RepositoryContextModelSchema),
    handler: async (input, ctx) => {
      const parsed = parse(RepositoryContextModelSchema, input);
      if (!parsed.ok) return parsed.outcome;
      if (!ctx.request) return refuse('validation', 'get_repository_context needs an active RepoPilot request.');
      return repoTools[TOOL_NAMES.getRepositoryContext]({ request: ctx.request }, ctx.signal);
    },
  });

  // ── Member 3: ImpactLens (the run supplies request + context; the model may name files) ──
  for (const name of [TOOL_NAMES.analyseImpact, TOOL_NAMES.getImpactGraph] as const) {
    const def = IMPACT_TOOL_DEFINITIONS.find((d) => d.name === name);
    registry.register({
      name,
      description: def?.description ?? name,
      inputSchema: jsonSchema(ImpactToolModelSchema),
      handler: async (input, ctx) => {
        const parsed = parse(ImpactToolModelSchema, input);
        if (!parsed.ok) return parsed.outcome;
        if (!ctx.request || !ctx.context) {
          return refuse('validation', `${name} needs an active RepoPilot request with repository context.`);
        }
        return impactTools[name](
          { request: ctx.request, context: ctx.context, proposedFiles: parsed.value.files ?? [] },
          ctx.signal,
        );
      },
    });
  }

  // ── Member 1: propose_edit (collects for review; writes nothing) ──
  registry.register({
    name: TOOL_NAMES.proposeEdit,
    description:
      'Propose the full new content of one workspace-relative file. Nothing is written: the user reviews ' +
      'each hunk and only accepted hunks are applied later. Call once per file; a later call replaces the earlier one.',
    inputSchema: jsonSchema(ProposeEditSchema),
    handler: async (input, ctx) => {
      const parsed = parse(ProposeEditSchema, input);
      if (!parsed.ok) return parsed.outcome;
      security.resolveSafePath(parsed.value.path); // throws SecurityError → SafeError via registry
      if (!ctx.proposals) {
        return refuse('validation', 'propose_edit needs an active RepoPilot request.');
      }
      const path = parsed.value.path.replace(/\\/g, '/');
      ctx.proposals.set(path, { path, proposedContent: parsed.value.proposedContent });
      return { ok: true, value: { path, status: 'collected_for_review', written: false } };
    },
  });

  // ── Member 1: user-only (apply / undo need the user's hunk decisions) ──
  registry.register({
    name: TOOL_NAMES.applyApprovedHunks,
    description: 'Apply the hunks the user accepted. User-only; never offered to the model.',
    inputSchema: jsonSchema(ApplyApprovedHunksSchema),
    handler: async (input, ctx) => {
      const parsed = parse(ApplyApprovedHunksSchema, input);
      if (!parsed.ok) return parsed.outcome;
      return { ok: true, value: await deps.edits.apply(ctx.requestId, parsed.value.decisions) };
    },
  });
  registry.register({
    name: TOOL_NAMES.undoChanges,
    description: 'Undo the changes RepoPilot applied for this request. User-only; never offered to the model.',
    inputSchema: jsonSchema(UndoChangesSchema),
    handler: async (input, ctx) => {
      const parsed = parse(UndoChangesSchema, input);
      if (!parsed.ok) return parsed.outcome;
      return { ok: true, value: await deps.edits.undo(ctx.requestId) };
    },
  });

  // ── Member 4: TestSheriff ──
  registry.register({
    name: TOOL_NAMES.discoverTests,
    description: 'Lists the pytest files relevant to the given changed files. Runs nothing.',
    inputSchema: jsonSchema(DiscoverTestsSchema),
    handler: async (input) => {
      const parsed = parse(DiscoverTestsSchema, input);
      if (!parsed.ok) return parsed.outcome;
      return testTools.discover_tests({ changedFiles: parsed.value.changedFiles, candidateTests: [] });
    },
  });
  registry.register({
    name: TOOL_NAMES.runTests,
    description: 'Run the allowlisted pytest command for the changed files. User-only (D-12).',
    inputSchema: jsonSchema(RunTestsSchema),
    handler: async (input, ctx) => {
      const parsed = parse(RunTestsSchema, input);
      if (!parsed.ok) return parsed.outcome;
      return testTools.run_tests(
        {
          requestId: ctx.requestId,
          changedFiles: parsed.value.changedFiles,
          candidateTests: [],
          ...(parsed.value.timeoutMs ? { timeoutMs: parsed.value.timeoutMs } : {}),
        },
        ctx.signal,
      );
    },
  });
  registry.register({
    name: TOOL_NAMES.getTestResults,
    description: 'Returns the last TestSheriff report for the current request, or null.',
    inputSchema: jsonSchema(GetTestResultsSchema),
    handler: async (input, ctx) => {
      const parsed = parse(GetTestResultsSchema, input);
      if (!parsed.ok) return parsed.outcome;
      return testTools.get_test_results({ requestId: ctx.requestId });
    },
  });

  return registry;
}

function jsonSchema(schema: ZodTypeAny): object {
  const out = zodToJsonSchema(schema) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; outcome: ToolOutcome };

function parse<S extends ZodTypeAny>(schema: S, input: unknown): Parsed<S['_output']> {
  const result = schema.safeParse(input ?? {});
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const detail = result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
    .join('; ');
  return { ok: false, outcome: refuse('validation', `Invalid input: ${detail}`) };
}

export type { ToolCallContext };
