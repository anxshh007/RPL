// OWNER: Member 1 — composition root. The extension (Member 5) calls createRepoPilot() and nothing else.
// Every module is built from its owner's factory and shares one instance per workspace.
import { createRepositoryIntelligence } from '../repository';
import { createImpactAnalyser } from '../impact';
import { createVerificationService } from '../verification';
import { createEditService } from '../edits';
import { createRepoPilotTools } from '../mcp/repoPilotTools';
import { ActiveRun } from '../mcp/activeRun';
import { RepoPilotHttpMcpServer } from '../mcp/httpServer';
import { isTrueForgeConfigured, parseTrueForgeConfig } from '../config/configuration';
import type { TrueForgeConfig } from '../config/configuration';
import { RepoPilotController } from './controller';
import { TrueForgePlanner } from './planner';
import type { AgentPlanner } from './planner';
import { TrueForgeClient } from './trueforgeClient';
import type { TrueForgeSdk } from './trueforgeClient';

export interface McpConnectorOptions {
  /** Port on 127.0.0.1 (0 = any free port, tests only). */
  port: number;
  /** Bearer token TrueForge must send (Settings → Connectors → header auth). At least 32 characters. */
  token: string;
  /** Called with the endpoint URL once it is listening. */
  onReady?: (url: string) => void;
  /** Called if it cannot start (e.g. the port is in use). RepoPilot keeps working without it. */
  onError?: (err: Error) => void;
}

export interface RepoPilotOptions {
  /** Absolute path of the open workspace folder. Required: there is no process.cwd() fallback. */
  workspaceRoot: string;
  tokenBudget?: number;
  /** D-12, default true. */
  requireTestApproval?: boolean;
  testTimeoutMs?: number;
  trueforge?: Partial<TrueForgeConfig>;
  /** Serves RepoPilot's tools to TrueForge as an HTTP MCP connector on 127.0.0.1. */
  mcpConnector?: McpConnectorOptions;
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
  const activeRun = new ActiveRun();

  const config = parseTrueForgeConfig(options.trueforge ?? {});
  let planner = options.planner;
  if (!planner && (isTrueForgeConfigured(config) || options.trueforgeSdk)) {
    planner = new TrueForgePlanner(new TrueForgeClient(config, options.trueforgeSdk), tools, {
      activeRun,
      ...(config.model ? { agent: { model: config.model, connectorName: config.connectorName } } : {}),
    });
  }

  const controller = new RepoPilotController(
    { repository, impact, verification, edits, ...(planner ? { planner } : {}) },
    {
      workspaceRoot,
      requireTestApproval: options.requireTestApproval ?? true,
      ...(options.testTimeoutMs ? { testTimeoutMs: options.testTimeoutMs } : {}),
      plannerUnavailableReason:
        'TrueForge is not configured (repopilot.trueforge.baseUrl is empty), so no changes were proposed.',
    },
  );

  if (options.mcpConnector) {
    const { port, token, onReady, onError } = options.mcpConnector;
    const server = new RepoPilotHttpMcpServer(tools, activeRun, { port, token });
    server.start().then(
      (url) => onReady?.(url),
      (err: Error) => onError?.(err),
    );
    controller.addCleanup(() => server.close());
  }

  return controller;
}

export { RepoPilotController } from './controller';
export type { AgentDependencies, ControllerOptions } from './controller';
export { TrueForgePlanner, buildPrompt, buildAgentSpec, AGENT_INSTRUCTIONS, MAX_TOOL_CALLS_PER_TURN } from './planner';
export type { AgentPlanner, PlanInput, PlanResult, TrueForgePlannerOptions } from './planner';
export { TrueForgeClient } from './trueforgeClient';
export type { TrueForgeSdk, TurnEvent } from './trueforgeClient';
export { generateConnectorToken } from '../mcp/httpServer';
export * from './errors';
