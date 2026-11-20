// OWNER: Member 1 — exposes the tool registry over the Model Context Protocol (official SDK).
// Uses the low-level Server API: the high-level McpServer.tool() generics combined with
// Zod 3.25 make the TypeScript checker hit "type instantiation is excessively deep".
// MCP clients get the model allowlist (READ_ONLY_TOOLS) only.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { refuse } from './toolRegistry';
import type { ToolCallContext, ToolOutcome, ToolRegistry } from './toolRegistry';

export interface RepoPilotMcpServerOptions {
  name?: string;
  version?: string;
}

/**
 * Builds an MCP protocol server over the registry. `contextFor` decides who is calling:
 * it returns the call context, or undefined to refuse the call (e.g. no request is planning).
 */
export function createMcpProtocolServer(
  registry: ToolRegistry,
  contextFor: () => ToolCallContext | undefined,
  options: RepoPilotMcpServerOptions & { refusalMessage?: string } = {},
): Server {
  const server = new Server(
    { name: options.name ?? 'repopilot-mcp', version: options.version ?? '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.listForModel().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: { type: 'object' as const, ...(t.inputSchema as Record<string, unknown>) },
      // None of these tools changes the workspace: propose_edit only collects a proposal for review.
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const ctx = contextFor();
    if (!ctx) {
      return toCallToolResult(refuse('validation', options.refusalMessage ?? 'No RepoPilot request is running.'));
    }
    const outcome = await registry.execute(req.params.name, req.params.arguments ?? {}, ctx);
    return toCallToolResult(outcome);
  });

  return server;
}

/** stdio server for external MCP clients (no active request: context and impact tools refuse). */
export class RepoPilotMcpServer {
  readonly server: Server;

  constructor(registry: ToolRegistry, options: RepoPilotMcpServerOptions = {}) {
    this.server = createMcpProtocolServer(registry, () => ({ origin: 'external', requestId: 'external' }), options);
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
  }

  async startStdio(): Promise<void> {
    await this.connect(new StdioServerTransport());
  }

  async close(): Promise<void> {
    await this.server.close();
  }
}

export function toCallToolResult(outcome: ToolOutcome): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  if (!outcome.ok) {
    return { content: [{ type: 'text', text: JSON.stringify(outcome.error) }], isError: true };
  }
  const text = typeof outcome.value === 'string' ? outcome.value : JSON.stringify(outcome.value);
  return { content: [{ type: 'text', text: text ?? 'null' }] };
}
