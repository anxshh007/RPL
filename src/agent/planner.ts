// OWNER: Member 1 — the planning step (brief §5 Phase C). The controller only knows the
// AgentPlanner interface; TrueForgePlanner runs one TrueForge turn.
//
// How the model reaches RepoPilot's tools (from the TrueForge SDK docs):
// - Normally TrueForge calls them itself through the RepoPilot MCP connector (an HTTP MCP server
//   registered in TrueForge → Settings → Connectors). The calls land in RepoPilotHttpMcpServer,
//   which uses the request marked in ActiveRun; the planner sees "tool.response" events.
// - If TrueForge instead asks the client to answer ("tool.response_required"), the planner runs the
//   tool through the same ToolRegistry and sends the result back.
// Either way the allowlist applies (origin "model") and nothing is written: propose_edit only
// collects FileProposals for the user's hunk review.
import type {
  ChangeRequest,
  FileProposal,
  ImpactReport,
  RepoPilotEvent,
  RepositoryContext,
} from '../shared/contracts';
import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { ToolRegistry } from '../mcp/toolRegistry';
import type { ActiveRun } from '../mcp/activeRun';
import { READ_ONLY_TOOLS } from '../mcp/tool-names';
import { CancellationError, TrueForgeError } from './errors';
import type { TrueForgeClient } from './trueforgeClient';

export interface PlanInput {
  request: ChangeRequest;
  context: RepositoryContext;
  impact?: ImpactReport;
  signal: AbortSignal;
  emit: (event: RepoPilotEvent) => void;
}

export interface PlanResult {
  summary: string;
  rationale: string[];
  proposals: FileProposal[];
}

export interface AgentPlanner {
  plan(input: PlanInput): Promise<PlanResult>;
}

/** Hard cap so a looping model cannot run tools forever. */
export const MAX_TOOL_CALLS_PER_TURN = 40;

export interface TrueForgePlannerOptions {
  /** Shared with the HTTP MCP connector so its tool calls use this run's request. */
  activeRun?: ActiveRun;
  /** When set, the session carries RepoPilot's own agent definition instead of a saved agent. */
  agent?: { model: string; connectorName: string };
}

/** The agent's standing instructions (system prompt) when RepoPilot defines the agent itself. */
export const AGENT_INSTRUCTIONS = [
  'You are RepoPilot, a coding agent working inside the user\'s VS Code workspace.',
  'Use the RepoPilot tools to read code before changing it: get_repository_context, search_workspace, read_file, find_symbol, analyse_impact, get_impact_graph, discover_tests, get_test_results.',
  'Propose every changed file with propose_edit, giving the full new content and a workspace-relative path. Call it once per file.',
  'Nothing you propose is written until the user accepts individual hunks in RepoPilot. You cannot apply, undo or run tests; do not ask for other tools to do so.',
  'Keep changes minimal and explain briefly why each file changes.',
].join('\n');

/** RepoPilot's agent definition for TrueForge (AgentSpec), with only the read-only tool allowlist enabled. */
export function buildAgentSpec(model: string, connectorName: string): TrueForgeApi.AgentSpec {
  return {
    model: { name: model },
    instructions: AGENT_INSTRUCTIONS,
    mcpServers: [
      {
        name: connectorName,
        enableTools: [...READ_ONLY_TOOLS],
        // These tools never change the workspace (propose_edit only collects a proposal), and the
        // real approval is the user's hunk review, so no tool pauses mid-turn.
        requireApprovalForTools: [],
        preload: true,
      },
    ],
    config: { iterationLimit: MAX_TOOL_CALLS_PER_TURN },
  };
}

export class TrueForgePlanner implements AgentPlanner {
  constructor(
    private readonly client: TrueForgeClient,
    private readonly tools: ToolRegistry,
    private readonly options: TrueForgePlannerOptions = {},
  ) {}

  async plan({ request, context, impact, signal, emit }: PlanInput): Promise<PlanResult> {
    const { requestId } = request;
    const proposals = new Map<string, FileProposal>();
    const calls = new Map<string, { name: string; args: unknown; onServer: boolean }>();
    const rationale: string[] = [];
    let turnId = '';
    let toolCalls = 0;
    let finalText = '';

    // From here until the end of this turn, tool calls arriving over HTTP belong to this request.
    const endRun = this.options.activeRun?.begin({ requestId, signal, request, context, proposals });
    try {
      const spec = this.options.agent ? buildAgentSpec(this.options.agent.model, this.options.agent.connectorName) : undefined;
      const sessionId = await this.client.createSession({ requestId, mode: request.mode }, signal, spec);
      const onAbort = () => void this.client.cancelSession(sessionId);
      signal.addEventListener('abort', onAbort, { once: true });

      try {
        for await (const event of this.client.streamTurn(sessionId, buildPrompt(request, context, impact, this.tools), signal)) {
          switch (event.type) {
            case 'turn.created':
              turnId = event.turnId;
              break;

            case 'model.message.delta':
              if (event.content) {
                emit({ type: 'agent.delta', requestId, text: event.content });
              }
              break;

            case 'model.message':
              for (const call of event.toolCalls ?? []) {
                const onServer = call.toolInfo?.type === 'mcp';
                calls.set(call.id, { name: call.function.name, args: parseArguments(call.function.arguments), onServer });
                if (onServer) {
                  // TrueForge runs this one itself through the connector; show it as started now.
                  emit({ type: 'agent.tool', requestId, tool: call.function.name, status: 'started' });
                }
              }
              if (typeof event.content === 'string' && event.content.trim()) {
                finalText = event.content.trim();
              }
              break;

            case 'tool.response': {
              // Result of a tool TrueForge ran through the RepoPilot connector.
              const call = calls.get(event.toolCallId);
              if (call?.onServer) {
                const failure = toolFailure(event.content);
                emit({
                  type: 'agent.tool',
                  requestId,
                  tool: call.name,
                  status: failure ? 'failed' : 'succeeded',
                  ...(failure ? { detail: failure } : {}),
                });
              }
              break;
            }

            case 'tool.response_required':
              for (const ref of event.toolCalls) {
                const call = calls.get(ref.id);
                let content: string;
                if (!call) {
                  content = JSON.stringify({ error: { kind: 'validation', message: 'Unknown tool call id.' } });
                } else if (++toolCalls > MAX_TOOL_CALLS_PER_TURN) {
                  content = JSON.stringify({ error: { kind: 'validation', message: 'Tool call limit reached for this request.' } });
                  emit({ type: 'agent.warning', requestId, message: `Stopped answering tool calls after ${MAX_TOOL_CALLS_PER_TURN}.` });
                } else {
                  emit({ type: 'agent.tool', requestId, tool: call.name, status: 'started' });
                  const outcome = await this.tools.execute(call.name, call.args, {
                    origin: 'model',
                    requestId,
                    signal,
                    request,
                    context,
                    proposals,
                  });
                  emit({
                    type: 'agent.tool',
                    requestId,
                    tool: call.name,
                    status: outcome.ok ? 'succeeded' : 'failed',
                    ...(outcome.ok ? {} : { detail: outcome.error.message }),
                  });
                  content = JSON.stringify(outcome.ok ? outcome.value : { error: outcome.error });
                }
                await this.client.sendToolResponse(sessionId, turnId, { threadId: event.threadId, toolCallId: ref.id, content }, signal);
              }
              break;

            case 'tool.approval_required':
              // RepoPilot reviews edits as hunks; it never lets a tool act on approval mid-turn.
              for (const ref of event.toolCalls) {
                emit({
                  type: 'agent.warning',
                  requestId,
                  message: `Denied a TrueForge tool that asked for approval (${calls.get(ref.id)?.name ?? 'unknown tool'}). Edits are only applied through hunk review.`,
                });
                await this.client.sendToolApproval(
                  sessionId,
                  turnId,
                  { threadId: event.threadId, toolCallId: ref.id, allow: false, reason: 'Not permitted by RepoPilot.' },
                  signal,
                );
              }
              break;

            case 'turn.done':
              if (event.state.status === 'error') {
                throw new TrueForgeError('The TrueForge turn ended with an error.', 'TURN_FAILED');
              }
              if (event.state.status === 'cancelled') {
                throw new CancellationError(requestId);
              }
              break;

            default:
              break;
          }
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    } finally {
      endRun?.();
    }

    if (finalText) {
      rationale.push(finalText.slice(0, 2000));
    }
    return {
      summary: proposals.size > 0 ? `Proposed changes to ${proposals.size} file(s).` : 'No file changes were proposed.',
      rationale,
      proposals: [...proposals.values()],
    };
  }
}

/** A tool result is a failure when it is RepoPilot's SafeError JSON ({ kind, message, retryable }). */
function toolFailure(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content) as { kind?: unknown; message?: unknown; error?: { message?: unknown } };
    if (typeof parsed?.kind === 'string' && typeof parsed.message === 'string') return parsed.message;
    if (typeof parsed?.error?.message === 'string') return parsed.error.message;
  } catch {
    // plain text result: a success
  }
  return undefined;
}

function parseArguments(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { __invalidJson: true };
  }
}

export function buildPrompt(
  request: ChangeRequest,
  context: RepositoryContext,
  impact: ImpactReport | undefined,
  tools: ToolRegistry,
): string {
  const lines = [
    `Instruction: ${request.instruction}`,
    `Mode: ${request.mode}`,
  ];
  if (request.activeFile) lines.push(`Active file: ${request.activeFile}`);
  if (request.selectedText) {
    const range = request.selectionRange ? ` (lines ${request.selectionRange.startLine}-${request.selectionRange.endLine})` : '';
    lines.push(`Selected code${range}:\n\`\`\`\n${request.selectedText}\n\`\`\``);
  }
  if (context.relevantFiles.length > 0) {
    lines.push('Relevant files (ranked):');
    for (const f of context.relevantFiles) {
      lines.push(`- ${f.path}: ${f.reason}`);
      for (const ex of f.excerpts) {
        lines.push(`  lines ${ex.startLine}-${ex.endLine}:\n\`\`\`\n${ex.text}\n\`\`\``);
      }
    }
  }
  if (impact && impact.affectedFiles.length > 0) {
    lines.push('Files ImpactLens predicts may be affected (estimate, not proof):');
    for (const a of impact.affectedFiles.slice(0, 30)) {
      lines.push(`- ${a.path} (${a.risk} risk): ${a.reasons[0] ?? ''}`);
    }
  }
  lines.push(
    `Available tools: ${tools.listForModel().map((t) => t.name).join(', ')}.`,
    'Read files before changing them. Propose each changed file with propose_edit (full new content, ' +
      'workspace-relative path). Nothing is written until the user accepts hunks; you cannot apply, undo or run tests.',
  );
  return lines.join('\n\n');
}
