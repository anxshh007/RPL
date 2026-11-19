# Member 5 (UI): complete branch with Part A fixes

This folder is the **whole repository** as it should be on `feature/ui-diff`:

- base: Supriyo's branch as pushed to GitHub (`827a738`), already rebased onto `main` (`a251efd`,
  which has the repository module, ImpactLens, TestSheriff and the core agent merged);
- plus the five open review items fixed (below).

`node_modules/` and `out/` are only there so it runs straight away; both are git-ignored and must not be committed.
The shared contracts are unchanged.

## Files that differ from `feature/ui-diff` on GitHub

| File | Change |
|---|---|
| `src/webview/state/bridgeState.ts` (new) | All panel state in one pure reducer. A new request (`agent.status` = `starting`) clears events, warnings, streamed text, apply/undo results, running tests and errors. Events for any other requestId are ignored. Warnings are a list. |
| `src/webview/state/agentStatus.ts` (new) | Status badge for every contract `AgentState` (`executing` removed; `starting`, `review_required`, `applying` added) and which states count as "running". |
| `src/webview/hooks/useExtensionBridge.ts` | Uses the reducer (`useReducer`); returns `state` plus the same actions as before. |
| `src/webview/App.tsx` | Reads the new state; shows all warnings; Apply/Undo use the shown request; Cancel uses the running one; wires "Open diff". |
| `src/webview/components/PromptInput.tsx` | Slash commands removed (`/ponytail-review`, `/ponytail-audit`, `/verify`, `/ponytail`, the "/ skills" chip and the placeholder hint). The five fixed Flask example paths are replaced by the two prefixes `@file:` and `@symbol:`, because the open workspace can be any project. |
| `src/webview/components/DiffReview.tsx` | "Open diff" button per file (optional `onOpenDiff` prop). |
| `src/webview/styles.css` | 7 missing classes added: `mb-1`, `bg-emerald-600`, `border-blue-300`, `text-blue-800`, `hover:bg-gray-200`, `first:pt-0`, `last:pb-0`. Every class used in the `.tsx` files is now defined (checked by script). |
| `src/extension/proposed-plans.ts` (new) | Remembers the last 10 `change.proposed` plans. Only paths in the agent's own plan can be opened, so a path sent by the webview never opens an arbitrary file. No `vscode` import (unit-tested). |
| `src/extension/proposed-diff.ts` (new) | Read-only virtual document (`repopilot-proposed:` scheme) with the proposed content, and `vscode.diff` against the file on disk (empty left side for new files). Nothing is written. |
| `src/extension/extension.ts` | Three additions on top of the rebased file (which keeps Astha's `workspaceRoot` and "Run tests now?" code): register the content provider, record every event in `ProposedPlans`, handle `ui.openDiff`. |
| `tests/unit/webview/panel-state.test.ts` (new) | 13 tests against the real reducer, status badge and plan store (including the R2 bug: after an undo, a later apply must show as applied). |
| `tests/unit/agent/pipeline.test.ts` | **Member 1's test, one line:** compares the applied file ignoring line endings. On a Windows checkout the fixture is CRLF and the edit service correctly keeps CRLF, so the old exact comparison failed on every Windows run (Ubuntu CI is LF, so CI passed). |
| `package.json` | `panel-state.test.js` added to `"test"`. |

## Tested (real output)

Windows 11, Node 24, Python 3.12, pytest 9.2:

```
npm ci                                  → ok
npm run compile                         → exit 0 (tsc + esbuild: out/src/webview/webview.js and webview.css)
npx tsc -p tsconfig.webview.json        → exit 0
npm test                                → tests 382, pass 382, fail 0, skipped 0   (three runs in a row)
```

Full output: `npm-test-output.txt`.

Not done here: opening the panel in VS Code (F5) and a run against a live TrueForge server.

## Known, not part of this branch

TestSheriff's Python detection (`src/verification/discovery.ts`, Member 4) can pick a broken `py` launcher
under load and then report `error` for every run in that process. It only shows on machines where `py`
points to a missing Python. Member 4 has the two-line fix as a separate PR.
