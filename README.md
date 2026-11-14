# RepoPilot AI

An impact-aware coding agent for VS Code: it plans changes with one central TrueForge agent, shows the predicted impact (**ImpactLens**) before editing, lets you accept or reject each hunk, and runs the relevant tests afterwards (**TestSheriff**).

> Status: **integration scaffold.** Every module is a working stub behind its shared interface, so the pipeline runs end to end and each member replaces only their own stub.

## Layout

```
src/shared/contracts/   shared types, events, service interfaces, webview protocol   (Angshuman)
src/agent/              orchestrator + composition root createRepoPilot()          (Astha)
src/mcp/                MCP tool registration, canonical tool names                 (Astha)
src/edits/              propose / hunk apply / undo — only writer of workspace files (Astha)
src/repository/         scan, search, symbols, imports, context ranking & budget   (Aditya)
src/impact/             ImpactLens dependency graph & explainable risk            (Angshuman)
src/verification/       TestSheriff discovery, safe pytest runs, parsing          (Tushar)
src/extension/          VS Code activation, commands, webview bridge               (Supryio)
src/webview/            React + Vite panel (added by Member 5)                    (Supryio)
tests/unit/<module>/    unit tests per owner
docs/briefs/            the five member briefs
docs/DECISIONS.md       resolved conflicts between the briefs — read before coding
AGENTS.md               rules for humans and Antigravity
```

## Run

```bash
npm install
npm run compile
npm test
```

Then press **F5**. In the new window:
- **RepoPilot: Open Panel** opens the panel.
- Select code and press **Ctrl+Shift+Alt+E** (Cmd+Shift+Alt+E on Mac) for an inline edit.

## Workflow
Branch from `main` and open a small PR. CI must be green (compile, tests, and a check for direct model-provider calls) and the code owners must approve before merging. See `AGENTS.md`.
