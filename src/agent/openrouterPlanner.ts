// OWNER: OpenRouter Gemma 4 Planner for RepoPilot AI
import * as https from 'https';
import type { AgentPlanner, PlanInput, PlanResult } from './planner';
import { buildPrompt } from './planner';
import type { ToolRegistry } from '../mcp/toolRegistry';
import type { FileProposal } from '../shared/contracts';
import { listWorkspaceFiles } from '../repository/workspace-scanner';

export interface OpenRouterPlannerOptions {
  apiKey?: string;
  model?: string;
  fallbackModels?: string[];
  baseUrl?: string;
  workspaceRoot?: string;
}

const DEFAULT_API_KEY = process.env.OPENROUTER_API_KEY || '';
const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free';
export const DEFAULT_FALLBACK_MODELS = [
  'nvidia/nemotron-3.5-lightning:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'openrouter/auto',
];
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export class OpenRouterPlanner implements AgentPlanner {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fallbackModels: string[];
  private readonly baseUrl: string;
  private readonly workspaceRoot?: string;

  constructor(
    private readonly tools: ToolRegistry,
    options: OpenRouterPlannerOptions = {},
  ) {
    this.apiKey = options.apiKey || DEFAULT_API_KEY;
    this.model = options.model || DEFAULT_MODEL;
    this.fallbackModels = options.fallbackModels && options.fallbackModels.length > 0
      ? options.fallbackModels
      : DEFAULT_FALLBACK_MODELS;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.workspaceRoot = options.workspaceRoot;
  }

  async plan({ request, context, impact, signal, emit }: PlanInput): Promise<PlanResult> {
    const { requestId } = request;
    const proposals = new Map<string, FileProposal>();

    emit({
      type: 'agent.status',
      requestId,
      state: 'planning',
      message: `Analyzing AST & ImpactLens call-graph with OpenRouter (${this.model})...`,
    });

    emit({
      type: 'agent.tool',
      requestId,
      tool: 'read_file',
      status: 'succeeded',
      detail: request.activeFile || 'context loaded',
    });

    let workspaceFileTree = '';
    if (this.workspaceRoot) {
      try {
        const scan = await listWorkspaceFiles(this.workspaceRoot);
        if (scan.files && scan.files.length > 0) {
          workspaceFileTree = [
            'Files & Folders in current workspace:',
            ...scan.files.slice(0, 120).map((f) => `- ${f}`),
          ].join('\n');
        }
      } catch {}
    }

    const modeSpecificInstruction = request.mode === 'inline'
      ? [
          'MODE: INLINE EDIT',
          `- You are editing the selected code in "${request.activeFile}".`,
          '- Confine your modifications strictly to the selected function, logic, and docstrings as requested.',
          '- Provide the full new content of the active file with the updated function and docstring in your file proposal.',
        ].join('\n')
      : [
          'MODE: AGENT MODE (MULTI-FILE DISCOVERY)',
          '- Autonomously locate and inspect the relevant files across the project without requiring the user to name them.',
          '- If the request asks for a new CLI command or feature covered by tests and documentation (e.g. built-in CLI commands), you must discover and propose edits to AT LEAST THREE files (e.g., CLI implementation, tests, and documentation).',
        ].join('\n');

    const systemPrompt = [
      'You are RepoPilot AI, an autonomous software engineering agent running for the TrueFoundry Forge-a-thon.',
      'You have complete capabilities to:',
      '1. AUTONOMOUS FILE CREATION (FileWrite): Create brand new files inside any folder or subfolder (e.g. "landing/index.html", "src/flask/..."). Parent folders are created automatically.',
      '2. SURGICAL FILE EDITING (FileEdit): Edit existing files across any folder in the project with precision.',
      '3. MULTI-FILE ORCHESTRATION: Propose changes or new files across multiple files simultaneously in the "files" array.',
      '4. CONTEXT ASSEMBLY & SEARCH: Use repository context and path searching. Inspect code thoroughly before editing.',
      '5. ZERO SILENT WRITES: All changes and creations are proposed as reviewable diff hunks before application.',
      '',
      modeSpecificInstruction,
      '',
      'First, provide your clear, structured narrative analysis and thought process in markdown.',
      'Then, if code changes or new files are proposed, output a single JSON block at the very end in this exact schema:',
      '```json',
      '{',
      '  "summary": "Short headline of what changed or was created",',
      '  "rationale": ["Reason 1", "Reason 2"],',
      '  "files": [',
      '    {',
      '      "path": "folder/subfolder/file.ext",',
      '      "newContent": "FULL updated or created file content (never truncated)",',
      '      "rationale": "Reason for creating or modifying this file"',
      '    }',
      '  ]',
      '}',
      '```',
      'Important Rules:',
      '- For HTML landing pages, produce modern, complete, responsive HTML5 code with styling (embedded CSS or Tailwind CDN), responsive layout, hero section, features, CTA, and footer.',
      '- Always use workspace-relative POSIX paths with forward slashes (e.g. "landing/index.html", "src/flask/helpers.py"). Never use absolute paths like "C:\\...".',
      '- Always supply the complete, unclipped file content in "newContent".',
      '- If the user only asks to navigate, explore, inspect, or explain files/folders without modifying code, do NOT output a JSON block.',
    ].join('\n');

    const basePrompt = buildPrompt(request, context, impact, this.tools);
    const userPrompt = workspaceFileTree
      ? `${workspaceFileTree}\n\n${basePrompt}`
      : basePrompt;

    const modelsToTry = [this.model, ...this.fallbackModels.filter(m => m !== this.model)];
    let rawResponse = '';
    let lastError: Error | null = null;

    for (let i = 0; i < modelsToTry.length; i++) {
      const currentModel = modelsToTry[i];
      if (signal.aborted) break;

      try {
        if (i > 0) {
          emit({
            type: 'agent.warning',
            requestId,
            message: `Rate limit hit upstream. Automatically switching to fallback model: ${currentModel}...`,
          });
        }
        rawResponse = await this.callApi(currentModel, systemPrompt, userPrompt, signal, (delta) => {
          emit({ type: 'agent.delta', requestId, text: delta });
        });
        lastError = null;
        break;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.message;
        const isRateLimit = msg.includes('429') || msg.includes('rate-limit') || msg.includes('rate-limited') || msg.includes('upstream_provider_shared_pool');
        if (isRateLimit && i < modelsToTry.length - 1) {
          continue;
        }
        throw lastError;
      }
    }

    if (!rawResponse && lastError) {
      throw lastError;
    }

    // Robust proposal extraction: find fenced JSON blocks with { files } or { summary } or single { path, newContent }
    let parsed: any = null;
    const extractedFiles: Array<{ path: string; newContent: string; rationale?: string }> = [];

    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
    let match: RegExpExecArray | null;
    while ((match = codeBlockRegex.exec(rawResponse)) !== null) {
      const candidate = match[1].trim();
      try {
        const obj = JSON.parse(candidate);
        if (obj) {
          if (Array.isArray(obj.files)) {
            parsed = obj;
            for (const f of obj.files) {
              if (f?.path && (f?.newContent !== undefined || f?.proposedContent !== undefined)) {
                extractedFiles.push({ path: f.path, newContent: String(f.newContent ?? f.proposedContent), rationale: f.rationale });
              }
            }
          } else if (obj.path && (obj.newContent !== undefined || obj.proposedContent !== undefined)) {
            parsed = obj;
            extractedFiles.push({ path: obj.path, newContent: String(obj.newContent ?? obj.proposedContent), rationale: obj.rationale });
          } else if (obj.summary) {
            parsed = obj;
          }
        }
      } catch {
        // Slicing fallback for unescaped quotes in large raw files (e.g. HTML attributes)
        const pathMatch = candidate.match(/"path"\s*:\s*"([^"]+)"/);
        const contentIdx = candidate.indexOf('"newContent"');
        if (pathMatch && contentIdx !== -1) {
          const colonIdx = candidate.indexOf(':', contentIdx);
          const quoteStart = candidate.indexOf('"', colonIdx + 1);
          if (quoteStart !== -1) {
            const ratMatch = candidate.match(/,\s*"rationale"\s*:\s*"/);
            let rawContent = '';
            if (ratMatch && ratMatch.index !== undefined && ratMatch.index > quoteStart) {
              rawContent = candidate.slice(quoteStart + 1, ratMatch.index);
            } else {
              const lastQuote = candidate.lastIndexOf('"');
              if (lastQuote > quoteStart) rawContent = candidate.slice(quoteStart + 1, lastQuote);
            }
            if (rawContent) {
              const cleanContent = rawContent.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
              extractedFiles.push({ path: pathMatch[1], newContent: cleanContent });
            }
          }
        }
      }
    }

    if (extractedFiles.length === 0 && !parsed) {
      const lastBrace = rawResponse.lastIndexOf('}');
      if (lastBrace !== -1) {
        for (let i = lastBrace - 1; i >= 0; i--) {
          if (rawResponse[i] === '{') {
            try {
              const candidate = JSON.parse(rawResponse.slice(i, lastBrace + 1));
              if (candidate) {
                if (Array.isArray(candidate.files)) {
                  parsed = candidate;
                  for (const f of candidate.files) {
                    if (f?.path && (f?.newContent !== undefined || f?.proposedContent !== undefined)) {
                      extractedFiles.push({ path: f.path, newContent: String(f.newContent ?? f.proposedContent), rationale: f.rationale });
                    }
                  }
                  break;
                } else if (candidate.path && (candidate.newContent !== undefined || candidate.proposedContent !== undefined)) {
                  parsed = candidate;
                  extractedFiles.push({ path: candidate.path, newContent: String(candidate.newContent ?? candidate.proposedContent), rationale: candidate.rationale });
                  break;
                }
              }
            } catch {}
          }
        }
      }
    }

    let summary = parsed?.summary ? String(parsed.summary) : (extractedFiles.length > 0 ? `Proposed ${extractedFiles.length} file change(s)` : (rawResponse.trim().slice(0, 150) || 'Completed.'));
    const rationale: string[] = parsed?.rationale && Array.isArray(parsed.rationale)
      ? parsed.rationale.map(String)
      : [rawResponse.trim() || 'Generated by OpenRouter model'];

    if (extractedFiles.length > 0) {
      for (const f of extractedFiles) {
        let cleanPath = f.path.replace(/\\/g, '/').replace(/^\.?\/+/, '');
        if (this.workspaceRoot) {
          const normRoot = this.workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
          if (cleanPath.toLowerCase().startsWith(normRoot.toLowerCase() + '/')) {
            cleanPath = cleanPath.slice(normRoot.length + 1);
          }
        }
        const content = f.newContent;
        const fileRationale = f.rationale ? String(f.rationale) : summary;

        emit({
          type: 'agent.tool',
          requestId,
          tool: 'propose_edit',
          status: 'started',
          detail: cleanPath,
        });
        const outcome = await this.tools.execute(
          'propose_edit',
          { path: cleanPath, proposedContent: content, rationale: fileRationale },
          { origin: 'model', requestId, signal, request, context, proposals },
        );
        emit({
          type: 'agent.tool',
          requestId,
          tool: 'propose_edit',
          status: outcome.ok ? 'succeeded' : 'failed',
          ...(outcome.ok ? {} : { detail: outcome.error.message }),
        });
      }
    }

    return {
      summary,
      rationale,
      proposals: Array.from(proposals.values()),
    };
  }

  private callApi(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    signal: AbortSignal,
    onDelta?: (text: string) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        return reject(new Error('Operation aborted'));
      }

      const postData = JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
      });

      const endpoint = `${this.baseUrl}/chat/completions`;
      const url = new URL(endpoint);

      const req = https.request({
        hostname: url.hostname,
        port: url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        protocol: url.protocol,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/repopilot-ai',
          'X-Title': 'RepoPilot AI',
        },
      }, (res) => {
        let fullData = '';

        res.on('data', (chunk: Buffer) => {
          const str = chunk.toString();
          fullData += str;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`OpenRouter HTTP ${res.statusCode}: ${fullData}`));
          }
          try {
            const parsed = JSON.parse(fullData);
            const content = parsed.choices?.[0]?.message?.content || '';
            if (content) {
              onDelta?.(content);
            }
            resolve(content);
          } catch (e) {
            reject(new Error(`Failed to parse OpenRouter response: ${e}`));
          }
        });
      });

      const onAbort = () => {
        req.destroy();
        reject(new Error('Cancelled by user'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(postData);
      req.end();
    });
  }
}
