# RepoPilot AI — Core Agent & TrueForge Integration

> **An Impact-Aware Autonomous Coding Agent with Automated Verification**  
> **Role:** Member 1 — Central Agent Architecture, TrueForge Integration, MCP Tool Server, Safe Editing Engine & Shared Contracts  
> **Branch:** `feature/core-agent`  

---

## 1. Product Architecture Overview

RepoPilot AI integrates three powerful capabilities into a single, cohesive developer workflow:

1. **RepoPilot Core (Layer 1 — Repository Intelligence):** Indexes the repository, discovers relevant files and symbols, retrieves context within token budgets, and plans multi-file changes.
2. **ImpactLens (Layer 2 — Predictive Intelligence):** Predicts affected files, symbols, dependencies, and tests *before* edits are applied.
3. **TestSheriff (Layer 3 — Automated Verification):** Discovers and runs relevant tests post-edit, analyzes failures, and provides empirical verification reports.

```
                  VS CODE EXTENSION
                         |
               RepoPilot Webview UI (Member 5)
                         |
                 Extension Controller
                         |
              TrueForge Agent Loop (Member 1)
                         |
        +----------------+----------------+
        |                |                |
  Repository         ImpactLens       TestSheriff
  Intelligence       Engine           Engine
  (Member 2)         (Member 3)       (Member 4)
        |                |                |
  File Search       Dependency       Test Discovery
  Symbol Index      Graph            Test Execution
  Context Retrieval Impact Analysis  Failure Analysis
        +----------------+----------------+
                         |
                 Central MCP Server
                         |
                 Safe Editing Engine
             (Approval Gate & SHA-256 Check)
                         |
               Local Workspace Files
```

### Architectural Golden Rule
**ImpactLens and TestSheriff are capabilities called by the same central TrueForge agent loop, not separate autonomous agents.**  
This eliminates orchestration complexity, prevents context duplication, and ensures predictable, verifiable workflows.

---

## 2. Core Capabilities Implemented by Member 1

* **Central Agent Orchestrator (`src/agent/`):**
  * Explicit 12-state state machine: `IDLE` $\rightarrow$ `INDEXING` $\rightarrow$ `PREDICTING` $\rightarrow$ `PLANNING` $\rightarrow$ `PROPOSING` $\rightarrow$ `AWAITING_APPROVAL` $\rightarrow$ `APPLYING` $\rightarrow$ `VERIFYING` $\rightarrow$ `REPAIRING` $\rightarrow$ `COMPLETED` / `CANCELLED` / `FAILED`.
  * **Strict Approval Gating:** Zero files are modified on disk before explicit user hunk approval.
* **TrueForge Client (`src/agent/trueforgeClient.ts`):**
  * Implemented using official `@truefoundry/trueforge-sdk` (v0.185.0).
  * Server-Sent Events turn streaming (`createTurnStream`), session lifecycle (`create`, `get`, `delete`), and cancellation.
  * Turn event handling: `turn.created`, `model.message.delta`, `model.message`, `tool.response_required`, `tool.approval_required`, `turn.done`.
  * Client tool response submission via `createTurnEvents` with `user.tool_response` and `user.tool_approval`.
  * **Provider Isolation Rule:** Extension code **never** contacts OpenAI, Anthropic, or Gemini directly. All reasoning is delegated to the local TrueForge agent harness (`npx @truefoundry/trueforge@latest`).
* **Central MCP Tool Server (`src/mcp/`):**
  * Implemented using official `@modelcontextprotocol/sdk` (v1.32.2) via `McpServer`.
  * Registered tools: `search_workspace`, `read_file`, `find_symbol`, `get_repository_context`, `analyse_impact`, `propose_edit`, `get_pending_changes`, `apply_approved_hunks`, `undo_changes`, `discover_tests`, `run_tests`, `get_test_results`.
  * Transports: `InMemoryTransport` and `StdioServerTransport` (via `src/mcp/stdioEntry.ts`).
  * Strict path security: blocks directory traversal (`..`), symlink escapes, and protected files (`.git`, `.env`, `node_modules`).
* **Safe Editing Engine (`src/editing/`):**
  * SHA-256 pre-edit baseline hash tracking.
  * Hunk-by-hunk reconstruction (applies only approved hunks; preserves rejected hunks and context lines).
  * Stale file detection: rejects writes if disk content was modified post-proposal (`StaleFileError`).
  * Post-application hash verification on undo (`postApplyHash`) protecting external user edits.
  * Sibling temporary staging (`.tmp...`) with atomic rename and per-file rollback.
* **Team Integration Adapters (`src/integration/`):**
  * Adapters for Members 2, 3, 4, and 5 conforming exactly to [`MEMBER1_TEAM_CONTRACTS.md`](./MEMBER1_TEAM_CONTRACTS.md).
  * **No Fake Success:** Reports honest `ModuleUnavailableError` when teammate modules are unbound.

---

## 3. Quick Start & Prerequisites

### Prerequisites
* **Node.js:** v18+ LTS (verified on `v24.15.0`)
* **npm:** v9+ (verified on `11.12.1`)
* **Git:** v2.30+

### Installation & Build
```powershell
# 1. Install dependencies
npm install

# 2. Run TypeScript type check
npm run typecheck

# 3. Build project
npm run build

# 4. Run automated test suite
npm test
```

### Starting the TrueForge Runtime Daemon
To run live end-to-end sessions with your configured model provider:
```powershell
npx @truefoundry/trueforge@latest
```
*(Runs by default on `http://127.0.0.1:8790`. Configure your model provider inside the TrueForge harness).*

---

## 4. Documentation Index

* [`MEMBER1_TEAM_CONTRACTS.md`](./MEMBER1_TEAM_CONTRACTS.md): Team interface specifications for Members 2, 3, 4, and 5.
* [`docs/MEMBER1_ARCHITECTURE.md`](./docs/MEMBER1_ARCHITECTURE.md): Deep architectural specification and state transition rules.
* [`docs/MEMBER1_SETUP.md`](./docs/MEMBER1_SETUP.md): Detailed installation, configuration, and troubleshooting guide.
* [`docs/MEMBER1_HANDOFF.md`](./docs/MEMBER1_HANDOFF.md): Step-by-step handoff guide for the next developer.
* [`MEMBER1_TEST_REPORT.md`](./MEMBER1_TEST_REPORT.md): Comprehensive 80-test verification report (PASS / BLOCKED status).
* [`MEMBER1_FINAL_REVIEW.md`](./MEMBER1_FINAL_REVIEW.md): Final engineering correction and compliance report.
* [`MEMBER1_INITIAL_AUDIT.md`](./MEMBER1_INITIAL_AUDIT.md): Initial repository reconnaissance and SDK evidence report.
