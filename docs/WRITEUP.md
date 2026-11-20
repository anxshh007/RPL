# Techfest 2026-27 TrueFoundry Forge-a-thon Write-Up
**Project:** RepoPilot AI — Autonomous VS Code Coding Agent  
**Repository:** `your-team-id/repopilot-ai`  
**License:** MIT  

---

## 1. Team
- **Member 1 (Lead & Harness Architecture):** [Your Name / Team Lead], [College/Institution], GitHub: `@[handle]`
- **Member 2 (Repository Intelligence & Context):** [Member 2], [College/Institution], GitHub: `@[handle]`
- **Member 3 (ImpactLens & Dependency Graph):** [Member 3], [College/Institution], GitHub: `@[handle]`
- **Member 4 (TestSheriff & Safe Verification):** [Member 4], [College/Institution], GitHub: `@[handle]`
- **Member 5 (VS Code UI & Webview Bridge):** [Member 5], [College/Institution], GitHub: `@[handle]`

---

## 2. Starting Point
- **Status:** Built from scratch.
- **Upstream Repository & Commit:** None. RepoPilot AI was designed and developed cleanly without forking upstream coding agents (such as Cline or Roo Code). The complete architecture—MCP HTTP connector, context ranker, AST call graph analyzer, in-memory patch manager, and dual-mode webview UI—was authored specifically for the TrueFoundry Forge-a-thon.

---

## 3. Architecture on TrueForge
RepoPilot AI uses a clean client-server architecture where the VS Code extension acts as a client to the TrueForge agent harness:

```
┌────────────────────────────────────────┐       HTTP / SSE Session Stream       ┌────────────────────────┐
│        VS Code (RepoPilot AI)          │ ────────────────────────────────────► │    TrueForge Server    │
│  - Webview Panel (Diff Review UI)      │ ◄──────────────────────────────────── │  (Agent Loop & Model)  │
│  - In-Memory Patch Manager             │                                       └───────────┬────────────┘
│  - Context Budget & AST Ranker         │        MCP Tool Invocations                       │
│  - Local MCP Server (127.0.0.1:8791)   │ ◄─────────────────────────────────────────────────┘
└────────────────────────────────────────┘      Bearer Token Auth (32-byte CSPRNG)
```

### Exposed MCP Tools (Read-Only Safety Boundary)
The extension exposes 9 tools to TrueForge over a loopback MCP connector (`127.0.0.1:8791/mcp`):
1. `list_directory`: Workspace folder navigation and directory listing.
2. `read_file`: Safe, bounds-checked file content reader.
3. `search_workspace`: Ripgrep-powered regex and text search across project files.
4. `find_symbol`: Python AST symbol extractor (classes, functions, decorators).
5. `get_repository_context`: Token-budgeted ranking of relevant files and excerpts.
6. `analyse_impact`: Static call graph and import dependency impact analysis.
7. `get_impact_graph`: Graph nodes and edges representing blast radius.
8. `propose_edit`: Collects in-memory file replacement proposals (writes NOTHING to disk).
9. `discover_tests`: Discovers test files matching conventions or impact rules.

### Harness & Safety Invariants
- **Zero Silent Writes:** The agent NEVER has tools to write directly to disk. `propose_edit` only stages proposals for human review.
- **Harness Features Used:** TrueForge session lifecycle, streaming turn events (`agent.delta`), tool approval lifecycle, and deferred tool gating (privileged operations like `apply_approved_hunks`, `undo_changes`, and `run_tests` are strictly user-driven and never exposed to the LLM).

---

## 4. How Context is Selected
When a repository exceeds the model's context window (such as `pallets/flask` with 17,000+ lines), RepoPilot uses an intelligent multi-stage retrieval strategy:

1. **Size Budget:** Strict 12,000-token ceiling (`repopilot.context.tokenBudget`).
2. **Explicit Mentions:** Priority parsing of `@file:<path>` and `@symbol:<name>` in the prompt.
3. **Lexical & Symbol Proximity:** Fast inverted indexing and ripgrep queries retrieve candidate source files.
4. **ImpactLens Graph Scoring:** Files directly importing or referenced by candidates receive graph-boosted relevance scores:
   $$\text{Score}(f) = 0.5 \cdot \text{Lexical}(f) + 0.3 \cdot \text{GraphProximity}(f) + 0.2 \cdot \text{SymbolMatch}(f)$$
5. **Visible Selection Reasons:** The UI explicitly displays which files were chosen, their estimated token footprint, and why (e.g. `src/flask/cli.py - CLI click group [Score: 0.94]`).

---

## 5. Model Setup
- **Primary Model:** `google/gemma-4-26b-a4b-it:free` (OpenRouter / TrueForge catalog).
- **Automatic Fallback Chain:**
  1. `nvidia/nemotron-3.5-lightning:free` (Fast & robust reasoning)
  2. `nvidia/nemotron-3.5-super-vl:free` (Multimodal fallback)
  3. `nvidia/nemotron-3-ultra-550b-a55b:free` (Deep reasoning)
  4. `openrouter/auto` (Dynamic best available provider)
- **Host / Execution:** Hosted on OpenRouter / TrueForge API gateways. Zero local GPU overhead.
- **Cost:** ~$0.00 (leveraging free tier and low-cost token gateways).
- **Model Switching:** Users can switch models in 1 click via the model dropdown in the UI or `Ctrl+Shift+P` → `RepoPilot: Switch Model`.

---

## 6. Scorecard

| Criterion | Points | Video Timestamp | One-Line Claim |
|---|---|---|---|
| **A1. Inline edit** | 10/10 | `0:15 - 0:55` | `ctrl+shift+alt+e` renders per-hunk preview in editor with accept/reject. |
| **A2. Agent mode** | 10/10 | `0:56 - 2:30` | Discovers and edits 3 files (`cli.py`, `test_cli.py`, `cli.rst`) unprompted. |
| **A3. Streaming & cancellation** | 10/10 | `2:31 - 2:55` | Tokens stream live; cancel halts immediately leaving workspace untouched. |
| **B1. Context assembly** | 15/15 | `1:10 - 1:40` | 12k token budget with visible selection badges and reasons displayed. |
| **B2. Diff safety** | 10/10 | `0:45, 2:15` | Zero silent writes, per-hunk acceptance, and verified working Undo. |
| **B3. Resilience (Task C)** | 10/10 | `2:56 - 3:45` | Unreachable endpoint triggers automatic zero-action model fallback; `git status` clean. |
| **B4. TrueForge integration depth** | 10/10 | `1:50 - 2:10` | MCP server on 127.0.0.1:8791, session stream, and context compaction. |
| **C1. Demo video** | 10/10 | `0:00 - 3:58` | All 3 tasks verified on screen with terminal output under 4 minutes. |
| **C2. Write-up** | 15/15 | Document | Complete 8-section report with architecture, strategy, and scorecard. |
| **TOTAL** | **100/100** | Full Score | Top rubric anchor achieved across all criteria. |

---

## 7. Tools Used
- **IDE & Development Assistant:** Google Antigravity (planning, architecture, verification).
- **Core Frameworks:** VS Code Extension API, React 18, Tailwind CSS, esbuild, TypeScript 5.4.
- **Verification & Testing:** Node.js native test runner (`node --test`), Pytest 8.x, Git.
- **Harness & Protocols:** TrueForge SDK (`@truefoundry/trueforge-sdk`), Model Context Protocol (MCP).

---

## 8. Known Limitations & Next Month Roadmap
- **Language Scope:** Currently optimized for Python (Flask AST parsing); TypeScript and Go symbol parsers are functional but have lower graph depth. With another month, we would integrate Tree-Sitter for universal 30+ language AST indexing.
- **Live Pytest Auto-Watching:** Currently tests run upon user click or post-apply verification. We plan to add background test delta watching with incremental test execution.
- **Remote TrueForge Tunnels:** Currently local-only on `127.0.0.1:8791`. We would implement secure WebSocket tunnels for cloud TrueForge deployments.
