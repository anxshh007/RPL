# MEMBER 1 — REPOPILOT TEAM CONTRACTS SPECIFICATION
**Version:** 1.0.0  
**Author:** Member 1 (Lead Software Architect & Central Agent Engineer)  
**Target Audience:** Members 2, 3, 4, and 5  
**Canonical Types Path:** `src/shared/contracts/index.ts`  
**Shared Module:** `src/shared/index.ts`  

---

## 1. Overview & Architecture Rules

RepoPilot AI is structured around **one central TrueForge agent loop** coordinated by Member 1.  
To prevent merge conflicts, runtime crashes, and architectural drift, the following rules apply to all team members:

1. **Single Source of Truth:** All cross-module data structures must be imported directly from `src/shared/contracts/index.ts` or `src/shared/index.ts`. Never re-declare duplicate interfaces.
2. **Provider Isolation Rule:** No module may directly invoke LLM APIs (OpenAI, Anthropic, Gemini). All AI reasoning passes through Member 1's TrueForge orchestrator.
3. **No Silent Disk Writes:** Modules must never directly mutate workspace files on disk. All edits must be proposed as `ProposedFileChange` objects with diff hunks, approved by the user via Member 5's UI, and applied by the Safe Editing Engine.
4. **Resilience & Non-Blocking Degradation:** If an optional analysis service (e.g., ImpactLens) is unavailable or encounters an error, the agent orchestrator warns the user and continues the primary task.

---

## 2. Integration Contract for Member 2 — Repository Context & Discovery
* **Assigned Branch:** `feature/repository-context`
* **Assigned Folder:** `src/repo/`
* **Exposed MCP Tools:** `get_repository_context`, `search_workspace`, `find_symbol`, `read_file`

### Service Interface
Member 2 must export an implementation conforming to `IRepositoryContextService`:

```typescript
import { ChangeRequest, RepositoryContext } from "../shared/index.js";

export interface IRepositoryContextService {
  /**
   * Discovers and retrieves workspace context tailored to a user ChangeRequest.
   * Enforces token budget and scores relevance.
   */
  assembleContext(request: ChangeRequest, tokenBudget?: number): Promise<RepositoryContext>;

  /**
   * Fast workspace symbol search
   */
  findSymbols(query: string, maxResults?: number): Promise<RepositoryContext["relevantSymbols"]>;

  /**
   * Workspace file search matching glob or text query
   */
  searchFiles(query: string, maxResults?: number): Promise<string[]>;
}
```

### Data Contract: `RepositoryContext`
```typescript
export interface RepositoryContext {
  root: string;
  relevantFiles: Array<{
    path: string;
    reason: string;
    score: number;
    excerpts?: Array<{ startLine: number; endLine: number; text: string }>;
  }>;
  relevantSymbols: Array<{
    name: string;
    file: string;
    kind: string;
    startLine: number;
  }>;
  dependencyEdges: Array<{
    from: string;
    to: string;
    kind: "imports" | "references";
  }>;
  tokenEstimate: number;
}
```

---

## 3. Integration Contract for Member 3 — ImpactLens (Predictive Intelligence)
* **Assigned Branch:** `feature/impactlens`
* **Assigned Folder:** `src/impact/`
* **Exposed MCP Tools:** `analyse_impact`

### Service Interface
Member 3 must export an implementation conforming to `IImpactService`:

```typescript
import { ChangeRequest, RepositoryContext, ImpactReport } from "../shared/index.js";

export interface IImpactService {
  /**
   * Pre-edit impact prediction: analyzes which files, symbols, and tests
   * are at risk before code generation or file modifications.
   */
  predictImpact(
    request: ChangeRequest,
    context?: RepositoryContext
  ): Promise<ImpactReport>;
}
```

### Data Contract: `ImpactReport`
```typescript
export type RiskLevel = "low" | "medium" | "high";

export interface ImpactReport {
  requestId: string;
  generatedAt: string;
  affectedFiles: Array<{
    path: string;
    risk: RiskLevel;
    score: number;
    reasons: string[];
    relatedSymbols?: string[];
  }>;
  graph: Array<{ id: string; label: string; kind: "file" | "symbol" }>;
  edges: Array<{ source: string; target: string; kind: string }>;
  limitations: string[];
}
```

---

## 4. Integration Contract for Member 4 — TestSheriff (Automated Verification)
* **Assigned Branch:** `feature/testsheriff`
* **Assigned Folder:** `src/test-sheriff/`
* **Exposed MCP Tools:** `discover_tests`, `run_tests`, `get_test_results`

### Service Interface
Member 4 must export an implementation conforming to `ITestSheriffService`:

```typescript
import { ChangePlan, VerificationReport } from "../shared/index.js";

export interface ITestSheriffService {
  /**
   * Discovers tests relevant to the modified files in the ChangePlan
   */
  discoverRelevantTests(plan: ChangePlan): Promise<string[]>;

  /**
   * Executes verified tests and parses test runner results (e.g., pytest, vitest)
   */
  executeTests(options: {
    testFiles?: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<VerificationReport>;
}
```

### Data Contract: `VerificationReport`
```typescript
export interface VerificationReport {
  requestId: string;
  command: string;
  status: "passed" | "failed" | "cancelled" | "error" | "not-run";
  exitCode: number | null;
  durationMs: number;
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  stdoutTail: string;
  stderrTail: string;
  failureSummaries: string[];
}
```

---

## 5. Integration Contract for Member 5 — UI & Diff Review System
* **Assigned Branch:** `feature/ui-diff`
* **Assigned Folder:** `src/webview/`
* **Responsibilities:** Render streamed events, display proposed diff hunks, allow hunk acceptance/rejection, trigger undo, and display impact/verification cards.

### 5.1 Inbound Events: `RepoPilotEvent`
Member 5's Webview listens to the event stream:

| Event Type | Payload | Meaning |
| :--- | :--- | :--- |
| `agent.status` | `{ requestId, state, message, timestamp }` | Orchestrator state transition (`INDEXING`, `PREDICTING`, `PLANNING`, `AWAITING_APPROVAL`, etc.) |
| `agent.delta` | `{ requestId, text }` | Live token streaming from TrueForge |
| `context.ready` | `{ requestId, context }` | Context assembled by Member 2 |
| `impact.ready` | `{ requestId, report }` | Pre-edit impact graph generated by Member 3 |
| `change.proposed` | `{ requestId, plan }` | Proposed diffs and hunks ready for review |
| `change.applied` | `{ requestId, changedPaths, appliedHunkIds }` | Approved changes committed to workspace |
| `change.undone` | `{ requestId, changedPaths }` | Rollback completed |
| `verification.completed` | `{ requestId, report }` | Post-edit test verification by Member 4 |
| `agent.error` | `{ requestId, safeMessage, retryable }` | Safe error message |

### 5.2 Outbound User Decisions: `ApprovalDecision`
When the developer clicks "Accept Hunk" or "Reject Hunk", Member 5 transmits:

```typescript
export interface ApprovalDecision {
  requestId: string;
  approvedHunkIds: string[]; // List of hunkIds user explicitly accepted
  rejectedHunkIds: string[]; // List of hunkIds rejected
  timestamp: string;
  comment?: string;
}
```

---

## 6. Safe Editing Protocol (Member 1 Enforcement)
1. **Hash Verification:** Every `ProposedFileChange` contains `originalContentHash` (SHA-256 of the baseline file on disk).
2. **Stale Protection:** If a file was modified outside RepoPilot while the user was reviewing hunks, `apply_approved_hunks` immediately rejects the mutation with `StaleFileError` to prevent silent overwriting.
3. **Undo:** Member 1 records `AppliedHunkRecord` containing pre- and post-apply states for 1-click undo.

---

## 7. Versioning & Coordination Protocol
* To request a contract addition, submit an RFC issue or discuss on `feature/core-agent`.
* Breaking changes will increment the major version and require updating all module adapters simultaneously.
