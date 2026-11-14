# RepoPilot AI — Member 5 Development Guide
## VS Code UI, Diff Review, Developer Experience & Integration

**Document purpose:** Give Member 5 and Antigravity a self-contained, implementation-ready specification for building the user-facing VS Code experience and integrating the other four members' modules.

**Product:** RepoPilot AI — an impact-aware autonomous coding agent with human-controlled edits and automated verification  
**Role owner:** Member 5 — VS Code UI, Diff Review & Integration  
**Primary responsibility:** Deliver one coherent VS Code-native experience where developers instruct RepoPilot, observe progress and impact, review proposed edits safely, approve/reject changes, undo accepted edits and inspect real verification results.

---

## 1. Mission and boundaries

Member 5 owns the developer experience and integration presentation. The product must feel like one VS Code extension, not three separate tools.

The three layers are:

1. **Layer 1 — Core RepoPilot:** owned by Members 1 and 2 (agent orchestration and repository intelligence).
2. **Layer 2 — ImpactLens:** owned by Member 3 (predictive impact analysis).
3. **Layer 3 — TestSheriff:** owned by Member 4 (automated verification).

Member 5 connects these capabilities through a single interface and review flow. Member 5 owns the visual review controls, but the underlying edit/approval and workspace mutation logic must remain in the shared core service owned with Member 1. Do not duplicate business logic in React components.

### Primary user journey

1. Developer opens a repository in VS Code.
2. Developer opens RepoPilot and enters an instruction.
3. Agent streams progress and retrieves repository context.
4. ImpactLens displays potentially affected files before editing.
5. Agent proposes changes across files.
6. Developer reviews each diff/hunk and accepts or rejects it.
7. Only approved changes are applied.
8. Developer can undo applied changes.
9. TestSheriff runs relevant tests after approval.
10. UI displays actual verification results and remaining risks.

---

## 2. Required stack

| Area | Recommended technology | Use |
|---|---|---|
| Extension host | TypeScript + VS Code Extension API | Commands, workspace and editor integration |
| Webview UI | React + Vite | Main RepoPilot interface |
| UI language | TypeScript/TSX | Typed components |
| Styling | Existing project styling system; otherwise lightweight CSS | Consistent, accessible UI |
| Graph rendering | React Flow | Render ImpactLens nodes/edges |
| Diff display | VS Code diff editor where practical; otherwise a tested diff component | Review proposed changes |
| State | React state/context or existing chosen state library | UI state |
| Validation | Shared schemas / Zod if already used | Validate messages |
| Streaming | Shared agent event interface from Member 1 | Live updates |
| Tests | Vitest + React Testing Library if already configured | Component and logic tests |
| Packaging | VS Code extension tooling already used by project | Build/package extension |

Do not add a large UI framework or state library without checking the existing repository first. Do not create a standalone web product as a substitute for the VS Code extension.

---

## 3. Dependencies and ownership boundaries

### Member 1 — Core Agent & TrueForge

Obtain:
- Agent session lifecycle API.
- Streaming event schema.
- Cancellation API.
- MCP tool status/error events.
- Proposed-change/ChangePlan contract.
- Approval/apply/undo service contract.
- Extension-to-agent controller interface.

Member 1 owns the central agent and orchestration. Member 5 consumes these APIs and provides UI controls.

### Member 2 — Repository Intelligence

Obtain:
- File and symbol search results.
- `@file` and `@symbol` context support.
- Relevant-file/context status events.
- Workspace-relative path conventions.

Member 5 displays context sources; it does not implement a second indexer.

### Member 3 — ImpactLens

Obtain the canonical `ImpactReport`, including nodes, edges, affected files, impact level, reason, confidence, warnings and summary. Member 5 owns the visual presentation of this data.

### Member 4 — TestSheriff

Obtain the canonical `VerificationReport`, including running status, selected tests, counts, failures, duration, exit code, output summary, cancellation and limitations. Member 5 displays the report; it does not parse pytest output.

### Non-negotiable boundary

React components must not directly:
- Call model-provider APIs.
- Run arbitrary shell commands.
- Apply workspace edits by themselves.
- Reimplement MCP or TrueForge orchestration.
- Invent test results or impact predictions.

UI actions call the extension controller/shared services, which validate and delegate to the correct owner module.

---

## 4. Information architecture and UI layout

Create one main RepoPilot panel, preferably a VS Code webview view or panel consistent with the current extension structure.

### Recommended layout

**A. Header**
- RepoPilot AI name.
- Current workspace/repository label.
- Agent connection/session state.
- New task / clear conversation action, if supported.

**B. Instruction area**
- Multiline instruction input.
- Submit/run action.
- Cancel action while agent is running.
- Optional context chips for `@file` and `@symbol` when the backend contract supports them.

**C. Activity / conversation area**
- User request.
- Streaming agent response.
- Tool activity with readable labels.
- Progress and error states.
- Clear distinction between analysis, proposed edits and verification.

**D. ImpactLens panel**
- Impact summary.
- Affected files grouped by High / Medium / Low.
- Reason and confidence for each file.
- Expandable dependency graph.
- Warnings/incomplete analysis state.
- Graph must not overwhelm the main workflow; allow collapse.

**E. Proposed changes / diff review**
- Files changed.
- Per-file diff.
- Hunk-level accept/reject controls if supported by the core editing service.
- Accept/reject state clearly visible.
- Apply only approved hunks.
- Undo action for applied changes.
- Show pending vs applied changes distinctly.

**F. TestSheriff panel**
- Not started / running / passed / failed / timed out / cancelled / error.
- Selected tests and why selected.
- Passed, failed, skipped and error counts.
- Failure messages.
- Output summary and truncation notice.
- Clear label when tests were not run.

**G. Final summary**
- Files changed.
- Impact predicted vs actual files changed.
- Changes accepted/rejected.
- Tests actually executed and outcomes.
- Remaining risks and unverified items.

---

## 5. Functional requirements

### FR-1: VS Code extension entry point

- Register the RepoPilot command and view.
- Open the main panel from the VS Code command palette/activity bar as agreed by the team.
- Detect the active workspace.
- Handle no-workspace state gracefully.
- Respect VS Code theme/accessibility conventions where practical.

### FR-2: Instruction submission

- Accept natural-language instructions.
- Disable duplicate submission while a request is active, unless the core explicitly supports parallel sessions.
- Display validation errors.
- Send the request through Member 1's controller/API.
- Do not call the model directly from the webview.

### FR-3: Streaming and cancellation

- Render streamed content incrementally.
- Show agent/tool activity without exposing raw internal payloads unnecessarily.
- Provide a working Cancel control.
- Reflect cancelled/error state accurately.
- Do not leave stale loading indicators after a request completes.
- Ensure a cancelled request cannot apply late edits without renewed approval.

### FR-4: Context visibility

- Display files/symbols used by the agent when the backend provides them.
- Support `@file` and `@symbol` according to the shared request contract.
- Distinguish user-selected context from automatically retrieved context.
- Do not claim a file was inspected unless the backend reports it.

### FR-5: Impact visualisation

- Render Member 3's graph data using React Flow.
- Highlight proposed/changed and affected files.
- Provide readable node labels and edge relationship labels.
- Show impact level, reason and confidence on selection/hover or in a details panel.
- Handle large graphs with a bounded/filtered view.
- Handle empty, partial and warning states.

### FR-6: Diff review

- Show the original and proposed code clearly.
- Support file-level and hunk-level review according to the core service capability.
- Each hunk must have an explicit pending/accepted/rejected state.
- Never apply rejected or pending hunks.
- Make the apply action explicit.
- Display apply errors without pretending the edit succeeded.
- Provide undo for applied changes through the core service.
- Keep review state consistent if the agent is cancelled or the workspace changes.

### FR-7: Verification display

- Show TestSheriff's real status.
- Display selected tests and result counts.
- Show failure summaries and limitations.
- Distinguish no tests found, tests not run, runner error, test failure and pass.
- Never display “All tests passed” when parsing was incomplete or tests were skipped/not run.

### FR-8: Integrated final report

Display a compact summary that compares:
- Predicted affected files.
- Actual files proposed/changed.
- Accepted/rejected changes.
- Tests executed.
- Passed/failed/skipped/errors.
- Unverified risks.

---

## 6. Shared UI event and data contracts

Use the canonical shared contracts. Do not create UI-only duplicate versions with different field names. If a contract is missing, agree it with the owner before implementing.

Suggested event union (adapt to Member 1's existing event schema):

```ts
type RepoPilotEvent =
  | { type: "agent.started"; requestId: string }
  | { type: "agent.delta"; requestId: string; text: string }
  | { type: "agent.tool"; requestId: string; tool: string; status: string }
  | { type: "impact.ready"; requestId: string; report: ImpactReport }
  | { type: "plan.ready"; requestId: string; plan: ChangePlan }
  | { type: "diff.ready"; requestId: string; diff: ProposedDiff }
  | { type: "verification.started"; requestId: string }
  | { type: "verification.ready"; requestId: string; report: VerificationReport }
  | { type: "agent.cancelled"; requestId: string }
  | { type: "agent.error"; requestId: string; message: string };
```

Suggested UI state model:

- `idle`
- `starting`
- `streaming`
- `analysing_impact`
- `review_required`
- `applying`
- `verifying`
- `completed`
- `cancelled`
- `error`

Do not let the UI independently infer a backend status from missing data. Use explicit events/status values.

### Webview messaging rules

- Validate every message received from the webview.
- Use a small, typed message protocol.
- Never trust arbitrary webview-supplied file paths or command strings.
- Route all actions through extension-host services.
- Keep the webview Content Security Policy restrictive.
- Avoid unsafe HTML injection.
- Do not expose secrets or environment variables to the webview.

---

## 7. Suggested project structure

Adapt to the existing repository; do not force a restructure if a working structure already exists.

```text
src/
  extension/
    extension.ts
    commands/
    views/
      repopilot-provider.ts
    controller/
      webview-controller.ts
      message-router.ts
  webview/
    App.tsx
    components/
      Header/
      PromptInput/
      Conversation/
      ActivityFeed/
      ImpactPanel/
      DependencyGraph/
      DiffReview/
      VerificationPanel/
      FinalSummary/
    hooks/
    state/
    styles/
    types/
  shared/
    types/
    events/
    constants/
```

Member 5 owns the webview and extension presentation/controller glue. Core domain services remain with their respective owners.

---

## 8. Step-by-step implementation plan

### Step 1 — Inspect the existing repository

Ask Antigravity to inspect:
- `AGENTS.md`, README and project instructions.
- Existing extension entry point and manifest.
- Current webview setup.
- Package scripts, TypeScript configuration and bundler.
- Shared types and events.
- Member 1's controller/session API.
- Existing diff/edit service.
- Member 3 and Member 4 report contracts.

Before editing, produce:
- Existing architecture summary.
- Files that will be modified/created.
- Missing APIs and dependencies.
- Integration risks.
- Proposed incremental plan.

Do not replace the existing extension scaffold.

### Step 2 — Build a minimal extension shell

Ensure:
- Extension activates.
- Command opens the RepoPilot view.
- Workspace state is detected.
- Webview loads from the development build.
- No-workspace and load-error states are handled.

Test this before adding complex UI.

### Step 3 — Establish a typed webview bridge

Create a single message router between extension host and webview.

- Define typed request/response/event messages.
- Validate inbound payloads.
- Route actions to Member 1's services.
- Handle errors and disposal.
- Avoid duplicated event listeners.
- Clean up subscriptions when the panel closes.

### Step 4 — Implement prompt and conversation

Build instruction input, submit, streaming display and cancellation. Use mocked events only for early UI development; replace mocks with real Member 1 integration before declaring the feature complete.

### Step 5 — Integrate repository context

Display selected and automatically retrieved context from Member 2. Add `@file` and `@symbol` interaction only to the extent supported by the shared backend contract.

### Step 6 — Integrate ImpactLens

Render a fixture ImpactReport first. Then connect the real event/API.

Include:
- Summary counts.
- Affected file list.
- Risk level, reason and confidence.
- Expandable React Flow graph.
- Partial analysis/warning states.

Do not calculate impact inside the UI.

### Step 7 — Implement diff review

Start with one proposed file and a simple diff. Then add multiple files and hunk-level review.

- Use stable hunk IDs from the core service where possible.
- Keep pending/accepted/rejected states visible.
- Send decisions to the extension controller.
- Apply only through the core approval service.
- Show success only after the service confirms.
- Support undo through the same service.
- Test workspace changes that happen while a review is open.

### Step 8 — Integrate TestSheriff

Render fixtures for running, pass, fail, timeout, cancellation and error. Connect the real VerificationReport. Make “not run” visually distinct from “passed.”

### Step 9 — Final summary and predicted-vs-actual view

Compare the ImpactReport with the actual proposed/applied file list. Label the comparison carefully:
- Predicted affected files.
- Proposed files.
- Approved/applied files.
- Difference between prediction and actual changes.

Do not describe a predicted file as modified unless the core service confirms it.

### Step 10 — End-to-end integration and polish

Test the full user journey using the Flask challenge tasks. Check:
- Streaming.
- Cancellation.
- Multiple files.
- Individual hunk decisions.
- Undo.
- Test execution status.
- Error handling.
- Empty/partial reports.
- Responsive layout and VS Code theme.

---

## 9. Required UI states

Every major panel must handle these states deliberately.

| Panel | Required states |
|---|---|
| Agent | idle, connecting, streaming, completed, cancelled, error |
| ImpactLens | loading, ready, empty, partial, error |
| Diff review | no changes, pending, partially reviewed, ready to apply, applying, applied, rejected, error |
| TestSheriff | not run, queued, running, passed, failed, timed out, cancelled, error |
| Workspace | available, no workspace, workspace changed/closed |

Never use a green success state for an unverified or incomplete result.

---

## 10. Testing and definition of done

### Component tests

- Prompt submits one instruction and prevents accidental duplicate submission.
- Streaming appends text correctly.
- Cancel invokes the controller and updates state.
- Impact list shows reasons and confidence.
- Graph renders nodes/edges and handles empty data.
- Diff hunk can be accepted/rejected.
- Pending/rejected hunks are not sent for application.
- Apply/undo UI reflects confirmed service responses only.
- Verification panel distinguishes pass/fail/not-run/timeout/error.
- Final summary does not confuse predicted and actual changed files.

### Extension integration tests

- Command opens the panel.
- Webview bridge validates messages.
- Events are subscribed/unsubscribed correctly.
- Member 1 agent events render.
- Member 3 ImpactReport renders.
- Member 4 VerificationReport renders.
- Workspace closure/change is handled.
- Cancellation does not result in late unapproved edits.

### End-to-end acceptance test

1. Open the Flask challenge repository in VS Code.
2. Open RepoPilot.
3. Submit a natural-language instruction.
4. Observe streamed agent activity.
5. Observe automatic repository context.
6. Observe ImpactLens affected-file report before editing.
7. Observe proposed changes across the required files.
8. Accept one hunk and reject another.
9. Confirm only accepted changes are applied.
10. Undo an applied change and confirm the workspace is restored.
11. Re-apply the intended approved changes.
12. Run TestSheriff and display actual results.
13. Confirm final summary compares predictions, changes and test evidence.
14. Simulate an unavailable agent endpoint and verify clear failure with no unapproved workspace changes.

### Definition of done

- [ ] VS Code extension activates and opens RepoPilot.
- [ ] Webview communicates through a validated typed bridge.
- [ ] Prompt, streaming and cancellation work with Member 1's real service.
- [ ] Context from Member 2 is displayed accurately.
- [ ] ImpactLens report and graph from Member 3 are displayed accurately.
- [ ] Multi-file diff review is usable.
- [ ] Hunk-level accept/reject works through the core service.
- [ ] Only approved hunks are applied.
- [ ] Undo works through the core service.
- [ ] TestSheriff statuses and results from Member 4 are displayed accurately.
- [ ] Errors, empty states and incomplete reports are handled.
- [ ] No direct model calls or arbitrary command execution occur in the UI.
- [ ] Typecheck, lint, component and integration tests pass.
- [ ] End-to-end competition workflow is demonstrated.

---

## 11. Antigravity master instruction

Paste this instruction into Antigravity after opening the team's shared repository:

> You are implementing Member 5's VS Code UI, diff-review experience and integration layer for RepoPilot AI. First inspect the existing repository, project instructions, extension manifest, current webview setup, build scripts, shared contracts, Member 1's agent/controller and edit-approval APIs, Member 2's context results, Member 3's ImpactReport and Member 4's VerificationReport. Do not scaffold a new project, replace the extension setup, invent APIs, or modify another member's domain module without explaining the need and obtaining agreement.
>
> Build one coherent VS Code-native experience. The webview must communicate through a typed, validated extension-host bridge. It must display natural-language instructions, streaming agent activity, cancellation, repository context, ImpactLens's affected-file list and graph, proposed multi-file diffs, per-hunk accept/reject, confirmed apply/undo actions, TestSheriff results and a final evidence-based summary.
>
> Keep domain logic out of React components. Do not call model APIs from the webview, run shell commands from UI code, calculate impact locally, parse test output locally, or apply workspace edits directly from React. Route all actions to the correct shared service. Only report success after the backend confirms it. Never call predicted files “modified” unless the core service confirms the change.
>
> Work incrementally: inspect and propose file plan; confirm contracts; make the extension shell work; create the typed bridge; add prompt/streaming/cancellation; integrate context; integrate ImpactLens; implement diff review; integrate TestSheriff; add final summary; run component, integration and end-to-end tests. Preserve working functionality and report exact changed files and actual test results after each stage.

---

## 12. Member 5 coordination checklist

Before coding:
- [ ] Confirm Member 1's agent event and cancellation contract.
- [ ] Confirm Member 1's proposed-diff, apply and undo contracts.
- [ ] Confirm Member 2's context payload.
- [ ] Confirm Member 3's ImpactReport and graph schema.
- [ ] Confirm Member 4's VerificationReport and status model.
- [ ] Agree shared event names and state transitions.

During coding:
- [ ] Work on `feature/vscode-interface`.
- [ ] Keep domain logic in the owning modules.
- [ ] Use fixtures only as temporary UI development data.
- [ ] Validate all webview messages.
- [ ] Test every loading, empty, error and cancellation state.
- [ ] Commit small, reviewable changes.

Before integration:
- [ ] Replace mocks with real service events.
- [ ] Demonstrate hunk approval/rejection and undo.
- [ ] Demonstrate accurate verification states.
- [ ] Run the end-to-end Flask task flow.
- [ ] Open a pull request and obtain review.

**Success criterion:** A developer can complete the entire RepoPilot workflow inside VS Code, understand what the agent is doing, control every proposed edit and see truthful evidence of verification.
