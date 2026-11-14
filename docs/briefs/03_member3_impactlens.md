# RepoPilot AI — Member 3 Development Guide
## ImpactLens: Predictive Intelligence, Dependency Analysis & Impact Visualisation

**Document purpose:** Give Member 3 and Antigravity a self-contained, implementation-ready specification for building the ImpactLens layer of RepoPilot AI.

**Product:** RepoPilot AI — an impact-aware autonomous coding agent with human-controlled edits and automated verification  
**Role owner:** Member 3 — Predictive Intelligence (ImpactLens)  
**Primary responsibility:** Before RepoPilot edits code, identify which files and code components may be affected, explain why, and provide structured impact data for the agent and VS Code interface.

---

## 1. Mission and boundaries

ImpactLens is Layer 2 of the three-layer architecture:

1. **Layer 1 — Core RepoPilot:** repository understanding, context retrieval, planning and proposed edits.
2. **Layer 2 — ImpactLens:** dependency analysis, affected-file prediction, risk explanation and graph data.
3. **Layer 3 — TestSheriff:** test discovery, execution and verification.

ImpactLens must be a **capability invoked by the central RepoPilot agent**, not a separate autonomous agent. It must not call a model provider directly, make edits, or apply changes. Its job is analysis and reporting.

### Primary workflow

`ChangeRequest + RepositoryContext → dependency analysis → ImpactReport → RepoPilot plan/UI`

ImpactLens should be useful even when the repository is large or incomplete. Start with explainable static relationships (imports, exports and symbol references). Do not claim that static analysis proves runtime impact.

### In scope for the first competition build

- Consume the repository index and context supplied by Member 2.
- Build or update a lightweight dependency graph.
- Analyse direct import relationships and available symbol references.
- Identify likely affected files for a proposed change.
- Assign transparent Low / Medium / High impact levels using documented rules.
- Explain why each file was included.
- Return structured data that Member 1 and Member 5 can consume.
- Provide graph nodes and edges for the UI.
- Support incremental updates after files change.

### Out of scope for the first build

- Perfect runtime call-graph analysis.
- Whole-program semantic analysis across every language.
- Guaranteed prediction of all indirect effects.
- Autonomous code editing or test execution.
- A separate LLM/agent dedicated to impact prediction.
- Complex machine-learning risk scoring without reliable training data.

---

## 2. Required stack

Use the existing repository's package manager, TypeScript configuration and lint/test conventions. Do not introduce a second application or backend unless the team agrees.

| Area | Recommended technology | Use |
|---|---|---|
| Language | TypeScript | Main implementation |
| Runtime | Node.js version compatible with the shared project | Local analysis |
| Editor integration | VS Code Extension API (through shared services) | Workspace and file identity |
| Parsing | Tree-sitter, only if already selected/available in the shared project | Extract imports and symbols |
| Fast search | ripgrep, through Member 2's repository tools | Text/symbol references |
| Graph model | In-memory TypeScript maps/sets | Nodes and edges |
| UI graph | React Flow, owned/rendered by Member 5 | Visualise returned graph data |
| Validation | Zod or the project's existing validation library | Validate module inputs/outputs |
| Unit tests | Vitest | Test graph and impact logic |
| Version control | Git | Branch and integration |

**Important:** Member 3 owns analysis and graph-data generation. Member 5 owns the React Flow presentation. Do not create a competing UI inside the ImpactLens module.

---

## 3. Dependencies and collaboration contracts

### Required input from Member 2

Ask Member 2 to expose a stable repository-index interface. At minimum, ImpactLens needs:

- Workspace-relative file paths.
- Importing file → imported file relationships where resolvable.
- Exported and declared symbols where available.
- Symbol references or search results where available.
- A way to refresh or query the index after file changes.

Do not independently rescan the entire repository if Member 2 already provides this information. If the interface is not ready, create a small adapter and use mock fixtures for development.

### Required input from Member 1

Member 1 owns central orchestration and the TrueForge agent loop. Agree on:

- How the agent invokes `analyse_impact`.
- The exact input payload.
- Error and timeout conventions.
- Whether the call is made before planning, before editing, or both.
- How an impact report is returned to the agent.

ImpactLens must not create its own agent session.

### Required output for Member 5

Return framework-neutral JSON data. Member 5 will render it.

- `nodes`: file/symbol identifiers and labels.
- `edges`: source/target relationships and relationship type.
- `affectedFiles`: paths, impact level, score if used, and reason.
- `summary`: counts and limitations.
- `warnings`: unresolved imports, unsupported files or incomplete analysis.

### Required output for Member 4

Where possible, include affected test-file candidates or links between source files and tests. Member 4 remains responsible for deciding and executing tests. ImpactLens must not run test commands.

---

## 4. Shared data contracts

Place shared contracts in the team's agreed `src/shared/types/` location. Do not create duplicate definitions in a private folder. Coordinate any changes with Member 1.

Suggested initial contracts (adapt names to the existing shared definitions):

```ts
export type ImpactLevel = "low" | "medium" | "high";

export interface ChangeRequest {
  id: string;
  instruction: string;
  selectedFile?: string;
  selectedCode?: string;
  proposedFiles?: string[];
}

export interface DependencyNode {
  id: string;
  path: string;
  kind: "file" | "symbol" | "test";
  label: string;
}

export interface DependencyEdge {
  source: string;
  target: string;
  type: "imports" | "references" | "exports" | "tests";
  confidence: "observed" | "inferred";
}

export interface AffectedFile {
  path: string;
  level: ImpactLevel;
  score?: number;
  reason: string;
  relationshipPath: string[];
  confidence: "high" | "medium" | "low";
}

export interface ImpactReport {
  requestId: string;
  generatedAt: string;
  affectedFiles: AffectedFile[];
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  summary: {
    analysedFiles: number;
    affectedCount: number;
    high: number;
    medium: number;
    low: number;
    incomplete: boolean;
  };
  warnings: string[];
}
```

The contracts above are a starting proposal, not a reason to overwrite types already agreed by the team. Prefer the shared canonical types.

### Contract rules

- Use workspace-relative paths, normalised consistently.
- Do not return absolute machine-specific paths unless explicitly required internally.
- Every affected file must have a human-readable reason.
- Mark inferred relationships separately from observed relationships.
- Never describe a prediction as certainty.
- Return empty arrays rather than `null` for collection fields.
- Include warnings when analysis is partial.

---

## 5. Functional requirements

### FR-1: Dependency graph construction

Build a graph from repository-index data.

- Each file is a node.
- Imports/references are directed edges.
- Preserve relationship type.
- Avoid duplicate edges.
- Handle unresolved imports without crashing.
- Do not index dependency folders, build outputs, virtual environments or generated files unless the shared index explicitly includes them.

### FR-2: Impact analysis

Given a ChangeRequest and repository context:

1. Identify the directly changed or proposed files/symbols.
2. Find files that import or reference those targets.
3. Traverse a limited number of dependency hops.
4. Deduplicate affected files.
5. Explain each inclusion with a relationship path.
6. Assign an impact level using transparent heuristics.

### FR-3: Explainable impact levels

Start with simple deterministic rules. For example:

- **High:** direct dependency of a proposed change, shared entry point/configuration, or a file with multiple direct relationships to the changed component.
- **Medium:** one or two dependency hops away, or a relevant test/documentation file.
- **Low:** weak or inferred relationship, optional documentation, or a distant dependency.

These are suggested heuristics. Record the exact rules in code comments and documentation. Do not imply the score is statistically calibrated.

### FR-4: Impact graph response

Return graph data for the UI, including:

- Node IDs stable within a report.
- Source and target edge IDs.
- Relationship labels.
- Highlighted changed/proposed nodes.
- Highlighted affected nodes.
- Impact level and confidence.

### FR-5: Incremental refresh

When files change, refresh the affected portion of the graph if the shared repository index supports it. If not, use a safe full refresh for the competition prototype and document the limitation.

### FR-6: Failure handling

- An unreadable file must not crash the full analysis.
- An unresolved import must be recorded as a warning.
- Unsupported syntax must reduce confidence, not fabricate a relationship.
- Empty or missing repository context must produce a useful empty/partial report.
- Add a sensible timeout or traversal limit to prevent runaway analysis.

---

## 6. Step-by-step implementation plan

### Step 1 — Inspect before coding

Ask Antigravity to inspect the current repository, `AGENTS.md`, README, package scripts, shared types, Member 2's repository-index implementation and existing tests.

Do not scaffold a new project. Do not replace configuration files. Report:
- Existing architecture and conventions.
- Available repository-index APIs.
- Existing dependency data.
- Exact files proposed for modification.
- Any missing prerequisite from Member 2.

Wait for the inspection summary before broad edits.

### Step 2 — Create the ImpactLens module boundary

Suggested structure (fit it to the current repository):

```text
src/
  impact/
    index.ts
    types.ts                 # only if shared types do not already exist
    dependency-graph.ts
    impact-analyser.ts
    impact-rules.ts
    impact-report.ts
    graph-adapter.ts
    errors.ts
tests/
  unit/
    impact/
      dependency-graph.test.ts
      impact-analyser.test.ts
      impact-rules.test.ts
```

Keep graph construction, analysis, scoring and serialisation in separate files. Export a small public API from `index.ts`.

### Step 3 — Build graph normalisation

Implement functions that:
- Accept Member 2's index data.
- Normalise paths and identifiers.
- Convert imports/references to nodes and edges.
- Remove duplicate edges.
- Record unresolved relationships.
- Produce deterministic output for identical input.

Test empty repository, one file, circular imports, duplicate imports and unresolved imports.

### Step 4 — Implement direct impact first

Before adding graph traversal, correctly identify direct dependants of one changed file. Then add bounded traversal (for example, a configurable maximum of two hops).

Keep traversal deterministic and prevent cycles with a visited set.

### Step 5 — Add explainable risk rules

Implement risk classification in a dedicated function. Each classification must include:
- The rule that matched.
- The relationship path.
- A confidence value.
- A short plain-language reason.

Avoid opaque or arbitrary numerical precision. If a score is included, label it as a heuristic score.

### Step 6 — Produce ImpactReport

Create one public function similar to:

```ts
export async function analyseImpact(
  request: ChangeRequest,
  repositoryContext: RepositoryContext
): Promise<ImpactReport>
```

Use the team's actual shared type names. Keep it deterministic where possible and avoid side effects.

### Step 7 — Expose the MCP capability

Coordinate with Member 1 before registering the tool. The proposed tool name is `analyse_impact`.

Suggested input:
- `requestId`
- `instruction`
- `proposedFiles` and/or selected file/symbol
- repository context identifier or the agreed context payload

Suggested output: the complete validated ImpactReport.

Do not invent a TrueForge API. Member 1 must confirm the current TrueForge/MCP integration contract and register the tool through the shared MCP layer.

### Step 8 — Hand graph data to Member 5

Provide a short integration example and a fixture report. Member 5 should be able to render the fixture before the live analysis is connected.

Agree on:
- Node/edge schema.
- Highlighting fields.
- How the UI handles a large graph.
- Empty and partial analysis states.

### Step 9 — Connect TestSheriff candidates

If the repository index identifies test files, include them as candidate affected nodes or annotations. Send candidates to Member 4 through the agreed report/interface. Member 4 owns test selection and execution.

### Step 10 — Integrate and validate

Run the shared project's lint, typecheck and unit tests. Test against the Flask challenge repository and the team's fixed tasks. Confirm that analysis is fast enough for an interactive workflow and that partial results are clearly labelled.

---

## 7. MCP/tool proposal

Proposed tool names (not built-in TrueForge APIs):

| Tool | Owner | Purpose |
|---|---|---|
| `analyse_impact` | Member 3 | Produce an ImpactReport for a request |
| `get_impact_graph` | Member 3 | Return graph data for the UI or agent |

Keep tool registration in the shared MCP layer owned/coordinated by Member 1. Member 3 implements the underlying functions and schemas.

---

## 8. Test plan and definition of done

### Unit tests

- Empty repository returns a valid empty report.
- Direct import dependency is identified.
- Two-hop dependency is identified when within configured depth.
- Circular imports do not cause infinite traversal.
- Duplicate edges are removed.
- Unresolved imports create warnings.
- Affected files include reasons and relationship paths.
- Risk rules are deterministic.
- Unsupported files do not cause a crash.
- Paths are workspace-relative and normalised.

### Integration tests

- Member 2's repository index can be consumed.
- Member 1 can invoke the analysis capability.
- Member 5 can render the returned graph.
- Member 4 can receive relevant test candidates if available.
- Analysis runs before code changes and does not modify the workspace.

### Definition of done

- [ ] ImpactLens builds and typechecks in the shared repository.
- [ ] Dependency graph is generated from real repository data.
- [ ] Direct affected files are identified correctly on fixtures.
- [ ] Bounded dependency traversal works without cycles.
- [ ] Every affected file has a reason and confidence.
- [ ] Impact levels are explainable and labelled as estimates.
- [ ] ImpactReport matches the agreed shared contract.
- [ ] MCP invocation works through the central tool layer.
- [ ] UI receives usable graph data.
- [ ] Unit and integration tests pass.
- [ ] No code is edited or tests executed by ImpactLens itself.

---

## 9. Antigravity master instruction

Paste this instruction into Antigravity after opening the team's shared repository:

> You are implementing Member 3's ImpactLens module for RepoPilot AI. First inspect the complete existing repository, project instructions, shared types, package scripts, Member 2's repository-index APIs and Member 1's MCP/tool conventions. Do not create a new project, overwrite configuration, invent unavailable APIs, or modify files owned by other members without explaining why and obtaining agreement.
>
> Implement ImpactLens as a deterministic, explainable analysis capability, not a separate autonomous agent. It must consume the shared repository context, build/normalise a lightweight dependency graph, identify potentially affected files before edits, explain each relationship, assign transparent heuristic impact levels, and return the agreed ImpactReport for the central agent and Member 5's UI.
>
> Work in small stages: (1) inspect and propose a file plan, (2) confirm contracts, (3) implement graph normalisation, (4) implement direct and bounded impact analysis, (5) add explanation/risk rules, (6) add tests, (7) expose the agreed function for the shared MCP layer, and (8) integrate. After each stage, run relevant typecheck/lint/tests and report changed files and results.
>
> Preserve all working functionality. Never claim a test passed unless it was actually executed. Mark incomplete or inferred analysis honestly. Do not add advanced semantic analysis, machine learning, a new agent, or unrelated features before the minimum scope is reliable.

---

## 10. Member 3 coordination checklist

Before implementation:
- [ ] Get the repository-index contract from Member 2.
- [ ] Get the shared ImpactReport contract approved by Member 1.
- [ ] Agree on graph payload with Member 5.
- [ ] Agree on test-candidate handoff with Member 4.

During implementation:
- [ ] Keep the analysis module independent of UI.
- [ ] Keep analysis deterministic and bounded.
- [ ] Commit small changes to `feature/impact-analysis`.
- [ ] Open a pull request; do not commit directly to `main`.

Before integration:
- [ ] Provide fixtures and a sample report.
- [ ] Document limitations and confidence rules.
- [ ] Run tests and attach actual output.
- [ ] Verify no workspace modifications occur during analysis.

**Success criterion:** Before RepoPilot edits, the developer can see a defensible, understandable estimate of which files may be affected and why.
