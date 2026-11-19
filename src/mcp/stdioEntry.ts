#!/usr/bin/env node
// OWNER: Member 1 — runs the RepoPilot MCP server over stdio for external MCP clients.
// The workspace must be given explicitly (REPOPILOT_WORKSPACE_ROOT); there is no cwd fallback.
import { createRepositoryIntelligence } from '../repository';
import { createImpactAnalyser } from '../impact';
import { createVerificationService } from '../verification';
import { createEditService } from '../edits';
import { createRepoPilotTools } from './repoPilotTools';
import { RepoPilotMcpServer } from './mcpServer';

async function main(): Promise<void> {
  const workspaceRoot = process.env.REPOPILOT_WORKSPACE_ROOT;
  if (!workspaceRoot) {
    process.stderr.write('Set REPOPILOT_WORKSPACE_ROOT to the workspace folder.\n');
    process.exit(2);
  }
  const repository = createRepositoryIntelligence();
  await repository.initialize(workspaceRoot);
  const registry = createRepoPilotTools({
    workspaceRoot,
    repository,
    impact: createImpactAnalyser(),
    verification: createVerificationService(workspaceRoot),
    edits: createEditService(workspaceRoot),
  });
  const server = new RepoPilotMcpServer(registry);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await server.startStdio();
}

main().catch((err: unknown) => {
  process.stderr.write(`RepoPilot MCP server failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
