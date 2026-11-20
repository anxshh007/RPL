# 4-Minute Demo Video Recording Script & Checklist
**Event:** Techfest 2026-27 TrueFoundry Forge-a-thon (IIT Bombay)  
**Maximum Duration:** 4 minutes (240 seconds)  
**Target Score:** 10/10 for Video, 100/100 Total  

---

## Pre-Recording Checklist
1. Pinned repository: `pallets/flask` checked out at tag `3.1.3` (`git checkout 3.1.3`).
2. VS Code open with `pallets/flask` workspace folder.
3. Split view: VS Code editor on the left (or top), RepoPilot AI Panel on the right (or side).
4. Terminal open at the bottom of VS Code.
5. Keybinding verified: `Ctrl+Shift+Alt+E` triggers Inline Edit.

---

## Detailed Cue Sheet (Timeline)

### 0:00 - 0:15 | Intro & Architecture (15 sec)
- **Visual:** Show VS Code with Flask repository open, RepoPilot panel active.
- **Action:** Point out RepoPilot AI connected to TrueForge / OpenRouter with model indicator (`google/gemma-4-26b-a4b-it:free`).

---

### 0:15 - 0:55 | Task A: Inline Edit (40 sec)
- **Step 1 (0:15):** Open `src/flask/helpers.py`. Scroll to function `get_debug_flag`.
- **Step 2 (0:20):** Select the function and docstring. Press `Ctrl+Shift+Alt+E`.
- **Step 3 (0:25):** Input instruction:
  ```text
  Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.
  ```
- **Step 4 (0:35):** Show the proposed diff in the editor / Diff Review. Point out per-hunk preview. Click **Accept Hunk** (or Accept & Apply).
- **Step 5 (0:45) — On-Screen Verification:**
  In the terminal, run:
  ```bash
  FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"
  ```
  **Expected Output:** `False` clearly visible on screen.

---

### 0:56 - 2:30 | Task B: Agent Mode (Multi-File, None Named) (94 sec)
- **Step 1 (0:56):** Switch to RepoPilot Agent Panel. Do NOT name any files.
- **Step 2 (1:00):** Paste exact instruction:
  ```text
  Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.
  ```
- **Step 3 (1:15):** Point to **Context Assembly** in the UI:
  - Show files selected within the 12,000 token budget (`src/flask/cli.py`, `tests/test_cli.py`, `docs/cli.rst`) and their relevance scores.
- **Step 4 (1:35) — TrueForge Session View:**
  - Briefly switch tab / window to the TrueForge session dashboard showing the turn, tool calls (`read_file`, `propose_edit`), and stream.
- **Step 5 (1:55):** Return to VS Code. Show the proposed diff spanning **three files**:
  1. `src/flask/cli.py` (CLI command definition)
  2. `tests/test_cli.py` (test coverage)
  3. `docs/cli.rst` (documentation)
- **Step 6 (2:10):** Review hunks and click **Accept & Apply**.
- **Step 7 (2:18) — On-Screen Verification:**
  In the terminal, run:
  ```bash
  pytest tests/test_cli.py -q
  ```
  **Expected Output:** `... passed` (all tests passing).
  Then run the new command:
  ```bash
  flask --help
  flask config
  ```
  **Expected Output:** `config` appears in help, and JSON output with `***` masked keys appears on screen.

---

### 2:31 - 2:55 | Undo Demonstration & Cancellation (24 sec)
- **Step 1 (2:31):** In the RepoPilot panel, click **Undo Changes**.
- **Step 2 (2:40):** Run `git status` in terminal showing the workspace is completely restored.
- **Step 3 (2:45):** Type a long task, hit Submit, and immediately hit **Cancel**. Show editor remains responsive and zero partial edits remain.

---

### 2:56 - 3:55 | Task C: Resilience & Failover (59 sec)
- **Step 1 (2:56):** Break the configuration intentionally:
  - In VS Code Settings, set `repopilot.trueforge.baseUrl` to `http://invalid-endpoint:9999` or an invalid API key.
- **Step 2 (3:05):** Repeat Task A on `get_debug_flag` in `src/flask/helpers.py`.
- **Step 3 (3:15):** Show on screen:
  - The editor never hangs or freezes.
  - An automatic fallback banner appears:
    `"Rate limit / unreachable endpoint. Automatically switching to fallback model: nvidia/nemotron-3.5-lightning:free..."`
  - The second model completes the proposal cleanly with no user action.
- **Step 4 (3:40) — On-Screen Verification:**
  Run in terminal:
  ```bash
  git status
  ```
  **Expected Output:** `nothing to commit, working tree clean` (zero files changed before approval).

---

### 3:55 - 4:00 | Outro & Summary (5 sec)
- Conclude: "RepoPilot AI: Safe, editor-native, fully autonomous on TrueForge."
