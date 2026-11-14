# RepoPilot AI — Core Agent, Predictive Impact & Verification

> **An Impact-Aware Autonomous Coding Agent with Automated Verification**  
> RepoPilot plans changes with one central TrueForge agent, shows predicted impact (**ImpactLens**) before editing, lets you accept or reject each diff hunk via VS Code Webview, and runs targeted test validation (**TestSheriff**).

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

## 2. Repository Layout & Ownership

```
src/shared/contracts/   shared types, events, service interfaces, webview protocol   (Angshuman)
src/agent/              orchestrator + composition root createRepoPilot()          (Astha)
src/mcp/                MCP tool registration, canonical tool names                 (Astha)
src/edits/              propose / hunk apply / undo — only writer of workspace files (Astha)
src/repository/         scan, search, symbols, imports, context ranking & budget   (Aditya)
src/impact/             ImpactLens dependency graph & explainable risk            (Angshuman)
src/verification/       TestSheriff discovery, safe pytest runs, parsing          (Tushar)
src/extension/          VS Code activation, commands, webview bridge               (Supriyo)
src/webview/            React + Vite panel with Prompt-Kit UI                     (Supriyo)
tests/unit/<module>/    unit tests per owner
docs/briefs/            the five member briefs
docs/DECISIONS.md       resolved conflicts between the briefs — read before coding
AGENTS.md               rules for humans and Antigravity
```

---

## 3. Core Capabilities Implemented by Member 1

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
  * Implemented using official `@modelcontextprotocol/sdk` via `McpServer`.
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

## 4. Quick Start & Prerequisites

### Prerequisites
* **Node.js:** v18+ LTS
* **npm:** v9+
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

### Running the Extension in VS Code
Press **F5** in VS Code. In the Extension Development Host window:
- **RepoPilot: Open Panel** opens the webview panel.
- Select code and press **Ctrl+Shift+Alt+E** (Cmd+Shift+Alt+E on macOS) for an inline edit.

### Starting the TrueForge Runtime Daemon
To run live end-to-end sessions with your configured model provider:
```powershell
npx @truefoundry/trueforge@latest
```
*(Runs by default on `http://127.0.0.1:8790`. Configure your model provider inside the TrueForge harness).*

---

## 5. Documentation Index

* [`MEMBER1_TEAM_CONTRACTS.md`](./MEMBER1_TEAM_CONTRACTS.md): Team interface specifications for Members 2, 3, 4, and 5.
* [`MEMBER1_TEST_REPORT.md`](./MEMBER1_TEST_REPORT.md): Comprehensive 80-test verification report.
* [`MEMBER1_FINAL_REVIEW.md`](./MEMBER1_FINAL_REVIEW.md): Final engineering correction and compliance report.
* [`MEMBER1_INITIAL_AUDIT.md`](./MEMBER1_INITIAL_AUDIT.md): Initial repository reconnaissance and SDK evidence report.
