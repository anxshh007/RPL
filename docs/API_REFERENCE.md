# TestSheriff TypeScript API Reference

---

## 1. Core Verification APIs

### `verifyChanges(request: TestRunRequest, signal?: AbortSignal): Promise<VerificationReport>`
The central verification function. Validates input, discovers and prioritizes tests, executes them safely, parses output, redacts secrets, and generates the canonical `VerificationReport`.

```typescript
import { verifyChanges } from "repopilot-testsheriff";

const report = await verifyChanges({
  requestId: "req-prod-001",
  workspaceRoot: "C:/my-project",
  changedFiles: ["src/flask/cli.py"],
  timeoutMs: 30000,
});

console.log(report.status); // "passed" | "failed" | "timed_out" | "error"
```

---

### `discoverTests(workspaceRoot: string): Promise<TestDiscoveryResult>`
Scans a repository to detect test configurations (`pytest.ini`, `pyproject.toml`, `tox.ini`, `setup.cfg`, `conftest.py`) and test directories.

```typescript
import { discoverTests } from "repopilot-testsheriff";

const result = await discoverTests("C:/my-project");
console.log(result.runner);          // "pytest"
console.log(result.detectedConfigs); // ["pytest.ini", "pyproject.toml"]
console.log(result.testFiles);       // ["tests/test_cli.py", ...]
```

---

### `selectTests(options: SelectTestsOptions): Promise<TestSelectionResult>`
Evaluates changed files against discovered tests using the 4-tier selection algorithm (Explicit $\to$ ImpactLens $\to$ Conventional & Static Import $\to$ Full Suite Fallback).

```typescript
import { selectTests } from "repopilot-testsheriff";

const selection = await selectTests({
  workspaceRoot: "C:/my-project",
  changedFiles: ["src/flask/cli.py"],
  candidateTests: [{ path: "tests/test_cli.py", reason: "Impact", source: "impact", confidence: "high" }],
});

console.log(selection.selectedTests); // ["tests/test_cli.py"]
```

---

## 2. MCP Server & Tool APIs

### `TestSheriffMcpServer`
Standard stdio JSON-RPC 2.0 Model Context Protocol server.

```typescript
import { TestSheriffMcpServer } from "repopilot-testsheriff";

const server = new TestSheriffMcpServer();
server.listenStdio();
```

### `dispatchMcpTool(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResponse>`
In-process dispatcher for programmatic integration without stdio overhead.

```typescript
import { dispatchMcpTool } from "repopilot-testsheriff";

const res = await dispatchMcpTool("run_tests", {
  requestId: "req-1",
  workspaceRoot: "C:/my-project",
  changedFiles: ["src/flask/cli.py"],
});
```

---

## 3. Human-in-the-Loop Orchestration APIs

### `centralWorkflowOrchestrator.processApprovedChanges(...)`
Coordinates the developer approval gate, enforces repair loop thresholds (`MAX_REPAIR_ITERATIONS = 2`), and dispatches to TestSheriff.

```typescript
import { centralWorkflowOrchestrator } from "repopilot-testsheriff";

const outcome = await centralWorkflowOrchestrator.processApprovedChanges(
  {
    proposalId: "prop-01",
    description: "Fix CLI helper",
    changedFiles: ["src/flask/cli.py"],
    diff: "...",
    proposedBy: "RepoPilot",
  },
  {
    proposalId: "prop-01",
    approved: true, // If false, execution is blocked
    reviewedBy: "Developer",
    approvedAt: new Date().toISOString(),
  }
);
```
