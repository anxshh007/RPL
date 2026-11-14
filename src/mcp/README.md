# src/mcp — MCP tool layer (Member 1)

- Registers every tool in `tool-names.ts` with the official MCP TypeScript SDK.
- Handlers live with their owners (`src/repository/tools.ts`, `src/impact/tools.ts`, `src/verification/tools.ts`, `src/edits/tools.ts`) and are imported here.
- Every handler: validates input (Zod), keeps paths inside the workspace, enforces size/time limits, returns structured errors, redacts secrets.
- `apply_approved_hunks` and `undo_changes` are only reachable after explicit hunk decisions from the user. `run_tests` follows the approval policy in docs/DECISIONS.md.
- Do not write TrueForge/MCP calls from memory. Check the installed package's exports and type declarations first, and record versions in `package-lock.json`.
