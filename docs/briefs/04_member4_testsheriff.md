# RepoPilot AI — Member 4 Development Guide
## TestSheriff: Automated Test Discovery, Execution & Verification

**Document purpose:** Give Member 4 and Antigravity a self-contained, implementation-ready specification for building the TestSheriff verification layer.

**Product:** RepoPilot AI — an impact-aware autonomous coding agent with human-controlled edits and automated verification  
**Role owner:** Member 4 — Automated Verification (TestSheriff)  
**Primary responsibility:** Discover and run relevant tests after approved changes, capture actual results, explain failures and return a truthful VerificationReport.

---

## 1. Mission and boundaries

TestSheriff is Layer 3 of RepoPilot AI:

1. **RepoPilot:** understands the repository and proposes code changes.
2. **ImpactLens:** predicts potentially affected files and relationships.
3. **TestSheriff:** checks the approved changes by running relevant tests.

TestSheriff is a verification capability invoked by the central RepoPilot workflow. It is **not a separate autonomous agent** and must not independently edit code.

### Main workflow

`Approved changes + changed-file list + ImpactReport → test discovery → safe test execution → result parsing → VerificationReport`

The central agent may use the report to explain outcomes or propose a fix. Any proposed fix must return through the normal diff-review and approval process. Do not create an unlimited automatic repair loop.

### First-build scope

- Discover the repository's existing test configuration.
- Prioritise pytest for the Flask challenge.
- Map changed source files to likely relevant tests using conventions and ImpactLens candidates.
- Run selected tests through controlled, approved MCP tools.
- Capture command, exit code, duration and output.
- Parse passed, failed, skipped and collection-error results where possible.
- Distinguish failed tests from tests that were not run.
- Summarise failures without inventing a diagnosis.
- Return a structured VerificationReport.

### Out of scope initially

- Supporting every testing framework.
- Running arbitrary shell commands supplied by the model.
- Silently installing packages or changing environments.
- Modifying source files or tests automatically.
- Claiming correctness from a successful code-generation response.
- Repeatedly running broad test suites without a time/resource limit.

---

## 2. Required stack

Use the existing shared project conventions. Keep test execution behind a narrow, controlled service.

| Area | Recommended technology | Use |
|---|---|---|
| Language | TypeScript | Test discovery, orchestration and result models |
| Runtime | Node.js compatible with shared project | Local process execution |
| Process execution | Node `child_process` via a controlled wrapper, or existing approved runner | Execute allowlisted test commands |
| Flask tests | pytest | Primary competition repository |
| Other unit tests | Vitest | Test RepoPilot's own TypeScript modules |
| Validation | Zod or existing shared validator | Validate requests/results |
| Editor integration | VS Code workspace APIs through shared services | Workspace root and status |
| Tool interface | MCP SDK through shared MCP layer | Expose approved test operations |
| Logging | Existing project logger | Diagnostics |
| Version control | Git | Branch and review workflow |

Do not add a new backend or test dashboard. Member 5 owns the presentation of verification results.

---

## 3. Safety and execution rules

Test execution runs code from the opened repository. Treat it as potentially unsafe.

1. Never execute arbitrary model-generated shell strings.
2. Use an allowlist of supported test runners and argument patterns.
3. Resolve the working directory to the opened workspace root.
4. Prevent path traversal outside the workspace.
5. Do not run destructive commands, package installation, deployment or network scripts.
6. Do not run commands with administrator privileges.
7. Set a configurable timeout and terminate timed-out child processes.
8. Limit captured output to a safe maximum size; preserve a truncation indicator.
9. Do not expose environment variables, API keys or secrets in logs/reports.
10. Do not alter source files, lockfiles or test configuration.
11. Require the central workflow/user approval where the team decides a test command needs explicit confirmation.
12. Report whether tests were skipped, timed out, failed to start or actually executed.

For the competition prototype, support the known pytest workflow first. Do not build a general-purpose terminal agent.

---

## 4. Dependencies and collaboration contracts

### From Member 1 — central agent and MCP

Agree on:
- How TestSheriff is invoked after approved edits.
- Which tool schemas Member 1 expects.
- Whether test execution requires a confirmation gate.
- Timeout and cancellation propagation.
- How the agent receives the VerificationReport.
- How test failures are returned to the agent without allowing direct edits.

Member 1 owns central orchestration and shared MCP registration conventions. Member 4 implements the verification service and its tool handler.

### From Member 2 — repository intelligence

Request:
- Workspace file list and path normalisation.
- Test/configuration file discovery if already implemented.
- Changed-file metadata or file search APIs.
- Optional symbol/import information for mapping tests.

Do not duplicate the full repository index.

### From Member 3 — ImpactLens

Request:
- Candidate affected test files.
- Source-to-test relationships, if known.
- Confidence or reason for each candidate.

Treat these as prioritisation hints, not proof that a test is sufficient.

### For Member 5 — UI

Return structured information for:
- Test discovery status.
- Command and selected test paths.
- Running/cancelled/timed-out state.
- Passed/failed/skipped counts.
- Failure summaries and output details.
- Verification limitations.

Member 5 owns display components. Member 4 owns the data and execution semantics.

---

## 5. Shared data contracts

Use the shared types in `src/shared/types/` wherever possible. Agree with Member 1 before adding or changing canonical contracts.

Suggested contracts:

```ts
export type TestRunStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "error"
  | "not_run";

export interface TestCandidate {
  path: string;
  reason: string;
  source: "convention" | "impact" | "configuration" | "manual";
  confidence: "high" | "medium" | "low";
}

export interface TestRunRequest {
  requestId: string;
  workspaceRoot: string;
  changedFiles: string[];
  candidateTests?: TestCandidate[];
  approvedRunner?: "pytest";
  timeoutMs?: number;
}

export interface TestCaseResult {
  id?: string;
  name: string;
  file?: string;
  status: "passed" | "failed" | "skipped" | "error";
  message?: string;
}

export interface VerificationReport {
  requestId: string;
  status: TestRunStatus;
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
  failures: {
    testName: string;
    file?: string;
    message: string;
  }[];
  outputSummary: string;
  outputTruncated: boolean;
  startedAt?: string;
  completedAt?: string;
  limitations: string[];
}
```

The proposed types are initial contracts. Use the team's canonical definitions if they already exist.

### Contract rules

- Counts must come from actual runner output.
- If parsing fails, mark counts as unavailable/partial rather than guessing.
- `exitCode: 0` alone is not enough to claim all tests passed if collection or parsing errors occurred.
- A test that was not executed must never be counted as passed.
- Include selected test paths and a safe command label.
- Redact secrets and avoid dumping the full environment.
- Distinguish runner errors from test assertion failures.

---

## 6. Functional requirements

### FR-1: Test configuration discovery

Detect the project's existing test setup without changing it.

For the Flask challenge, look for:
- `pytest.ini`
- `pyproject.toml`
- `tox.ini`
- `setup.cfg`
- Common `tests/` layout
- Existing project test instructions

Do not assume all repositories use the same configuration. If no known runner is detected, report that no supported runner was found.

### FR-2: Relevant test selection

Prioritise in this order:

1. Explicit test files provided by the user/team.
2. Candidate test files supplied by ImpactLens.
3. Conventional test names and directory patterns.
4. Existing repository test configuration.

For the Flask challenge, use existing pytest conventions. If a reliable mapping is not available, run the agreed broader test suite rather than pretending the narrow selection is complete.

### FR-3: Controlled execution

- Support pytest as the first runner.
- Build arguments as an array; do not concatenate untrusted shell strings.
- Run from the workspace root.
- Apply timeout and output limits.
- Support cancellation.
- Capture stdout and stderr separately or in a documented combined stream.
- Record start/end time and duration.
- Do not install dependencies automatically.

Suggested initial command shape: `python -m pytest <selected-paths> -q`. Confirm the environment and interpreter available in the target repository before using it. Do not assume a particular Python executable name on every machine.

### FR-4: Result parsing

Parse pytest output conservatively.

- Passed tests → passed.
- Failed assertions → failed.
- Skipped tests → skipped.
- Collection/import errors → errors or runner error, not passed.
- Timeout/cancellation → corresponding run status.
- Unparseable output → preserve raw summary and mark parsing incomplete.

If practical, use pytest's machine-readable output/plugin only if already available or approved. Do not install new packages without team approval.

### FR-5: Verification report

Report:
- What was selected and why.
- What command/runner was used.
- What actually ran.
- Counts and exit code.
- Failure names/messages.
- Duration.
- Whether output was truncated.
- Any limitations, unsupported cases or incomplete parsing.

### FR-6: Feedback to RepoPilot

Return the report to Member 1's orchestrator. The agent may explain a failure or propose a patch. The patch must be shown as a diff and approved by the developer before application. After approval, TestSheriff can run verification again.

---

## 7. Step-by-step implementation plan

### Step 1 — Inspect the repository

Ask Antigravity to inspect:
- Existing project instructions and architecture.
- Package scripts and runtime versions.
- MCP conventions owned by Member 1.
- Shared request/report types.
- Member 2's workspace and test-file discovery APIs.
- Member 3's impact report format.
- Existing logging and process utilities.

Do not scaffold a separate app or replace the current project setup. Produce a proposed file plan before editing.

### Step 2 — Define test-runner boundary

Create a small runner abstraction, even if pytest is the only supported runner initially.

Suggested structure:

```text
src/
  verification/
    index.ts
    test-discovery.ts
    test-selection.ts
    runner/
      runner-types.ts
      pytest-runner.ts
    process/
      safe-process.ts
    result-parser.ts
    verification-service.ts
    errors.ts
tests/
  unit/
    verification/
      test-selection.test.ts
      result-parser.test.ts
      safe-process.test.ts
```

Fit the existing repository structure rather than forcing this exact layout.

### Step 3 — Implement discovery

Detect pytest configuration and test paths. Return candidates with reasons and confidence. Handle:
- No tests directory.
- Configuration in a non-root folder.
- Multiple possible test folders.
- Missing pytest executable/module.
- Invalid or unreadable config.

### Step 4 — Implement test selection

Accept changed files and ImpactLens candidates. Use simple transparent rules:
- A source file's nearby/conventionally named test.
- A candidate test explicitly returned by ImpactLens.
- A broader configured test target when mapping is uncertain.

Keep a record of why each test was selected. Deduplicate and validate every path.

### Step 5 — Implement safe process execution

Build a process wrapper with:
- Executable allowlist.
- Argument array, not shell interpolation.
- Workspace-root enforcement.
- Timeout.
- Cancellation.
- Output-size limit.
- Exit-code capture.
- Safe error mapping.

Test it with a harmless fixture command and a controlled timeout. Never test by running destructive commands.

### Step 6 — Implement pytest adapter

The pytest adapter should:
- Receive validated test paths.
- Build the approved command arguments.
- Execute through the safe process wrapper.
- Return raw execution metadata.
- Avoid modifying the repository.

### Step 7 — Parse results

Build a parser with fixture-based tests for:
- All passed.
- Mixed pass/fail.
- Skipped tests.
- Collection error.
- No tests collected.
- Timeout.
- Cancelled run.
- Missing pytest.
- Truncated output.

Do not rely on one fragile regular expression for every pytest version. Keep raw output summary available when structured parsing is incomplete.

### Step 8 — Create VerificationReport

Create one service entry point similar to:

```ts
export async function verifyChanges(
  request: TestRunRequest
): Promise<VerificationReport>
```

Use the canonical shared type. Ensure every status path returns a valid report, including errors and cancellations.

### Step 9 — Expose MCP tools

Coordinate with Member 1. Proposed tool names:
- `run_tests`
- `get_test_results`

Member 1 owns central MCP registration and TrueForge integration. Member 4 provides safe handlers and schemas. Do not invent TrueForge-specific SDK calls.

### Step 10 — Integrate with UI and agent

Provide Member 5 with:
- A sample running state.
- A passed report.
- A failed report.
- A timeout/cancelled report.
- A report with incomplete parsing.

Provide Member 1 with the failure payload and a clear rule: verification feedback informs the next proposal; it does not bypass human diff approval.

---

## 8. Competition-focused test scenarios

Prioritise the fixed Flask tasks and the actual repository's test conventions.

### Scenario A — Inline edit

After the developer approves the edit to `get_debug_flag`, run the relevant helper tests or the agreed targeted pytest command. Report actual results.

### Scenario B — Multi-file Flask config command

After the developer approves changes to the CLI implementation, tests and documentation:
- Discover the relevant CLI test file.
- Run the relevant pytest target.
- Report test results and any collection/runtime errors.
- Do not claim documentation is verified by unit tests unless a specific documentation check was run.

### Scenario C — Resilience

If the model endpoint is unreachable, TestSheriff should not be falsely reported as having run. The UI/report must distinguish:
- Agent/model failure before edits.
- Test runner failure.
- Test assertion failure.
- Cancellation or timeout.

The workspace must remain unchanged when the agent fails before approved edits.

---

## 9. Testing and definition of done

### Unit tests

- Test discovery recognises supported pytest configuration.
- Selection prioritises explicit and ImpactLens candidates.
- Paths outside workspace are rejected.
- Unsafe executable/arguments are rejected.
- Timeout is reported correctly.
- Cancellation is reported correctly.
- Output truncation is recorded.
- Parser handles pass/fail/skip/collection error.
- Unparseable output is marked incomplete.
- No run is incorrectly reported as passed.

### Integration tests

- Member 1 can invoke TestSheriff through the shared MCP layer.
- Member 2's workspace paths are accepted.
- Member 3's test candidates can be used.
- Member 5 can display all report statuses.
- Actual pytest runs against the Flask challenge repository.
- No files are modified by the verification service.

### Definition of done

- [ ] TestSheriff builds and typechecks.
- [ ] Existing pytest configuration is detected.
- [ ] Relevant test candidates are selected with reasons.
- [ ] Pytest runs through a controlled process wrapper.
- [ ] Timeout and cancellation work.
- [ ] Actual results are parsed and reported accurately.
- [ ] Failures and collection errors are distinguished.
- [ ] VerificationReport follows the shared contract.
- [ ] MCP invocation works through Member 1's shared layer.
- [ ] Member 5 can display running, passed, failed and error states.
- [ ] Unit/integration tests pass.
- [ ] TestSheriff does not modify code or auto-apply fixes.

---

## 10. Antigravity master instruction

Paste this into Antigravity after opening the team's shared repository:

> You are implementing Member 4's TestSheriff module for RepoPilot AI. First inspect the existing repository, project instructions, package scripts, shared types, Member 1's MCP conventions, Member 2's repository discovery and Member 3's ImpactReport. Do not create a new project, overwrite configuration, invent APIs, install packages, or modify files owned by another member without explaining the need and obtaining agreement.
>
> Implement a safe, controlled verification capability. Start with pytest for the Flask challenge. Discover existing test configuration, select relevant tests using changed-file conventions and ImpactLens candidates, execute only allowlisted commands through an argument-array process wrapper, enforce workspace boundaries, timeout and cancellation, limit/redact output, and return an accurate VerificationReport.
>
> Never run arbitrary model-generated shell commands. Never claim tests passed unless they actually executed and the results support that claim. Distinguish assertion failures, collection errors, runner errors, timeout, cancellation and not-run states. Do not modify source code or automatically repair failures.
>
> Work in stages: inspect and propose file plan; confirm contracts; implement discovery and selection; implement safe execution; implement pytest adapter; implement parsing; add tests; expose the agreed service to the shared MCP layer; integrate with the agent and UI. Run relevant checks after each stage and report exact changed files and actual command results.

---

## 11. Member 4 coordination checklist

Before coding:
- [ ] Confirm the canonical VerificationReport type with Member 1.
- [ ] Confirm test discovery data with Member 2.
- [ ] Confirm candidate-test format with Member 3.
- [ ] Confirm UI states with Member 5.
- [ ] Confirm execution approval and timeout policy.

During coding:
- [ ] Work on `feature/test-verification`.
- [ ] Keep all commands allowlisted and workspace-scoped.
- [ ] Never install dependencies or modify tests silently.
- [ ] Add fixture-based parser tests.
- [ ] Commit small, reviewable changes.

Before integration:
- [ ] Demonstrate one real pytest run.
- [ ] Demonstrate one failure and one timeout/cancel state.
- [ ] Share sample reports with Member 5.
- [ ] Verify that the module never changes source files.
- [ ] Open a pull request and obtain review.

**Success criterion:** After approved changes, RepoPilot can show evidence of what was tested, what passed or failed, and what remains unverified.
