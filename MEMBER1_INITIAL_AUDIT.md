# MEMBER 1 INITIAL AUDIT REPORT
**Project:** RepoPilot AI  
**Role:** Member 1 — Core RepoPilot Agent & TrueForge Integration  
**Date:** November 14, 2026  
**Auditor:** Senior Software Architect & Lead Engineer (Member 1)  

---

## 1. Existing Project Structure

### 1.1 Filesystem & Git Inspection
* **Workspace Path:** `C:\Users\astha\OneDrive\Desktop\IIT_BOMBAY`
* **Directory State:** Clean / empty directory. No pre-existing source files, no legacy configuration, and no hidden files were found.
* **Git Status:** No git repository initialized yet (`fatal: not a git repository`).
* **Environment:**
  * **Operating System:** Windows 11 (PowerShell terminal)
  * **Node.js Version:** `v24.15.0` (LTS; modern built-in `fetch`, `AbortController`, and ECMAScript modules supported)
  * **npm Version:** `11.12.1`
  * **Git Version:** `2.54.0.windows.1`

### 1.2 Identified Boundaries
* No code belonging to Members 2, 3, 4, or 5 is present in this directory yet.
* This is a greenfield initialization for the RepoPilot AI repository. Member 1 must establish the shared foundation, contract layer, and core agent harness so teammates can build on top of verified interfaces without merge conflicts or duplicate type definitions.

---

## 2. Missing Requirements

To deliver Member 1's responsibilities, the following components must be created:
1. **Repository Scaffolding:** `package.json`, `tsconfig.json` (strict TypeScript), `.gitignore`, `.env.example`, and VS Code extension manifest declarations.
2. **Shared Team Contracts (`src/shared/`):** Universal interfaces for `ChangeRequest`, `RepositoryContext`, `ImpactReport`, `ProposedFileChange`, `ChangePlan`, `VerificationReport`, `ApprovalDecision`, `RepoPilotEvent`, `AgentSession`, and `ToolExecutionResult`.
3. **TrueForge Agent Integration (`src/agent/`):**
   * HTTP REST + SSE (Server-Sent Events) client.
   * Session lifecycle management (`createSession`, `createTurnStream`, `cancelTurn`).
   * Stream event parser handling incremental deltas and lifecycle events.
   * Error classification (offline server, auth failure, timeout, invalid configuration, tool execution failures).
4. **Central Agent Orchestrator (`src/agent/`):**
   * 12-state explicit state machine (`IDLE` → `INDEXING` → `PREDICTING` → `PLANNING` → `PROPOSING` → `AWAITING_APPROVAL` → `APPLYING` → `VERIFYING` → `REPAIRING` → `COMPLETED` / `CANCELLED` / `FAILED`).
   * Enforcement that no changes enter `APPLYING` without explicit user hunk approval.
5. **Central MCP Tool Server (`src/mcp/`):**
   * Tool registry and schema validation with Zod.
   * Core tools: `search_workspace`, `read_file`, `find_symbol`, `get_repository_context`, `analyse_impact`, `propose_edit`, `get_pending_changes`, `apply_approved_hunks`, `undo_changes`, `discover_tests`, `run_tests`, `get_test_results`.
   * Security layer: path traversal prevention, symlink boundary checks, protection for `.git`, `.env`, and `node_modules`.
6. **Safe Editing & Approval Engine (`src/editing/`):**
   * Pre-edit SHA-256 hash tracking.
   * Hunk-by-hunk unified diff computation using `diff`.
   * Stale proposal detection (rejecting apply if the file changed on disk post-proposal).
   * Transactional rollback and undo service.
7. **Member Integration Adapters (`src/integration/`):**
   * Adapters for Repository Context (Member 2), ImpactLens (Member 3), TestSheriff (Member 4), and UI Events (Member 5) that fail gracefully with clear "module unavailable" status if teammate modules are not yet plugged in.
8. **Automated Test Suite (`tests/`):** Unit and integration testing using Vitest covering state transitions, path security, diff calculations, approval gating, and TrueForge client connectivity.

---

## 3. Existing Reusable Code

* **Current Codebase:** No existing reusable code in this folder.
* **Implication:** All structures will be created cleanly following official TypeScript, VS Code Extension, Model Context Protocol (MCP), and TrueForge SDK specifications.

---

## 4. TrueForge Integration Findings & Official References

### 4.1 Official References
* **Repository:** [https://github.com/truefoundry/trueforge](https://github.com/truefoundry/trueforge)
* **TrueForge Platform:** [https://trueforge.dev/](https://trueforge.dev/)
* **Local CLI Launcher:** `npx @truefoundry/trueforge@latest`
* **TrueFoundry Documentation:** [https://docs.truefoundry.com/](https://docs.truefoundry.com/)
* **Model Context Protocol (MCP) Standard:** [https://modelcontextprotocol.io/](https://modelcontextprotocol.io/)

### 4.2 Verified Runtime Architecture
1. **Role of TrueForge:** TrueForge is an open-source, vendor-neutral agent harness and runtime layer. It manages the agent execution loop, session states, context compaction, tool execution, and model calls.
2. **Provider Isolation Rule:** The VS Code extension **never** communicates directly with LLM providers (such as OpenAI, Anthropic, or Gemini). All reasoning loops, prompt construction, and LLM queries are handled by the local TrueForge agent harness.
3. **Local Quickstart & Execution:**
   * Started locally via `npx @truefoundry/trueforge@latest`.
   * Uses local SQLite for session and state persistence.
   * Default HTTP port: `http://localhost:8000` (configurable via `TRUEFORGE_BASE_URL` or VS Code configuration `repopilot.trueforgeUrl`).
4. **Verified HTTP & SSE Endpoints:**
   * `GET /api/v1/health` or `GET /`: Health check and server readiness.
   * `POST /api/v1/sessions`: Creates an isolated session for a user request context.
   * `GET /api/v1/sessions/{sessionId}`: Inspects session state and history.
   * `POST /api/v1/sessions/{sessionId}/turns`: Submits prompt/instructions and initiates an SSE (`text/event-stream`) turn stream.
   * `POST /api/v1/sessions/{sessionId}/turns/{turnId}/cancel`: Cancels an active in-flight turn.
5. **Event Contract & Streaming:**
   * Emits typed Server-Sent Events (`TurnStreamingEvent`).
   * Handles incremental event updates using `id`, `event` delta merging (`isEventDelta`, `mergeEventDelta`), tool call proposals, tool result submissions, model thought tokens, and completion checkpoints.
6. **Tool Integration via MCP:**
   * TrueForge natively connects to Model Context Protocol (MCP) servers.
   * Supports deferred tool loading: tool catalog metadata is shared initially; schemas and calls are loaded dynamically upon model invocation.

---

## 5. Required Dependencies

### 5.1 Runtime Dependencies
* `@modelcontextprotocol/sdk`: Official TypeScript SDK for Model Context Protocol tools and servers.
* `zod`: Runtime type validation for MCP tool arguments, configurations, and shared messages.
* `diff`: Compute unified diffs, parse hunks, and calculate patches safely in-memory.

### 5.2 Development & Build Dependencies
* `typescript` (strict mode): Type-safe codebase.
* `vitest`: Fast, modern unit and integration test runner.
* `@types/node`: Node.js typings.
* `@types/diff`: TypeScript definitions for `diff`.
* `@types/vscode`: VS Code extension API definitions.

---

## 6. Proposed Implementation Plan (Phases 1–10)

```
Phase 1: Project Audit & Architecture (Current)
    └── Inspect environment, verify TrueForge specifications, publish MEMBER1_INITIAL_AUDIT.md
Phase 2: Shared Types & Team Contracts
    └── Create src/shared/ (types, events, errors, contracts) & MEMBER1_TEAM_CONTRACTS.md
Phase 3: TrueForge Integration
    └── Implement TrueForge HTTP+SSE client, session manager, turn stream parser, cancellation, error classifier
Phase 4: MCP Server & Tool Registry
    └── Implement MCP registry, Zod schemas, path security validator, and read/edit/test tool definitions
Phase 5: Agent Orchestrator & Event Streaming
    └── Implement 12-state state machine, request lifecycle, turn dispatch, and typed event pipeline
Phase 6: Safe Editing & Approval Workflow
    └── Implement hash tracking, in-memory diff/hunk generation, approval gate, atomic apply, and undo service
Phase 7: Team Adapters (Members 2, 3, 4, 5)
    └── Implement adapters for Context, ImpactLens, TestSheriff, and UI Events with honest unavailability handling
Phase 8: Unit & Integration Testing
    └── Write comprehensive test suite in tests/ (Vitest), path safety tests, approval enforcement tests
Phase 9: Documentation & Handoff Package
    └── Create MEMBER1_ARCHITECTURE.md, MEMBER1_SETUP.md, MEMBER1_TEST_REPORT.md, MEMBER1_HANDOFF.md
Phase 10: Clean ZIP-Ready Packaging
    └── Create member-1-core-repopilot/ package and verify member-1-core-repopilot.zip
```

---

## 7. Potential Integration Conflicts & Mitigations

| Potential Conflict | Cause | Member 1 Preventive Mitigation |
| :--- | :--- | :--- |
| **Teammate Contract Drift** | Teammates inventing different names for fields (e.g., `diff` vs `unifiedDiff`) | Phase 2 publishes `MEMBER1_TEAM_CONTRACTS.md` and freezes `src/shared/contracts/index.ts` as the single shared source of truth. |
| **Silent File Mutation** | Agent writing files directly before user review | Tool `propose_edit` is strictly read-only and in-memory; write capability is gated inside `apply_approved_hunks` behind explicit approval decisions. |
| **Path Traversal / Secret Exposure** | Agent reading files like `.env`, `.git/config`, or escaping repo root | Path validator resolves real canonical paths, blocks `..` escapes, and rejects protected filenames. |
| **Stale Overwrite Race Conditions** | File modified by user in editor while agent is planning | Baseline file SHA-256 hash is recorded in `ProposedFileChange`. If current disk hash does not match, apply is rejected with `StaleFileError`. |
| **Line Ending (CRLF vs LF) Mismatches** | Windows vs Linux diff inconsistencies | Diff engine normalizes line breaks before computing hunks and SHA-256 hashes. |
| **Teammate Modules Missing at Startup** | Member 2, 3, or 4 code not yet cloned or ready | Adapters gracefully catch missing modules, emit clear status (`not-installed` / `offline`), and allow the core agent to proceed with warnings. |

---

## 8. Questions & Blockers

1. **TrueForge Local Service:** To perform live end-to-end integration tests, TrueForge should be running locally (`npx @truefoundry/trueforge@latest`). In automated CI or offline mode, integration tests will detect unavailability and mark live network tests as `BLOCKED (Server Offline)` rather than falsely passing or failing.
2. **Git Initialization:** Branch `feature/core-agent` will be initialized upon starting Phase 2.
3. **No Blockers:** All requirements, SDK specifications, and architectural boundaries are crystal clear.

---

### Audit Sign-Off
Member 1 Initial Audit is complete and verified. Ready to proceed to **Phase 2 (Shared Types & Team Contracts)** upon user confirmation.
