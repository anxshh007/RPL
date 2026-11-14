# Member 2 --- Repository Intelligence & Context Assembly

**Branch:** `feature/repository-context`\
**Ownership:** `src/repository/` and repository unit tests.\
**Outcome:** RepoPilot discovers the right files and symbols
automatically, retrieves explainable context within a budget, and
supplies dependency data to ImpactLens.

## Antigravity role instruction

Act as Member 2's senior repository-intelligence engineer. First inspect
the repository, branch, `git status`, `AGENTS.md`, package files, shared
contracts and existing code. Produce a read-only plan before editing.
Never overwrite another member's uncommitted work. Implement only your
owned folders and use the shared contracts exactly.

## 1. Product and competition requirements

RepoPilot has three connected layers: Core RepoPilot
(agent/orchestration), ImpactLens (pre-edit impact analysis) and
TestSheriff (post-edit verification). Your module supplies repository
context to the central TrueForge agent and dependency data to
ImpactLens. Do not create another agent loop.

Mandatory context capabilities: - Explicit `@file` and `@symbol`
mentions. - Automatic retrieval of relevant code the user did not
mention. - Context selection that respects a budget. - Visible
explanation of which files/symbols were selected and why. - Agent must
discover at least three files for the Flask `flask config` task without
user naming them.

## 2. Technology stack

-   Node.js LTS, npm, TypeScript strict mode.
-   VS Code workspace APIs for workspace boundaries and editor context.
-   ripgrep for fast text search, with Node-based fallback.
-   Tree-sitter for syntax-aware symbol extraction; start with Python.
-   Zod for runtime validation if selected by shared project.
-   Vitest for unit tests. Do not add a second package manager. Verify
    package and grammar compatibility before installing. Do not guess
    package versions.

## 3. Required features

1.  Workspace file discovery respecting `.gitignore`.
2.  Safe file reading and text search.
3.  Symbol extraction (functions, methods, classes, imports, line
    ranges).
4.  Python import/dependency extraction for Flask first.
5.  Parse and resolve `@file` and `@symbol`.
6.  Automatic retrieval based on instruction, active selection, symbols,
    imports, tests and docs.
7.  Transparent ranking and context-size budget.
8.  Incremental invalidation/reindex after approved edits.
9.  Fallback if ripgrep or Tree-sitter is unavailable.

## 4. Implementation steps

### Step 1 --- Repository scan

-   Enumerate workspace-relative files.
-   Exclude `.git`, `node_modules`, virtual environments, caches, build
    output, binaries and generated files.
-   Respect `.gitignore`.
-   Skip likely secrets such as `.env` and credential files.
-   Limit file size and total scan time.
-   Normalize all returned paths to workspace-relative POSIX paths.
-   Reject path traversal and paths outside workspace.

### Step 2 --- Search service

Implement: - `listWorkspaceFiles` -
`searchWorkspace(query, globs?, limit?)` -
`readWorkspaceFile(path, startLine?, endLine?)` -
`getFileMetadata(path)`

Use ripgrep if installed. If unavailable, fall back to a tested Node
filesystem search. Bound result count and excerpt length. Never dump
entire large files into context by default.

### Step 3 --- Symbol index

Use Tree-sitter after confirming package and grammar support in the
actual Node environment. For Flask, prioritise Python: - functions and
methods - classes - imports - parent scope if available - source path
and start/end lines

Suggested internal type:

``` ts
interface SymbolRecord {
  name: string;
  kind: "function" | "method" | "class" | "variable" | "module";
  file: string;
  startLine: number;
  endLine: number;
  parent?: string;
}
```

When parsing fails, mark the file as partial and use text-search
fallback. Do not claim semantic certainty from heuristics.

### Step 4 --- Dependency extraction

For initial release, parse Python: - `import package.module` -
`from package.module import name` - relative imports - resolve module
paths to workspace files where possible

Use the shared edge type:

``` ts
{ from: string; to: string; kind: "imports" | "references" }
```

Keep unresolved/external imports separate. Do not invent runtime call
relationships.

### Step 5 --- Context assembly algorithm

For every `ChangeRequest`: 1. Parse explicit `@file` and `@symbol`. 2.
Add active editor file and selected region for inline mode. 3. Search
filenames, symbols and text using instruction terms. 4. Add directly
related imports/references where relevant. 5. Find associated tests and
docs using observed imports/references first, naming conventions second.
6. Rank candidates transparently. Suggested factors: explicit mention,
active selection, exact symbol match, text match, direct dependency,
test/doc relationship. 7. Deduplicate overlapping excerpts. 8. Fit
within configurable context budget. 9. Preserve explicit mentions where
possible; if they exceed budget, report the conflict instead of silently
dropping them. 10. Return each file's reason and score, relevant
symbols, dependency edges and token estimate.

Use a conservative character-to-token estimate. Start with configurable
12k--20k token-equivalent budget, then measure against actual
TrueForge/model context. Do not claim this estimate is exact.

### Step 6 --- Incremental index refresh

Expose `invalidate(paths)` and `reindex(paths)`. After approved changes,
refresh affected file entries. Debounce filesystem events if using a
watcher. Never serve stale index data silently.

## 5. Public API for integration

Coordinate exact signatures with Member 1. Suggested service:

``` ts
interface RepositoryIntelligence {
  initialize(root: string): Promise<void>;
  search(query: string, limit?: number): Promise<SearchResult[]>;
  findSymbol(name: string, fileHint?: string): Promise<SymbolRecord[]>;
  getContext(request: ChangeRequest): Promise<RepositoryContext>;
  getDependencies(paths: string[]): Promise<DependencyEdge[]>;
  invalidate(paths: string[]): void;
  reindex(paths: string[]): Promise<void>;
}
```

Use `RepositoryContext` and `ChangeRequest` from
`src/shared/contracts/`. Do not create duplicate types.

## 6. Suggested file layout

``` text
src/repository/
  workspace-scanner.ts
  ignore-rules.ts
  ripgrep-search.ts
  symbol-index.ts
  python-import-parser.ts
  dependency-index.ts
  mention-parser.ts
  context-ranker.ts
  context-budget.ts
  repository-service.ts
  index.ts
tests/unit/repository/
```

## 7. Tests

-   Ignores `.git`, node_modules, caches, binaries and secrets.
-   Resolves `@file`, including spaces and relative paths.
-   Resolves `@symbol` to correct declaration and line range.
-   Finds Flask CLI source, tests and documentation from repository
    evidence.
-   Parses absolute and relative Python imports.
-   Reports unresolved external imports honestly.
-   Ranking is deterministic.
-   Explicit mentions have priority.
-   Budget is respected within stated estimator.
-   Edits invalidate stale entries.
-   Missing ripgrep/Tree-sitter does not crash module.

## 8. Fixed Task B acceptance

Given only the natural-language instruction to add `flask config`, your
service must discover the CLI implementation file, existing CLI tests
and documentation location. Do not hard-code those paths as the answer.
Return at least three relevant files with evidence/reasons so the UI can
show what the agent selected and why.

## 9. Team workflow

Shared branches: - `feature/core-agent` - `feature/repository-context`
(yours) - `feature/impactlens` - `feature/testsheriff` -
`feature/ui-diff`

Merge shared contracts first. Own only `src/repository/`. Submit small
PRs; run tests before merge; integrate daily. Coordinate dependency-edge
fields with Member 3 and context API with Member 1. Never edit other
modules to "make it work" without a PR/approval.

## 10. Definition of done

-   [ ] Safe file discovery/search/read.
-   [ ] `@file` and `@symbol`.
-   [ ] Automatic context retrieval.
-   [ ] Explainable ranking and context budget.
-   [ ] Python dependency data for ImpactLens.
-   [ ] Index refresh after changes.
-   [ ] Unit tests for parser, ranker, budget and path safety.
-   [ ] Member 1 and Member 3 can consume your stable API.

## 11. Antigravity first prompt

"Act as Member 2. Read this full brief and the shared project contracts.
First perform read-only reconnaissance and present exact files, indexing
strategy, verified package/API compatibility, risks and tests. Do not
code until the plan is presented. Then implement repository intelligence
only. Prioritise Python/Flask, deterministic explainable retrieval and
budget-aware context. Do not hard-code Task B file paths, duplicate
shared types or modify the agent/UI modules. Run actual tests after each
phase and finish with a handoff to Members 1 and 3."

## Official references

-   Competition statement:
    https://techfest.org/media/compiProbStatement/TrueFoundry_Forge-a-thon_compressed_UvvRJ9C.pdf
-   Tree-sitter: https://tree-sitter.github.io/tree-sitter/
-   ripgrep: https://github.com/BurntSushi/ripgrep
-   VS Code API: https://code.visualstudio.com/api
-   Antigravity rules:
    https://antigravity.google/docs/rules-workflows?tab=ide
