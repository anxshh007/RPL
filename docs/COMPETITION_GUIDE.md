# RepoPilot AI — Competition Verification & Collaboration Guide
**Member 4: Automated Verification (TestSheriff)**

---

## 1. Member Responsibilities Matrix

| Team Member | Role | Contract With TestSheriff |
|---|---|---|
| **Member 1** | Central Agent & MCP | Registers `run_tests`, `get_test_results`, `discover_tests` into TrueForge / MCP server. Receives `VerificationReport`. |
| **Member 2** | Repo Intelligence | Provides workspace file list and path normalisation. |
| **Member 3** | ImpactLens | Supplies `candidateTests` with confidence levels as Priority 2 inputs. |
| **Member 4** | TestSheriff (This Module) | Discovers tests, executes allowlisted runners, analyzes failures truthfully, returns `VerificationReport`. |
| **Member 5** | UI Presentation | Mounts `verification-dashboard.html` and maps reports to 10 UI states via `ui-state-adapter.ts`. |

---

## 2. Flask Challenge Walkthrough

### Scenario A — Inline Edit (`get_debug_flag`)
1. Developer approves change to `src/flask/cli.py`.
2. TestSheriff identifies `tests/test_cli.py` via conventional mapping.
3. Command executed: `python -m pytest tests/test_cli.py -q`.
4. Output parsed: 2 passed, 0 failed.
5. Report returned with `status: passed` and limitation note disclosing targeted subset execution.

### Scenario B — Multi-File Flask Config Command
1. Developer approves changes to `src/flask/cli.py`, `src/flask/helper.py`, and `docs/index.md`.
2. TestSheriff discovers test files via conventional mapping and static import scanning (`test_unconventionally_named.py`).
3. Targeted test suite executed.
4. Report returned with `status: passed`.
5. Crucial competition rule maintained: TestSheriff **does not** claim `docs/index.md` was verified by unit tests, explicitly noting targeted execution boundaries in `limitations`.

### Scenario C — Resilience & Non-Modification
1. Agent failure before approved edits: TestSheriff refuses to run (`status: not_run`).
2. Execution timeout: Process tree forcefully terminated via `taskkill /F /T /PID` (`status: timed_out`, exit code 124).
3. Zero mutations: SHA-256 integrity verified across all files before and after execution.

---

## 3. Benchmark Reproduction

Run the competition benchmark runner at any time:
```bash
npm run benchmark
```
Expected output:
- Scenario A: PASSED (2/2)
- Scenario B: PASSED (4/4) with documentation boundary maintained
- Scenario C: VERIFIED (0 mutations, timeout exit code 124, unapproved blocked)
