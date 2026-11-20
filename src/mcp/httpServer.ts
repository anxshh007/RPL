// OWNER: Member 1 — RepoPilot's tools as a remote MCP server for TrueForge.
//
// TrueForge only reaches tools through MCP servers registered on its side ("Settings → Connectors":
// a name, a URL and optional header auth). This serves the same allowlisted tools over the MCP
// Streamable HTTP transport, for the request that is planning right now (ActiveRun).
//
// Safety:
// - listens on 127.0.0.1 only; nothing on the network can connect;
// - every request needs "Authorization: Bearer <token>" (compared in constant time);
// - the Host header must be 127.0.0.1:<port> or localhost:<port> (blocks DNS-rebinding from a browser);
// - POST /mcp only, JSON bodies up to 1 MB, a fresh stateless MCP server per request;
// - only READ_ONLY_TOOLS are listed or callable; apply / undo / run_tests are never reachable.
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ToolRegistry } from './toolRegistry';
import type { ActiveRun } from './activeRun';
import { createMcpProtocolServer } from './mcpServer';

export const MCP_HTTP_PATH = '/mcp';
export const MAX_BODY_BYTES = 1024 * 1024;
export const MIN_TOKEN_LENGTH = 32;
const LOOPBACK = '127.0.0.1';

export interface McpHttpServerOptions {
  /** 0 picks a free port (tests). */
  port: number;
  /** Shared secret; TrueForge sends it as "Authorization: Bearer <token>". At least 32 characters. */
  token: string;
}

/** A random token suitable for the connector's Authorization header. */
export function generateConnectorToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export class RepoPilotHttpMcpServer {
  private server?: http.Server;
  private boundPort?: number;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly activeRun: ActiveRun,
    private readonly options: McpHttpServerOptions,
  ) {
    if (typeof options.token !== 'string' || options.token.length < MIN_TOKEN_LENGTH) {
      throw new Error(`The MCP connector token must be at least ${MIN_TOKEN_LENGTH} characters.`);
    }
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
      throw new Error('The MCP connector port must be between 0 and 65535.');
    }
  }

  /** Starts listening on 127.0.0.1 and returns the endpoint URL. */
  start(): Promise<string> {
    if (this.server) {
      return Promise.resolve(this.url());
    }
    const server = http.createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'Internal error.' });
        } else {
          res.end();
        }
      });
    });
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', (err) => {
        this.server = undefined;
        reject(err);
      });
      server.listen(this.options.port, LOOPBACK, () => {
        this.boundPort = (server.address() as AddressInfo).port;
        resolve(this.url());
      });
    });
  }

  url(): string {
    return `http://${LOOPBACK}:${this.boundPort ?? this.options.port}${MCP_HTTP_PATH}`;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const port = this.boundPort ?? this.options.port;
    const allowedHosts = [`${LOOPBACK}:${port}`, `localhost:${port}`];

    if (!allowedHosts.includes(String(req.headers.host ?? '').toLowerCase())) {
      return sendJson(res, 403, { error: 'Host not allowed.' });
    }
    if (!this.authorized(req.headers.authorization)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return sendJson(res, 401, { error: 'Missing or wrong bearer token.' });
    }
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname !== MCP_HTTP_PATH) {
      return sendJson(res, 404, { error: 'Not found.' });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Only POST is supported (stateless MCP server).' });
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (err) {
      const tooLarge = err instanceof Error && err.message === 'too large';
      return sendJson(res, tooLarge ? 413 : 400, { error: tooLarge ? 'Request body too large.' : 'Invalid JSON.' });
    }

    const mcp = createMcpProtocolServer(this.registry, () => this.activeRun.toolContext(), {
      refusalMessage: 'No RepoPilot request is planning right now, so RepoPilot tools are not available.',
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
      allowedHosts,
      enableDnsRebindingProtection: true,
    });
    res.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  private authorized(header: string | undefined): boolean {
    const match = /^Bearer (.+)$/.exec(header ?? '');
    if (!match) return false;
    const given = Buffer.from(match[1]);
    const expected = Buffer.from(this.options.token);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return; // keep draining so the client gets a clean 413 instead of a reset
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => (tooLarge ? reject(new Error('too large')) : resolve(Buffer.concat(chunks).toString('utf-8'))));
    req.on('error', reject);
  });
}
