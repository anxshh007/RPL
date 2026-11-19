// OWNER: Member 1 — one registry for all 12 tools (D-07). Handlers belong to their module
// owners; this file only registers them, enforces the allowlist and never throws.
import type { ChangeRequest, FileProposal, RepositoryContext, SafeError } from '../shared/contracts';
import { toSafeError } from '../shared/contracts';
import { READ_ONLY_TOOLS, TOOL_NAMES } from './tool-names';
import type { ToolName } from './tool-names';

/** Who is calling: the model (allowlist enforced), the user via the UI, or an external MCP client. */
export type ToolOrigin = 'model' | 'user' | 'external';

export interface ToolCallContext {
  origin: ToolOrigin;
  requestId: string;
  signal?: AbortSignal;
  /** Set during an agent run, so context/impact tools can be called with short inputs. */
  request?: ChangeRequest;
  context?: RepositoryContext;
  /** propose_edit collects here; the controller turns them into a ChangePlan. */
  proposals?: Map<string, FileProposal>;
}

export type ToolOutcome = { ok: true; value: unknown } | { ok: false; error: SafeError };

export interface RegisteredTool {
  name: ToolName;
  description: string;
  /** JSON Schema of the input as the caller sends it. */
  inputSchema: object;
  handler: (input: unknown, ctx: ToolCallContext) => Promise<ToolOutcome>;
}

const ALL_TOOL_NAMES = new Set<string>(Object.values(TOOL_NAMES));

export function isToolName(name: string): name is ToolName {
  return ALL_TOOL_NAMES.has(name);
}

export function isReadOnlyTool(name: string): boolean {
  return isToolName(name) && READ_ONLY_TOOLS.has(name);
}

export class ToolRegistry {
  private readonly tools = new Map<ToolName, RegisteredTool>();

  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return isToolName(name) && this.tools.has(name);
  }

  names(): ToolName[] {
    return [...this.tools.keys()];
  }

  /** Tools offered to the model: READ_ONLY_TOOLS only. */
  listForModel(): Array<{ name: ToolName; description: string; inputSchema: object }> {
    return [...this.tools.values()]
      .filter((t) => READ_ONLY_TOOLS.has(t.name))
      .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  }

  /** Runs a tool. Never throws: every failure is a SafeError. */
  async execute(name: string, input: unknown, ctx: ToolCallContext): Promise<ToolOutcome> {
    if (!isToolName(name) || !this.tools.has(name)) {
      return refuse('validation', `Unknown tool "${String(name).slice(0, 80)}".`);
    }
    if (ctx.origin !== 'user' && !READ_ONLY_TOOLS.has(name)) {
      return refuse('validation', `Tool "${name}" needs the user's approval in the RepoPilot panel and cannot be called by the model.`);
    }
    if (ctx.signal?.aborted) {
      return refuse('cancelled', 'Request cancelled.');
    }
    try {
      return await this.tools.get(name)!.handler(input, ctx);
    } catch (err) {
      return { ok: false, error: toSafeError(err) };
    }
  }
}

export function refuse(kind: SafeError['kind'], message: string): ToolOutcome {
  return { ok: false, error: { kind, message, retryable: false } };
}
