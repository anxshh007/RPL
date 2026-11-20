# Connecting RepoPilot to TrueForge

## How it works

TrueForge gives an agent tools only through **MCP servers registered on the TrueForge side**
(TrueForge → Settings → Connectors: a name, a URL and optional header auth). TrueForge then calls
those tools itself during a turn. (Source: the installed `@truefoundry/trueforge-sdk` reference and
type docs — `AgentSpec.mcpServers`, `RemoteMcpServerManifest`, `McpServerHeaderAuth`, `tool.response`.)

So RepoPilot runs a small MCP server inside VS Code — **the RepoPilot connector** — and TrueForge calls it:

```
VS Code (RepoPilot)                                TrueForge server
  submit request ──► session with RepoPilot's agent definition ──►  model plans
                                                                       │ calls tools
  http://127.0.0.1:8791/mcp  ◄── Authorization: Bearer <token> ────────┘
  (read_file, search_workspace, find_symbol, get_repository_context,
   analyse_impact, get_impact_graph, propose_edit, discover_tests, get_test_results)
  proposals ──► hunk review in the panel ──► you Apply / Undo
```

Safety of the connector:
- listens on **127.0.0.1 only**; it is never reachable from the network;
- needs the **bearer token** (random, 32 bytes, stored encrypted in VS Code's secret storage);
- refuses foreign `Host` headers (DNS rebinding), anything but `POST /mcp`, bodies over 1 MB;
- offers **only the 9 read-only tools**; `apply_approved_hunks`, `undo_changes` and `run_tests` are never callable;
- only answers while a RepoPilot request is planning, and only for that request; otherwise every call is refused;
- `propose_edit` writes nothing: proposals go to your hunk review.

**Requirement:** the TrueForge server must run **on the same computer** as VS Code, because the
connector is on 127.0.0.1. A cloud TrueForge cannot reach it (that would need a tunnel exposing your
code to the internet — a separate decision, not part of this change).

## One-time setup

1. **Start TrueForge** on this computer and note its URL (e.g. `http://127.0.0.1:<port>`).
2. **VS Code settings** (Ctrl+, → search "repopilot"):
   - `repopilot.trueforge.baseUrl` = the TrueForge URL
   - `repopilot.trueforge.model` = a model your TrueForge account can use, as `provider/model`
     (TrueForge's models list shows them)
   - leave `repopilot.trueforge.connectorName` = `repopilot` and `repopilot.mcp.port` = `8791`
     unless 8791 is taken
3. **API key** (if your TrueForge needs one): Ctrl+Shift+P → **RepoPilot: Set TrueForge API Key**.
4. **Reload** the window when asked. The RepoPilot output channel shows
   `RepoPilot MCP connector listening at http://127.0.0.1:8791/mcp`.
5. **Register the connector in TrueForge:** Ctrl+Shift+P → **RepoPilot: Show TrueForge Connector Setup**, then in
   TrueForge → Settings → Connectors add a **remote MCP server**:
   - Name: `repopilot`
   - URL: use **Copy URL**
   - Auth: header, name `Authorization`, value: use **Copy header value** (`Bearer …`)
6. In TrueForge, check that the connector lists the 9 tools.

## Checking it end to end

F5 → open `tests/fixtures/sample-flask-repo` → RepoPilot: Open Panel → send
`Add a format_error helper next to format_response in @file:src/flask/helper.py`. Expect:

1. starting → retrieving_context → analysing_impact → planning;
2. tool rows in the panel (read_file, propose_edit …) as TrueForge calls the connector;
3. **review_required** with the proposed hunk; nothing written yet;
4. Open diff → Apply → "Run the relevant tests now?" → Run tests → passed;
5. Undo restores the file.

Copy the RepoPilot output channel (event sequence) into the PR (AGENTS.md rule 13).

## If something goes wrong

| Symptom | Likely cause |
|---|---|
| "TrueForge is not configured" | `repopilot.trueforge.baseUrl` is empty |
| "TrueForge server is unreachable" | wrong URL, or TrueForge not running |
| "TrueForge rejected the credentials" | API key missing/wrong: run *Set TrueForge API Key* |
| "could not find agent repopilot-core" | `repopilot.trueforge.model` is empty, so RepoPilot asked for a saved agent; set the model |
| No tool rows; the model says it has no tools | connector not registered in TrueForge, wrong name, or wrong token (TrueForge gets 401) |
| "connector could not start" | port 8791 in use: change `repopilot.mcp.port`, reload, update the URL in TrueForge |
| Tools answer "No RepoPilot request is planning" | normal outside a run; inside a run it means the request was cancelled |

New token: Ctrl+Shift+P → **RepoPilot: Create New Connector Token**, then update the header in TrueForge.
