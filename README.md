# RepoPilot AI — TestSheriff (Layer 3)
### Automated Test Discovery, Safe Execution & Truthful Verification Module

---

## 1. Overview & Architecture

**TestSheriff** is Layer 3 of **RepoPilot AI**, the impact-aware autonomous coding agent. TestSheriff verifies code changes after they have been approved by a human developer.

```
┌────────────────────────────────────────────────────────┐
│  Layer 1: RepoPilot Central Agent (Member 1)           │
│  - Understands repository context                      │
│  - Proposes code change diffs                          │
│  - Obtains developer review & approval                 │
└──────────────────────────┬─────────────────────────────┘
                           │ Approved changes
┌──────────────────────────▼─────────────────────────────┐
│  Layer 2: ImpactLens (Member 3)                        │
│  - Analyzes dependency graphs & AST relationships      │
│  - Predicts affected files and candidate tests         │
└──────────────────────────┬─────────────────────────────┘
                           │ Candidate tests
┌──────────────────────────▼─────────────────────────────┐
│  Layer 3: TestSheriff (Member 4 - This Module)         │
│  - Discovers existing test configurations              │
│  - Selects relevant tests via 4-tier prioritization    │
│  - Executes allowlisted commands safely via MCP        │
│  - Parses actual results without hallucinated diagnoses│
│  - Returns truthful VerificationReport                 │
└──────────────────────────┬─────────────────────────────┘
                           │ VerificationReport
┌──────────────────────────▼─────────────────────────────┐
│  UI Presentation & Developer Review (Member 5)         │
│  - Interactive Verification Dashboard                  │
│  - Status pills, metric cards, expandable tracebacks   │
│  - Boundary & limitation disclosure                    │
└────────────────────────────────────────────────────────┘
```

### Strict Operating Boundaries
1. **Never Edits Code**: TestSheriff operates strictly in read-only verification mode. It never mutates source files, lockfiles, or configurations.
2. **Never Installs Dependencies**: Silent package installation (`pip install`, `npm install`) is strictly forbidden.
3. **No Automatic Repair Loops**: If tests fail, feedback is delivered back to RepoPilot to propose a patch, but the patch **must** pass through the human diff-review gate.
4. **No Hallucinated Diagnoses**: Hypotheses are explicitly marked with `[Hypothesis]` and derived strictly from parsed exception categories (AssertionError, ImportError, AttributeError, etc.).

---

## 2. Core Functional Modules

### Module A — Test Discovery & Prioritized Selection
- **Framework Discovery**: Automatically detects `pytest.ini`, `pyproject.toml`, `tox.ini`, `setup.cfg`, `conftest.py`, and test directories (`tests/`, `test/`).
- **4-Tier Prioritized Selection**:
  1. *Priority 1*: Explicit test files requested by user or central agent.
  2. *Priority 2*: Candidate tests provided by ImpactLens.
  3. *Priority 3*: Conventional name mapping (`src/flask/cli.py` $\leftrightarrow$ `tests/test_cli.py`) and static import analysis (scanning test files for imports of changed modules).
  4. *Priority 4*: Broader workspace test suite fallback when mapping is uncertain.

### Module B — Safe Test Execution through MCP
- **Non-Shell Execution**: Child processes spawn directly with argument arrays (`shell: false`). Arbitrary shell strings are rejected.
- **Strict Executable Allowlist**: Only `python`, `python3`, `py`, `pytest`, `node`, or workspace virtual environments are allowed.
- **Resource Constraints**: Configurable timeouts (default 30s, max 300s), process tree termination (`taskkill /F /T /PID` or `SIGKILL`), and bounded output buffers (512 KB limit with truncation flag).
- **Secret Redaction**: Automatically scrubs API keys, Bearer tokens, private keys, and passwords from captured stdout/stderr.

### Module C — Failure Analysis & Verification Reports
- **Conservative Pytest Parsing**: Accurately counts passed, failed, skipped, and collection errors.
- **Hypothesis Generation**: Formulates grounded, evidence-based failure hypotheses based on exact error types.
- **Truthful Limitations**: Discloses when only a targeted subset was executed, when output was truncated, or when broad suites were selected as a fallback.

### Module D — Central Agent Integration & MCP Server
- **In-Process Tool Dispatcher**: `run_tests`, `get_test_results`, `discover_tests`.
- **Stdio JSON-RPC 2.0 MCP Server**: Standard Model Context Protocol server over stdin/stdout for seamless connection with TrueForge, Cursor, Claude, or Member 1's orchestrator.
- **Human Approval Gate**: Blocks execution on unapproved changes with `status: not_run`.

### Module E — Generative UI Dashboard
- Generates interactive, standalone HTML/CSS verification dashboards ([`verification-dashboard.html`](file:///c:/TEST_SHERIFF/verification-dashboard.html)) for webviews or reporting.

---

## 3. Verification Report Schema

Canonical contract returned to the central agent:

```typescript
export interface VerificationReport {
  requestId: string;
  status: "passed" | "failed" | "timed_out" | "cancelled" | "error" | "not_run";
  runner: string;
  commandLabel: string;
  selectedTests: string[];
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  durationMs?: number;
  exitCode?: number;
  failures: Array<{
    testName: string;
    file?: string;
    message: string;
    errorDetails?: string;
    hypothesis?: string;
  }>;
  testCases?: Array<{
    id?: string;
    name: string;
    file?: string;
    status: "passed" | "failed" | "skipped" | "error";
    message?: string;
  }>;
  outputSummary: string;
  outputTruncated: boolean;
  startedAt?: string;
  completedAt?: string;
  limitations: string[];
}
```

---

## 4. Available Scripts

| Command | Action |
|---|---|
| `npm test` | Runs all 14 test suites (59 unit and integration tests) |
| `npm run demo` | Runs the interactive end-to-end verification demonstration |
| `npm run benchmark` | Executes the Flask Challenge competition scenarios (A, B, C) |
| `npm run mcp:client` | Runs the stdio JSON-RPC 2.0 MCP protocol validation client |
| `npm run mcp:server` | Starts the standalone stdio MCP server for agent integration |

---

## 5. Security & Isolation Summary

- **Path Containment**: Directory traversal (`..`) and outside paths are blocked via canonical resolution against `workspaceRoot`.
- **Secret Protection**: Regex filters sanitize outputs before caching or returning through MCP.
- **Clean Environment**: Child processes do not inherit host secrets, AWS keys, or unauthorized environment variables.
- **Code Non-Mutation**: Verified by pre- and post-execution cryptographic SHA-256 checksums across all repository files.
