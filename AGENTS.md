# AGENTS.md — rules for every human and AI agent (Antigravity) working in this repo

## Read first, in this order
1. This file.
2. `docs/DECISIONS.md`: overrides the member briefs wherever they conflict.
3. `src/shared/contracts/`: the only definitions of shared types, events and service interfaces.
4. Your own brief in `docs/briefs/`.

## Product
RepoPilot AI is **one** VS Code extension with **one** central TrueForge agent loop and three capabilities: Core RepoPilot, ImpactLens (pre-edit impact) and TestSheriff (post-edit verification). ImpactLens and TestSheriff are services the agent calls. They are not separate agents.

## Ownership (edit only your own folders)
| Owner | Folders | Branch |
|---|---|---|
| Lead | `src/shared/`, `AGENTS.md`, `docs/`, root config | `chore/...` |
| Member 1 | `src/agent/`, `src/mcp/`, `src/edits/`, `tests/unit/agent/` | `feature/core-agent` |
| Member 2 | `src/repository/`, `tests/unit/repository/` | `feature/repository-context` |
| Member 3 | `src/impact/`, `tests/unit/impact/` | `feature/impactlens` |
| Member 4 | `src/verification/`, `tests/unit/verification/` | `feature/testsheriff` |
| Member 5 | `src/extension/`, `src/webview/`, `tests/integration/` (with M1) | `feature/ui-diff` |

## Hard rules
1. **Never commit to `main`.** Work on a branch, open a small PR, get a review and green CI, then merge. Integrate daily.
2. **Before every edit:** check the current branch and `git status`. Never overwrite a teammate's uncommitted or unmerged work.
3. **Contracts:** import from `src/shared/contracts`. Never copy or redefine these types. A contract change goes in its own PR, updates every consumer and test, and is reviewed by all owners.
4. **Inspect, then plan, then code.** Before writing code, produce a read-only reconnaissance report and a phased plan listing the exact files.
5. **No invented APIs.** TrueForge, MCP SDK, Tree-sitter and similar calls must match the installed package's exports and type declarations. Cite the doc or `.d.ts` in the PR.
6. **No direct model-provider calls** (OpenAI, Gemini, Anthropic…). All model use goes through TrueForge. CI enforces this.
7. **No disk writes without hunk approval.** Only `src/edits/` writes workspace files, and only accepted hunks after a hash check. `propose` never writes.
8. **Path safety:** workspace-relative POSIX paths only. Reject traversal, absolute paths, symlink escapes, `.git`, `node_modules` and `.env`/credential files.
9. **Commands:** only allowlisted runners (pytest first), as argument arrays, with workspace cwd, timeout, output cap and the approval policy.
10. **Honesty:** never report a test as passed unless it actually ran. Unknown values are `null`; inferred relationships are marked `inferred`; partial analysis sets `incomplete` and adds a warning.
11. **Secrets:** never commit or log keys, tokens or environment values. Errors shown to users go through `toSafeError`.
12. **Dependencies:** add packages with `npm install` so `package-lock.json` records the real version. No second package manager.
13. **Evidence:** every PR lists the exact commands run and their real output.

## Commands
```bash
npm install
npm run compile
npm test
```
Press F5 in VS Code to run the Extension Development Host.
