/**
 * TestSheriff MCP Protocol Server
 * Implements a compliant JSON-RPC 2.0 Model Context Protocol (MCP) server over stdio.
 * Enables Member 1 (Central Agent Orchestrator) to launch and interact with TestSheriff
 * using the standard MCP protocol.
 */

import * as readline from "node:readline";
import { TEST_MCP_TOOLS, dispatchMcpTool } from "./test-tools.ts";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class TestSheriffMcpServer {
  private isInitialized = false;

  public handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = request.id !== undefined ? request.id : null;

    if (request.jsonrpc !== "2.0") {
      return Promise.resolve({
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "Invalid Request: jsonrpc must be 2.0" },
      });
    }

    switch (request.method) {
      case "initialize": {
        this.isInitialized = true;
        return Promise.resolve({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: { listChanged: false },
            },
            serverInfo: {
              name: "repopilot-testsheriff",
              version: "1.0.0",
            },
          },
        });
      }

      case "notifications/initialized": {
        // Notification — no response needed
        return Promise.resolve(null);
      }

      case "ping": {
        return Promise.resolve({
          jsonrpc: "2.0",
          id,
          result: {},
        });
      }

      case "tools/list": {
        return Promise.resolve({
          jsonrpc: "2.0",
          id,
          result: {
            tools: TEST_MCP_TOOLS,
          },
        });
      }

      case "tools/call": {
        return this.handleToolCall(id, request.params);
      }

      default: {
        return Promise.resolve({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Method not found: ${request.method}`,
          },
        });
      }
    }
  }

  private async handleToolCall(
    id: string | number | null,
    params?: Record<string, unknown>
  ): Promise<JsonRpcResponse> {
    if (!params || typeof params.name !== "string") {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message: "Invalid params: 'name' is required for tools/call",
        },
      };
    }

    const toolName = params.name;
    const toolArgs = (params.arguments as Record<string, unknown>) || {};

    const dispatchResult = await dispatchMcpTool(toolName, toolArgs);

    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(dispatchResult.data ?? dispatchResult.error, null, 2),
          },
        ],
        isError: !dispatchResult.success,
      },
    };
  }

  /**
   * Starts listening on standard input and writing responses to standard output.
   */
  public listenStdio(): void {
    process.env.MCP_STDIO = "1";
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const req = JSON.parse(trimmed) as JsonRpcRequest;
        const res = await this.handleRequest(req);
        if (res) {
          process.stdout.write(JSON.stringify(res) + "\n");
        }
      } catch (err) {
        const parseErr: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${(err as Error).message}`,
          },
        };
        process.stdout.write(JSON.stringify(parseErr) + "\n");
      }
    });
  }
}

// Auto-run if executed directly as entrypoint
if (process.argv[1]?.endsWith("mcp-server.ts") || process.argv[1]?.endsWith("mcp-server.js")) {
  const server = new TestSheriffMcpServer();
  server.listenStdio();
}
