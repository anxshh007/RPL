# RepoPilot AI

**Editor-Native Autonomous Coding Agent on TrueForge**  
*Built for the Techfest 2026-27 TrueFoundry Forge-a-thon (IIT Bombay)*

RepoPilot AI is an impact-aware, editor-native coding agent for VS Code. It plans multi-file changes with one central TrueForge agent harness, computes predicted blast radius (**ImpactLens**) before editing, lets you review and accept/reject diffs hunk-by-hunk with zero silent writes, and executes verification tests (**TestSheriff**) post-apply.

---

## Declared Starting Point
- **Origin:** Built from scratch.
- **Upstream Repository & Commit:** None (clean architecture developed for the TrueFoundry Forge-a-thon).

---

## Setup From a Clean Clone

### Prerequisites
- Node.js LTS (v20+)
- Python 3.10+ (with `pytest` installed for verification tasks)
- VS Code 1.85+

### Installation & Build
```bash
git clone https://github.com/your-team-id/repopilot-ai.git
cd repopilot-ai
npm install
npm run compile
npm test
```
All 405 unit tests across 18 test suites will pass cleanly.

---

## Running with TrueForge (Local Mode)

1. **Start TrueForge locally:**
   ```bash
   npx @truefoundry/trueforge@latest
   ```
   Note the running URL (e.g. `http://127.0.0.1:8000`).

2. **Configure VS Code:**
   Open VS Code Settings (`Ctrl+,`):
   - `repopilot.trueforge.baseUrl`: Set to your TrueForge URL (e.g. `http://127.0.0.1:8000`).
   - `repopilot.trueforge.model`: Your configured model (e.g. `openai/gpt-4o`, `anthropic/claude-3-5-sonnet`, or OpenRouter model).

3. **Register RepoPilot MCP Connector:**
   - In VS Code, run `Ctrl+Shift+P` → **RepoPilot: Show TrueForge Connector Setup**.
   - Copy the local URL (`http://127.0.0.1:8791/mcp`) and Bearer token.
   - In TrueForge → Settings → Connectors, add a new remote MCP server named `repopilot` with header `Authorization: Bearer <token>`.

---

## Running with OpenRouter (Direct Fallback Mode)

RepoPilot AI includes an automatic failover engine that operates without a running TrueForge server:
- **Default Primary Model:** `google/gemma-4-26b-a4b-it:free`
- **Fallback Chain:**
  1. `nvidia/nemotron-3.5-lightning:free`
  2. `nvidia/nemotron-3.5-super-vl:free`
  3. `nvidia/nemotron-3-ultra-550b-a55b:free`
  4. `openrouter/auto`
- Configure in settings or run `Ctrl+Shift+P` → **RepoPilot: Switch Model**.

---

## Fixed Competition Tasks

Demonstrate the three benchmark tasks on `pallets/flask` (tag `3.1.3`):
```bash
git clone https://github.com/pallets/flask.git
cd flask
git checkout 3.1.3
```

- **Task A (Inline Edit):** Open `src/flask/helpers.py`, select `get_debug_flag`, press `Ctrl+Shift+Alt+E`, and instruct:
  > *"Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false."*
  Verify: `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` -> outputs `False`.

- **Task B (Agent Mode):** Open RepoPilot Panel, with no files named, instruct:
  > *"Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands."*
  Verify: `pytest tests/test_cli.py -q` passes; `flask config` prints masked JSON; touches 3+ files (`src/flask/cli.py`, `tests/test_cli.py`, `docs/cli.rst`).

- **Task C (Resilience):** Provide an invalid key or unreachable endpoint, repeat Task A.
  Verify: Automatic fallback model takes over without user action; `git status` shows 0 modified files.

---

## Documentation
- [Write-Up (Competition PDF)](docs/WRITEUP.md)
- [4-Minute Demo Video Script](docs/DEMO_VIDEO_SCRIPT.md)
- [TrueForge Setup Guide](docs/member1/TRUEFORGE_SETUP.md)
- [Design Decisions](docs/DECISIONS.md)
