/**
 * MCP TestSheriff Tool Definitions & Execution Handlers
 * Exposes approved test operations to Member 1's shared MCP infrastructure.
 * Enforces input validation, workspace scoping, and truthful reporting.
 */

import { verificationService } from "../verification-service.ts";
import { validateSafePath } from "../../shared/utils/path-validator.ts";
import type {
  McpToolDefinition,
  McpToolResponse,
  RunTestsInput,
  GetTestResultsInput,
  DiscoverTestsInput,
  DiscoverTestsOutput,
} from "../../shared/types/mcp.ts";
import type { VerificationReport } from "../../shared/types/verification.ts";

/**
 * Proposed MCP tool schemas for registration with Member 1
 */
export const TEST_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "run_tests",
    description: "Safely runs relevant tests for approved changed files using an allowlisted test runner (pytest for Flask). Returns a structured VerificationReport.",
    inputSchema: {
      type: "object",
      properties: {
        requestId: { type: "string", description: "Unique identifier for this verification request" },
        workspaceRoot: { type: "string", description: "Absolute path to the workspace root directory" },
        changedFiles: {
          type: "array",
          items: { type: "string" },
          description: "List of files modified by the approved changes",
        },
        candidateTests: {
          type: "array",
          description: "Optional list of test candidates suggested by ImpactLens",
        },
        timeoutMs: { type: "number", description: "Optional execution timeout in milliseconds (max 300000)" },
      },
      required: ["requestId", "workspaceRoot", "changedFiles"],
    },
  },
  {
    name: "get_test_results",
    description: "Retrieves the verification report for a previously executed test run by requestId.",
    inputSchema: {
      type: "object",
      properties: {
        requestId: { type: "string", description: "Request ID of the test run to query" },
      },
      required: ["requestId"],
    },
  },
  {
    name: "discover_tests",
    description: "Discovers existing test configurations and candidate tests for changed files without executing them.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: { type: "string", description: "Absolute path to workspace root" },
        changedFiles: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of changed files",
        },
      },
      required: ["workspaceRoot"],
    },
  },
];

/**
 * MCP Tool Handler for `run_tests`
 */
export async function handleRunTests(
  input: RunTestsInput,
  signal?: AbortSignal
): Promise<McpToolResponse<VerificationReport>> {
  try {
    if (!input || !input.requestId || !input.workspaceRoot || !Array.isArray(input.changedFiles)) {
      return {
        success: false,
        error: {
          code: "INVALID_ARGUMENTS",
          message: "run_tests requires requestId, workspaceRoot, and changedFiles array",
        },
      };
    }

    const report = await verificationService.verifyChanges(input, signal);
    return {
      success: report.status !== "error",
      data: report,
    };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "INTERNAL_VERIFICATION_ERROR",
        message: (err as Error).message,
      },
    };
  }
}

/**
 * MCP Tool Handler for `get_test_results`
 */
export async function handleGetTestResults(
  input: GetTestResultsInput
): Promise<McpToolResponse<VerificationReport>> {
  try {
    if (!input || !input.requestId) {
      return {
        success: false,
        error: {
          code: "INVALID_ARGUMENTS",
          message: "get_test_results requires a valid requestId",
        },
      };
    }

    const report = verificationService.getReport(input.requestId);
    if (!report) {
      return {
        success: false,
        error: {
          code: "REPORT_NOT_FOUND",
          message: `No verification report found for requestId "${input.requestId}"`,
        },
      };
    }

    return {
      success: true,
      data: report,
    };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: (err as Error).message,
      },
    };
  }
}

/**
 * MCP Tool Handler for `discover_tests`
 */
export async function handleDiscoverTests(
  input: DiscoverTestsInput
): Promise<McpToolResponse<DiscoverTestsOutput>> {
  try {
    if (!input || !input.workspaceRoot) {
      return {
        success: false,
        error: {
          code: "INVALID_ARGUMENTS",
          message: "discover_tests requires workspaceRoot",
        },
      };
    }

    const safeRoot = validateSafePath(input.workspaceRoot, input.workspaceRoot);
    const { discovery, selection } = await verificationService.discoverAndSelect(
      safeRoot,
      input.changedFiles || [],
      (input.candidateTests as any) || []
    );

    return {
      success: true,
      data: {
        workspaceRoot: safeRoot,
        runner: discovery.runner,
        detectedConfigs: discovery.detectedConfigs,
        candidateTests: selection.candidates,
        selectedTests: selection.selectedTests,
        summary: `Discovered ${discovery.testFiles.length} tests in ${discovery.testDirectories.join(", ") || "workspace"}. Selected ${selection.selectedTests.length} tests.`,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "DISCOVERY_ERROR",
        message: (err as Error).message,
      },
    };
  }
}

/**
 * General MCP Tool Dispatcher for Member 1 integration
 */
export async function dispatchMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<McpToolResponse> {
  switch (toolName) {
    case "run_tests":
      return handleRunTests(args as unknown as RunTestsInput, signal);
    case "get_test_results":
      return handleGetTestResults(args as unknown as GetTestResultsInput);
    case "discover_tests":
      return handleDiscoverTests(args as unknown as DiscoverTestsInput);
    default:
      return {
        success: false,
        error: {
          code: "UNKNOWN_TOOL",
          message: `TestSheriff MCP tool "${toolName}" is not recognized.`,
        },
      };
  }
}
