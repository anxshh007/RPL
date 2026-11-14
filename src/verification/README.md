# TestSheriff (Layer 3) — Automated Test Discovery & Verification

TestSheriff is Layer 3 of RepoPilot AI. It verifies approved code changes by discovering existing pytest configurations, selecting relevant tests, executing them in a controlled child process, and returning a truthful, structured `VerificationReport` to the central agent.

## Architecture

```
Layer 1: Central Agent (proposes diff, human approves)
                │
                ▼
Layer 2: ImpactLens (dependency graph, candidate tests)
                │
                ▼
Layer 3: TestSheriff (executes pytest, parses actual results)
                │
                ▼
Layer 4: VS Code UI (presents VerificationReport)
```

## Security & Execution Model

1. **Restricted Child Process Execution**: Tests run using direct child process execution (`shell: false`) with strict argument arrays. Arbitrary shell strings and commands like `python -c` are rejected.
2. **Exact Command Shape**: TestSheriff allows only:
   ```bash
   python -m pytest <validated test paths> -q -p no:cacheprovider
   ```
   with environment `PYTHONDONTWRITEBYTECODE=1`.
3. **No File Mutation**: TestSheriff never edits source code, test files, lockfiles, or configurations. It operates strictly in verification mode.
4. **No Package Installation**: TestSheriff never runs `pip install` or `npm install`. Missing runners are reported as `runner: 'none'` with honest limitations.
5. **Path Containment**: All test file paths are validated against the workspace root to prevent directory traversal or access to protected directories (`.git`, `node_modules`, `.env`).
6. **Process Tree Termination**: Child processes are constrained by `timeoutMs` (default 120,000ms / 2 minutes) and killed via process tree termination on Windows (`taskkill`) and POSIX (`SIGKILL`).
7. **Secret Redaction**: API keys, bearer tokens, private keys, and connection passwords are sanitized from stdout/stderr.
8. **In-Memory Reports**: Reports are stored in memory for MCP queries; no report files are written to disk.

## Test Selection Priorities

1. **Explicit Tests**: Tests explicitly requested by the user or agent (`source: 'explicit'`).
2. **ImpactLens Candidates**: Candidates predicted by ImpactLens (`source: 'impact'`), prioritizing high and medium confidence.
3. **Conventional Match**: Name mapping between source and test files (`source: 'convention'`, e.g., `src/flask/cli.py` $\leftrightarrow$ `tests/test_cli.py`).
4. **Configuration Fallback**: Fallback to discovered test directory when no specific mapping exists (`source: 'configuration'`).

## Contract Invariants

- Unknown counts are represented as `null`, never guessed as `0`.
- If parsing fails or pytest crashes, `parsingComplete` is `false`.
- Failures include grounded exception classification in the `message` field.
