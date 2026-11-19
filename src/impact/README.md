# ImpactLens

Before RepoPilot edits anything, ImpactLens answers one question: **"If these files change, which other files might be affected, and why?"**

It is a deterministic, read-only analysis service that the central agent calls. It builds a lightweight dependency graph from the edges the repository module supplies, finds the files that depend on the changed files within a bounded number of hops, and returns the shared `ImpactReport`.

The result is an **estimate** based on static relationships. It does not prove runtime impact.

## What it never does

- call a model, an API or the network
- edit files, or run tests or commands
- create its own agent or session
- draw UI, or choose colours or styles
- import `vscode` (it runs in plain Node)
- claim certainty

A unit test scans this folder's sources and fails if any of them imports a file, process or network module, `vscode`, or another module's code.

## How to call it

```ts
import { createImpactAnalyser } from '../impact';

const impact = createImpactAnalyser();

// 1. Before planning: the changed files come from the request
//    (active file plus explicit file mentions).
const predicted = await impact.analyseImpact(request, context, [], signal);

// 2. Again once a plan exists: the proposed files replace the request's files.
const proposed = await impact.analyseImpact(request, context, proposedPaths, signal);
```

`analyseImpact` never rejects. Bad input produces warnings, and an unexpected failure produces an empty report with `summary.incomplete = true`.

Options, all optional:

```ts
createImpactAnalyser({
  maxDepth: 2,          // hops from a changed file
  maxVisitedFiles: 500, // cap on affected files
  maxGraphNodes: 50,    // cap on nodes in the UI graph
  now: () => new Date() // clock for generatedAt; fix it for reproducible output
});
```

The returned service also has `invalidate(paths?)`; see [Refresh](#refresh).

## Which files count as changed

1. If `proposedFiles` is non-empty, those files are used and the request is ignored.
2. Otherwise the request's `activeFile` and `explicitFileMentions` are used.
3. With no valid file, the report is empty and carries a warning.

If proposed files are given but every one is rejected, the result is empty. It does not fall back to the request.

## Path rules

Every path is a workspace-relative POSIX path with no leading `./`. Input is tidied first: `\` becomes `/`, repeated slashes collapse, and `.` segments are removed.

A path is rejected, with a warning, when it is:

- absolute (a leading slash, a UNC prefix or a drive letter)
- contains a `..` segment
- inside `.git` or `node_modules`, or a `.env` / `.env.*` file
- empty, or not a string

An edge with a rejected path is ignored. Symlink escapes cannot be checked here, because this module never touches the disk.

## Input edges

Each edge `{ from, to, kind, evidence }` means **`from` depends on `to`**.

- Duplicate edges (same `from`, `to` and `kind`) collapse to one. An `observed` copy beats an `inferred` one.
- An edge from a file to itself is ignored, with a warning.
- A malformed entry (not an object, or an invalid `kind` or `evidence`) is ignored, with a warning.
- Unresolved imports are reported as warnings. Impact through them is not analysed.

## Traversal

A breadth-first walk from the changed files along "who depends on this".

- A changed file is never reported as affected.
- Each affected file appears once, with the shortest path to it. Ties resolve by path order.
- An all-observed path is preferred over a shorter path that includes an inferred link. A file is treated as inferred only when no all-observed path reaches it within `maxDepth`.
- A visited set makes cycles terminate.

## Risk rules

One function, `classifyImpact` in `impact-rules.ts`, decides the risk, the confidence, the matched rule and the reasons. The rules are checked in this order, and the first that applies is the matched rule:

| # | Rule | Risk | Applies when |
|---|---|---|---|
| 1 | `inferred-only` | low | no all-observed path reaches the file |
| 2 | `multiple-direct-links` | high | observed direct links to two or more changed files |
| 3 | `direct-dependency` | high | an observed direct link to a changed file |
| 4 | `entry-or-config` | high | the file name matches `__init__.py`, `app.py`, `cli.py`, `config*` or `settings*` |
| 5 | `linked-test-or-doc` | medium | the file is a test or a documentation file |
| 6 | `two-hop` | medium | two observed hops from a changed file |
| 7 | `distant` | low | three or more observed hops |

Rule 1 is an override: weak evidence caps the risk at low. After it the rules run from high to low, so the highest applicable risk wins.

Every rule that applies adds a plain-English reason, matched rule first. For example, a test that imports a changed file is `direct-dependency`, with the reasons:

- "imports src/flask/helpers.py, which is being changed"
- "is a test file linked to the change"

### Confidence

Confidence says how sure we are that the relationship exists. It is separate from risk.

| Confidence | When |
|---|---|
| high | observed, one hop |
| medium | observed, two hops |
| low | any inferred link on the path, or three or more hops |

### File kinds

- **Test file:** under a `tests` directory, or named `test_*.py` or `*_test.py`.
- **Documentation file:** under a `docs` directory, or ending in `.rst` or `.md`.

### No numeric score

`AffectedFile.heuristicScore` is not set. The levels are rule-based estimates; nothing here is a probability or statistically calibrated.

## The report

| Field | Content |
|---|---|
| `changedTargets` | normalised changed files, sorted |
| `affectedFiles` | ordered by risk (high first), then hops, then path. Each has `reasons`, `relationshipPath` (changed file first), `confidence` and `matchedRule` |
| `testCandidates` | affected test files, with `source: 'impact'`, a reason and a confidence. They also stay in `affectedFiles` |
| `nodes`, `edges` | graph data for the UI; see below |
| `summary` | counts per risk level, `analysedFiles` and `incomplete` |
| `warnings` | everything that was ignored, rejected or cut short |
| `limitations` | always starts with "Static analysis only; does not prove runtime impact." |

`relatedSymbols` is always `[]`: the edges carry no symbol-level evidence, so naming symbols would be a guess.

Collections are `[]` when empty, never `null`. The same input always gives the same output in the same order; only `generatedAt` depends on the clock.

### When `summary.incomplete` is true

Always together with a warning that explains why:

- the traversal stopped early (the file cap was reached, or the signal was aborted)
- part of the input was ignored (a missing list, a malformed entry, a rejected path)
- a changed-file path was rejected
- the repository context has no dependency edges at all

It is **not** set by:

- unresolved imports alone. The repository module lists external imports as unresolved, so they appear in almost every real context; they are reported as warnings.
- reaching `maxDepth`. That is the designed bound, stated in `limitations`.
- trimming the UI graph. That is a display limit; `affectedFiles` still lists every file.

## Graph data for the UI

| | |
|---|---|
| Node `id` | the file path |
| Node `label` | the file name |
| Node `kind` | `'test'` for test files, otherwise `'file'` |
| Node `highlight` | `'changed'`, `'affected'`, or `'none'` for a file that is only on a path |
| Node `risk` | set on affected nodes only |
| Edge `id` | `` `${source}→${target}:${kind}` `` |
| Edge direction | from the dependant (`source`) to what it depends on (`target`) |
| Edges included | every known link between the shown files |

The graph is capped at 50 nodes: changed files first, then affected files from highest risk down. Trimming adds a warning and drops the edges of trimmed nodes.

Output is **semantic only**: `risk`, `highlight`, `confidence`, `kind` and `evidence`. The RepoPilot UI uses a light theme and maps these values to its own palette. There are no colours, CSS or theme logic in this module.

A complete sample report for the UI is in `tests/fixtures/impact/sample-report.ts`. A unit test keeps it identical to the analyser's real output.

## Tool handlers

`tools.ts` exports plain handlers for the two tools named in `src/mcp/tool-names.ts`. It registers nothing; the agent module's owner does that in `src/mcp/`.

| Tool | Handler | Returns |
|---|---|---|
| `analyse_impact` | `handleAnalyseImpact(analyser, input, signal?)` | the full `ImpactReport` |
| `get_impact_graph` | `handleGetImpactGraph(analyser, input, signal?)` | `requestId`, `generatedAt`, `changedTargets`, `nodes`, `edges`, `warnings`, `incomplete` |

- **Input for both:** `{ request, context, proposedFiles? }`, described as a JSON Schema object in `IMPACT_TOOL_INPUT_SCHEMA`.
- **Result of both:** `{ ok: true, value }` or `{ ok: false, error }`, where `error` is a `SafeError`. A handler never throws.
- `createImpactToolHandlers(analyser)` returns both handlers keyed by tool name. Pass the agent's own analyser so they share its graph cache.
- Input of the wrong shape is a `validation` error that names the fields and never echoes their values. An already-aborted signal is a `cancelled` error.
- The input check is structural. `TODO(zod)`: replace it with the shared Zod schemas once they exist (DECISIONS D-11).

## Refresh

Each service keeps a small cache of built graphs, so the agent's second call for a request does not rebuild the graph.

- The key is the **content** of the context's edges and unresolved imports, in any order. A context that changed is always rebuilt, so a stale graph cannot be returned.
- `invalidate(paths)` drops the cached graphs that contain any of those files and returns how many it dropped. With no argument it drops them all.
- Calling `invalidate` is optional. It releases memory; it is not needed for correctness.
- The cache holds 8 graphs and drops the least recently used.

Limitations: the key is a string about as large as the edge list, and a context with a missing list is built every time and never cached.

## Defaults and limits

| Setting | Default | Effect when reached |
|---|---|---|
| `maxDepth` | 2 hops | files further away are not reported; stated in `limitations` |
| `maxVisitedFiles` | 500 affected files | stops, sets `incomplete`, adds a warning. Nearer files and observed links are kept first |
| `maxGraphNodes` | 50 nodes | graph trimmed, warning added, `affectedFiles` untouched |
| Graph cache | 8 graphs | least recently used is dropped |
| Detailed warnings | 10 lines per category | the rest are counted in one line |

An invalid limit (zero, negative, fractional, not a number) falls back to the default with a warning.

## Known limitations

- Static analysis only. It sees the edges it is given and nothing else: no runtime behaviour, dynamic imports or reflection.
- The quality of the result depends on the edges from the repository module. A missing edge is a missed dependant.
- Impact through unresolved imports is not analysed.
- The entry-point and configuration patterns, and the test and documentation rules, are name-based and tuned for Python projects.
- Symbol-level impact is not analysed; relationships are file to file.
- The walk is synchronous. An abort signal is honoured if it was aborted before the call; with the 500-file cap a run takes a few milliseconds.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | `createImpactAnalyser()`: the public entry, wires the parts |
| `dependency-graph.ts` | path rules, edge normalisation, forward and reverse maps, the graph cache |
| `impact-analyser.ts` | changed-file resolution, direct dependants, bounded traversal |
| `impact-rules.ts` | risk and confidence rules |
| `impact-report.ts` | assembles the `ImpactReport` |
| `graph-adapter.ts` | nodes and edges for the UI |
| `tools.ts` | handlers for `analyse_impact` and `get_impact_graph` |

All shared types come from `src/shared/contracts`. None is redefined here.

## Tests

One test file per source file in `tests/unit/impact/`, plus a fixture sanity test. Fixtures are TypeScript modules in `tests/fixtures/impact/` and are deep-frozen, so any attempt to modify the input fails a test.

```bash
npm run compile
npm test
```
