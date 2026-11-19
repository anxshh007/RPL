# Member 1 (core agent): R6 integration changes

This folder is the team repository layout (`main`) with every module in place:

| Module | Source used |
|---|---|
| `src/shared/contracts/*`, `src/mcp/tool-names.ts` | `main`, **unchanged** (diff against `main` is empty) |
| `src/repository/` (Member 2) | `feature/repository-context`, round 2 |
| `src/impact/` (Member 3) | `feature/impactlens` |
| `src/verification/` (Member 4) | `feature/testsheriff`, round 3 |
| `src/agent/`, `src/edits/`, `src/mcp/`, `src/config/` (Member 1) | Astha's R5, rewritten to fit `main`'s contracts (below) |

Only Member 1's folders hold new code. Two small edits outside them were needed because
`createRepoPilot` now requires the workspace folder; both are marked in the code:

- `src/extension/extension.ts` (Member 5): passes `workspaceRoot` and the `repopilot.*` settings,
  and asks "Run the relevant tests now?" after a successful apply (D-12).
- `tests/unit/shared/contracts.test.ts` (shared): `createEditService()` gets a temp folder.

## What changed in Member 1's code, and why

1. **Built on `main`'s contracts only.** All the R5 contract copies are gone. `ApplyResult` and
   `UndoResult` now have exactly `main`'s fields and statuses (`requestId`, `appliedHunkIds`,
   `nothing_to_apply`, `restoredPaths`…). Events use `main`'s `agent.status` states (`starting`,
   `retrieving_context`, `analysing_impact`, `planning`, `review_required`, `applying`, `verifying`,
   `completed`, `cancelled`, `error`) with no `timestamp`. `agent.tool` uses `detail?: string`.
2. **Errors.** The extra error classes (`CancellationError`, `TrueForgeError`, `ValidationError`,
   `SecurityError`…) now live in `src/agent/errors.ts` and extend `main`'s `RepoPilotError`, so
   `toSafeError()` classifies them (network / auth_config / timeout / rate_limit / validation / cancelled).
3. **One controller.** `RepoPilotController` (`src/agent/controller.ts`, `main`'s name and constructor)
   is the orchestrator. The TrueForge loop plugs in as an `AgentPlanner` (`src/agent/planner.ts`).
   The previous orchestrator, session, state-machine, event-stream and cancellation classes were
   replaced by this one file.
4. **Real modules, no adapters.** `createRepoPilot({ workspaceRoot })` builds Member 2's
   `createRepositoryIntelligence`, Member 3's `createImpactAnalyser`, Member 4's
   `createVerificationService(workspaceRoot)` and the edit service. The MCP layer registers each
   module's own `tools.ts` handlers (D-07); the delegate/adapter classes were removed.
5. **Edit service** (`src/edits/`): implements `main`'s `EditService`. Hunks are matched by
   path + hunkId; stale files are refused before anything is written; each write is atomic and rolled
   back on error; undo refuses if a file changed after apply. `createEditService(workspaceRoot)` exists
   again. Fixed: creating a new file used to start it with an extra blank line.
6. **MCP** (`src/mcp/`): one `ToolRegistry` for all 12 tools. The model sees only `READ_ONLY_TOOLS`;
   `apply_approved_hunks`, `undo_changes` and `run_tests` are refused unless the user triggers them.
   `propose_edit` only collects proposals for review. The MCP server uses the SDK's low-level `Server`:
   the high-level `McpServer.tool()` with Zod 3.25 made `tsc` hang ("type instantiation is excessively
   deep"); one such call took 80 s to type-check, R5 had 12.
7. **TrueForge** (`src/agent/trueforgeClient.ts`): the SDK's CommonJS build cannot be `require`d
   (it sits in a `"type": "module"` package), so the ESM build is loaded with a dynamic import.
   Stream reads race the abort signal, so cancel returns at once even if the server stops sending.
   `tool.approval_required` is denied (edits only go through hunk review). With no
   `repopilot.trueforge.baseUrl` (D-15 ships it empty) the run says "not configured" and proposes nothing.
8. **Tests waiting for approval (D-12).** After apply, tests run only when the user agrees
   (`runVerification(requestId)`), or right away when `repopilot.tests.requireApproval` is false.
   TestSheriff gets ImpactLens's `testCandidates` from the plan.
9. **No `process.cwd()` fallback** anywhere: `createRepoPilot`, `createEditService` and the stdio MCP
   entry (`REPOPILOT_WORKSPACE_ROOT`) all need the folder.
10. Removed: `.env.example` (no code reads those variables) and the R5 docs, which described the
    old design and its unreproducible "55 passed".

## Packages (D-09: Member 1 adds these first)

`zod@3.25.76`, `diff@7.0.0`, `@types/diff@7.0.2`, `@modelcontextprotocol/sdk@1.32.2`,
`@truefoundry/trueforge-sdk@0.185.0`, `zod-to-json-schema@3.25.2`, the versions R5 had locked.
They're recorded in `package-lock.json`.

## How it was tested (real output)

Windows 11, Node v24.19.0, Python 3.12, pytest 9.2.0:

```
npm run compile   → exit 0
npm test          → tests 346, pass 346, fail 0, skipped 0
```

The full output is in `npm-test-output.txt`, next to this file. The suite was run three times
in a row with the same result. Member 1's tests:

- `tests/unit/agent/pipeline.test.ts`: the whole flow with the real repository, ImpactLens,
  TestSheriff (real pytest) and edit service. Only the TrueForge server is a scripted fake that sends
  the SDK's own event types. It covers context → impact → tool calls (`read_file`, `propose_edit`, and a
  refused `apply_approved_hunks`) → proposal with nothing written → apply → tests passed → undo, plus
  cancel mid-turn, turn error, denied tool approval, and running without a baseUrl.
- `tests/unit/edits/edit-service.test.ts`: partial hunk apply, path + hunk matching, stale refusal,
  CRLF, create/delete/modify undo, undo refused after later edits, unsafe paths.
- `tests/unit/mcp/tools.test.ts`: 12 tools registered, model allowlist, refusals, module handlers,
  and the MCP server over the SDK's in-memory transport.
- `tests/unit/agent/trueforge-client.test.ts`: settings validation and SDK error classification.

Also checked by hand:

- The stdio MCP server, started as its own process on the Flask fixture, listed exactly the
  9 read-only tools, answered `find_symbol`, and refused `undo_changes`.
- The real TrueForge SDK against a closed port returned `healthCheck() = false` and a `network` /
  `SERVER_OFFLINE` error.

**Not run live:** no TrueForge server was available, so a real model turn was not run.
The SDK calls follow the installed SDK's type definitions (`sessions.create`, `createTurnStream`,
`createTurnEvents`, `cancel`). How the TrueForge agent `repopilot-core` gets RepoPilot's tools (client
tools answered via `tool.response_required`, or the MCP server registered on the TrueForge side) has to
be confirmed against the TrueForge docs and a running server before the demo.
