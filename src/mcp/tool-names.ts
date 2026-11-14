/**
 * OWNER: Member 1. Canonical MCP tool names (project names, NOT TrueForge SDK APIs).
 * Handlers are implemented by each module owner in <module>/tools.ts and registered
 * here by Member 1 (docs/DECISIONS.md D-07).
 */
export const TOOL_NAMES = {
  // Member 2 — read-only
  searchWorkspace: 'search_workspace',
  readFile: 'read_file',
  findSymbol: 'find_symbol',
  getRepositoryContext: 'get_repository_context',
  // Member 3 — read-only
  analyseImpact: 'analyse_impact',
  getImpactGraph: 'get_impact_graph',
  // Member 1 — proposal is diff-only; apply/undo need user hunk approval
  proposeEdit: 'propose_edit',
  applyApprovedHunks: 'apply_approved_hunks',
  undoChanges: 'undo_changes',
  // Member 4 — allowlisted runners only
  discoverTests: 'discover_tests',
  runTests: 'run_tests',
  getTestResults: 'get_test_results',
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

/** Tools the model may call without a human approval gate. */
export const READ_ONLY_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  TOOL_NAMES.searchWorkspace,
  TOOL_NAMES.readFile,
  TOOL_NAMES.findSymbol,
  TOOL_NAMES.getRepositoryContext,
  TOOL_NAMES.analyseImpact,
  TOOL_NAMES.getImpactGraph,
  TOOL_NAMES.proposeEdit,
  TOOL_NAMES.discoverTests,
  TOOL_NAMES.getTestResults,
]);
