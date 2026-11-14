# Member 1 --- Core RepoPilot Agent & TrueForge Integration

**Branch:** `feature/core-agent`\
**Ownership:** `src/agent/`, `src/mcp/`, shared contracts/events,
extension-host orchestration.\
**Outcome:** One central TrueForge-powered agent coordinates RepoPilot,
ImpactLens and TestSheriff.

## Instructions to Antigravity

You are the senior TypeScript, VS Code and TrueForge engineer for
Member 1. Treat this document as your implementation contract. First
inspect the repository, branch, `git status`, `AGENTS.md`, package
files, current source and all shared types. Do not modify anything until
you produce a read-only reconnaissance report and phased plan with exact
files, SDK/API evidence, risks, dependencies and tests. Never overwrite
another member's uncommitted work.

## 1. Product architecture

RepoPilot AI is one VS Code extension with three modular capabilities: -
Layer 1 Core RepoPilot: context orchestration, planning, proposed edits
and agent workflow. - Layer 2 ImpactLens: pre-edit impact report. -
Layer 3 TestSheriff: post-edit test verification.

Use **one central TrueForge agent loop**, not three autonomous agents.
The extension is a TrueForge client. All workspace/editor capabilities
used by the agent must be exposed as MCP tools. Never call OpenAI,
Gemini, Anthropic or another model provider directly from extension
code.

## 2. Competition requirements --- mandatory

Build and verify all five: 1. Inline edit: user selects code, invokes
command/keybinding, enters instruction and sees an editor-rendered diff.
2. Agent mode: one request triggers a TrueForge tool loop that discovers
files itself and changes at least three files without user naming them.
3. Context assembly: `@file`, `@symbol` and automatic retrieval of
relevant unnamed code, with a context budget and visible selection
reasons. 4. Diff review: hunk-by-hunk preview, accept/reject each hunk,
undo applied changes; no silent disk writes. 5. Streaming/cancellation:
streamed TrueForge events, responsive editor, cancellation leaves
workspace consistent and no partial edits.

Also demonstrate resilience: invalid model key or unreachable endpoint
gives a clear error (or configured fallback) and leaves workspace
unchanged.

## 3. Shared technology decisions

-   Node.js LTS, npm, TypeScript strict mode.
-   VS Code Extension API.
-   React + Vite webview; privileged operations stay in extension host.
-   Local TrueForge using the current documented HTTP API or
    `@truefoundry/trueforge-core` SDK.
-   Official MCP TypeScript SDK for tool protocol.
-   Zod for runtime validation.
-   `diff`/jsdiff plus VS Code diff APIs and `WorkspaceEdit`.
-   Vitest, `@vscode/test-electron`; pytest for Flask challenge.
-   No database, hosted backend, user accounts or Marketplace publishing
    for Round 1.

Do not guess TrueForge methods, event names or config keys. Inspect the
current SDK quickstart, installed package exports and TypeScript
declarations. Record actual package versions in lockfile.

## 4. Shared contract --- create once and have everyone import it

Create `src/shared/contracts/index.ts` before module implementation.
Coordinate with all members and merge this contract first.

``` ts
export type RiskLevel = "low" | "medium" | "high";
export interface ChangeRequest {
  requestId: string;
  instruction: string;
  mode: "inline" | "agent";
  activeFile?: string;
  selectedText?: string;
  selectionRange?: { startLine: number; endLine: number };
  explicitFileMentions: string[];
  explicitSymbolMentions: string[];
}
export interface RepositoryContext {
  root: string;
  relevantFiles: Array<{path:string; reason:string; score:number;
    excerpts?:Array<{startLine:number;endLine:number;text:string}>}>;
  relevantSymbols: Array<{name:string;file:string;kind:string;startLine:number}>;
  dependencyEdges: Array<{from:string;to:string;kind:"imports"|"references"}>;
  tokenEstimate: number;
}
export interface ImpactReport {
  requestId:string; generatedAt:string;
  affectedFiles:Array<{path:string;risk:RiskLevel;score:number;
    reasons:string[];relatedSymbols?:string[]}>;
  graph:Array<{id:string;label:string;kind:"file"|"symbol"}>;
  edges:Array<{source:string;target:string;kind:string}>;
  limitations:string[];
}
export interface ProposedFileChange {
  path:string; originalContentHash:string; proposedContent:string;
  unifiedDiff:string;
  hunks:Array<{hunkId:string;oldStart:number;oldLines:number;
    newStart:number;newLines:number;diffText:string}>;
}
export interface ChangePlan {
  requestId:string; summary:string; files:ProposedFileChange[];
  impactReport?:ImpactReport; rationale:string[];
}
export interface VerificationReport {
  requestId:string; command:string;
  status:"passed"|"failed"|"cancelled"|"error"|"not-run";
  exitCode:number|null; durationMs:number;
  passed:number|null; failed:number|null; skipped:number|null;
  stdoutTail:string; stderrTail:string; failureSummaries:string[];
}
```

Shared typed events: - `agent.status`: requestId, state, message. -
`agent.delta`: requestId, text. - `context.ready`: requestId,
RepositoryContext. - `impact.ready`: requestId, ImpactReport. -
`change.proposed`: requestId, ChangePlan. - `change.applied` /
`change.undone`: requestId, changedPaths. - `verification.completed`:
requestId, VerificationReport. - `agent.error`: requestId, safe message,
retryable.

If a member needs a contract change, require a proposal and update all
consumers/tests together. No duplicate type definitions.

## 5. Required implementation phases

### Phase A --- TrueForge smoke test

1.  Verify Node/npm and read TrueForge quickstart.
2.  Start local TrueForge using its current documented command
    (competition currently specifies
    `npx @truefoundry/trueforge@latest`).
3.  Configure model in TrueForge, not extension.
4.  Add configurable TrueForge base URL using documented default.
5.  Connect, create/reuse session, send a harmless prompt and receive
    streamed events.
6.  Verify cancellation and unavailable-server error. Acceptance: local
    session, streaming, cancellation and failure state all work.

### Phase B --- MCP tools

Register validated tools (names below are project names, not assumed SDK
APIs): - `search_workspace` - `read_file` - `find_symbol` -
`get_repository_context` - `analyse_impact` - `propose_edit` -
`apply_approved_hunks` - `undo_changes` - `discover_tests` -
`run_tests` - `get_test_results`

Each tool must validate input, constrain paths to workspace, enforce
size/time limits, return structured errors and redact secrets.
`propose_edit` MUST NOT write to disk.

### Phase C --- Orchestration

Implement request lifecycle: 1. Receive inline or agent `ChangeRequest`.
2. Ask repository service for context; honour mentions, active file and
selection. 3. Call ImpactLens before planning. If unavailable, continue
with a visible warning; optional analysis must not block core tasks. 4.
Let TrueForge agent plan and call MCP tools to read/search. 5. Validate
proposed paths and calculate diffs against current disk content. 6. Emit
`change.proposed` and wait for explicit per-hunk decisions. 7. Before
apply, verify original content hash/version has not changed. 8. Apply
only approved hunks. 9. Call TestSheriff and report observed results.
10. If tests fail, ask agent to propose a repair; the repair creates a
new diff and requires approval again. 11. Emit final summary and status.

### Phase D --- Cancellation and resilience

Use request-scoped cancellation (AbortController or supported
equivalent). Cancellation must stop generation/tool work. Before
approval, cancellation means no file changes. During apply, use atomic
per-file/transactional handling and rollback if safe; verify workspace
state. Classify network, authentication/config, rate-limit, timeout,
tool error and user cancellation separately. Use bounded retries only
for transient failures. Any fallback must be a documented TrueForge
feature; do not implement provider-specific model calls in the
extension.

## 6. Security

-   Search/read tools are read-only.
-   No write tool can apply changes without review approval.
-   Reject path traversal, absolute paths outside workspace, symlink
    escapes and protected paths (`.env`, `.git`, `node_modules`) unless
    explicitly allowed.
-   Run commands with workspace cwd, timeout, output cap and approval
    policy.
-   Never commit credentials or log API keys.
-   Preserve pre-existing user changes.

## 7. Tests and acceptance

Unit tests: schemas, path safety, state transitions, event mapping,
cancellation, retry classification, stale-hash rejection, no writes
before approval. Integration tests: TrueForge connection,
session/stream, MCP discovery/calls, proposal/review/apply/undo,
cancellation leaves workspace unchanged. Fixed demo: - A: inline
`get_debug_flag` edit. - B: agent discovers 3+ files for `flask config`,
masks `SECRET`, `PASSWORD`, `TOKEN`, `KEY`, adds test/docs/help. - C:
invalid key/unreachable endpoint; editor responsive and `git status`
unchanged.

## 8. Collaboration and Antigravity rules

Shared repo branches: `feature/core-agent`,
`feature/repository-context`, `feature/impactlens`,
`feature/testsheriff`, `feature/ui-diff`. Merge shared contracts first.
Own only assigned folders. Small PRs, daily integration, `main` stays
runnable. Before every edit check branch and `git status`. Do not run
destructive commands or mass refactors without approval. Implement in
phases and run focused tests after each.

## 9. Definition of done

-   [ ] TrueForge local session works and is visible in demo.
-   [ ] No direct model-provider API calls in extension.
-   [ ] Editor capabilities exposed as MCP tools.
-   [ ] Streaming and cancellation work.
-   [ ] All writes require hunk approval.
-   [ ] Shared contracts consumed by all modules.
-   [ ] Fixed tasks A/B/C rehearsed.
-   [ ] Agent definition committed; README clean-clone setup works.

## 10. Antigravity first prompt

"Act as Member 1's senior engineer. Follow this document. First do
read-only reconnaissance and present exact implementation phases, files,
current TrueForge SDK/API evidence, risks and tests. Do not code until
the plan is shown. Then implement only Member 1-owned folders in small
verified phases. Do not invent SDK methods, overwrite teammates' work,
call model providers directly or apply edits without explicit hunk
approval. Report changed files, exact commands and observed test results
after each phase. End with a handoff to Members 2--5."

## Official references

-   Competition statement:
    https://techfest.org/media/compiProbStatement/TrueFoundry_Forge-a-thon_compressed_UvvRJ9C.pdf
-   TrueForge: https://github.com/truefoundry/trueforge and
    https://trueforge.dev/
-   Antigravity: https://antigravity.google/docs and
    https://antigravity.google/docs/rules-workflows?tab=ide
-   VS Code: https://code.visualstudio.com/api
-   MCP: https://modelcontextprotocol.io/
