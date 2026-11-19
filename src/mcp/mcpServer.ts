// OWNER: Member 1 — exposes the tool registry over the Model Context Protocol (official SDK).
// Uses the low-level Server API: the high-level McpServer.tool() generics combined with
// Zod 3.25 make the TypeScript checker hit "type instantiation is excessively deep".
// External MCP clients get the model allowlist (READ_ONLY_TOOLS) only.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ToolRegistry, ToolOutcome } from './toolRegistry';

export interface RepoPilotMcpServerOptions {
  name?: string;
  version?: string;
}

export class RepoPilotMcpServer {
  readonly server: Server;

  constructor(
    private readonly registry: ToolRegistry,
    options: RepoPilotMcpServerOptions = {},
  ) {
    this.server = new Server(
      { name: options.name ?? 'repopilot-mcp', version: options.version ?? '0.1.0' },
      { capabilities: { tools: {} } },
    );

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.registry.listForModel().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: { type: 'object' as const, ...(t.inputSchema as Record<string, unknown>) },
      })),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const outcome = await this.registry.execute(req.params.name, req.params.arguments ?? {}, {
        origin: 'external',
        requestId: 'external',
      });
      return toCallToolResult(outcome);
    });
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
