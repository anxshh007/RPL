// OWNER: Member 1 — composition root. The extension (Member 5) calls createRepoPilot() and nothing else.
// Every module is built from its owner's factory and shares one instance per workspace.
import { createRepositoryIntelligence } from '../repository';
import { createImpactAnalyser } from '../impact';
import { createVerificationService } from '../verification';
import { createEditService } from '../edits';
import { createRepoPilotTools } from '../mcp/repoPilotTools';
import { isTrueForgeConfigured, parseTrueForgeConfig } from '../config/configuration';
import type { TrueForgeConfig } from '../config/configuration';
import { RepoPilotController } from './controller';
import { TrueForgePlanner } from './planner';
import type { AgentPlanner } from './planner';
import { TrueForgeClient } from './trueforgeClient';
import type { TrueForgeSdk } from './trueforgeClient';

export interface RepoPilotOptions {
  /** Absolute path of the open workspace folder. Required: there is no process.cwd() fallback. */
  workspaceRoot: string;
  tokenBudget?: number;
  /** D-12, default true. */
  requireTestApproval?: boolean;
  testTimeoutMs?: number;
  trueforge?: Partial<TrueForgeConfig>;
  /** Tests only: replaces the TrueForge SDK or the whole planner. */
  trueforgeSdk?: TrueForgeSdk;
  planner?: AgentPlanner;
}

export function createRepoPilot(options: RepoPilotOptions): RepoPilotController {
  const workspaceRoot = options?.workspaceRoot;
  if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
    throw new Error('createRepoPilot requires options.workspaceRoot (the open workspace folder).');
  }

  const repository = createRepositoryIntelligence(options.tokenBudget);
  const impact = createImpactAnalyser();
  const verification = createVerificationService(workspaceRoot);
  const edits = createEditService(workspaceRoot);
  const tools = createRepoPilotTools({ workspaceRoot, repository, impact, verification, edits });

  const config = parseTrueForgeConfig(options.trueforge ?? {});
  let planner = options.planner;
  if (!planner && (isTrueForgeConfigured(config) || options.trueforgeSdk)) {
    planner = new TrueForgePlanner(new TrueForgeClient(config, options.trueforgeSdk), tools);
  }

  return new RepoPilotController(
    { repository, impact, verification, edits, ...(planner ? { planner } : {}) },
    {
      workspaceRoot,
      requireTestApproval: options.requireTestApproval ?? true,
      ...(options.testTimeoutMs ? { testTimeoutMs: options.testTimeoutMs } : {}),
      plannerUnavailableReason:
        'TrueForge is not configured (repopilot.trueforge.baseUrl is empty), so no changes were proposed.',
    },
  );
}

export { RepoPilotController } from './controller';
export type { AgentDependencies, ControllerOptions } from './controller';
export { TrueForgePlanner, buildPrompt, MAX_TOOL_CALLS_PER_TURN } from './planner';
export type { AgentPlanner, PlanInput, PlanResult } from './planner';
export { TrueForgeClient } from './trueforgeClient';
export type { TrueForgeSdk, TurnEvent } from './trueforgeClient';
export * from './errors';
