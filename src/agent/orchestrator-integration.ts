/**
 * Central Agent Orchestration & Human-in-the-Loop Integration
 * Implements the 10-step verification workflow connecting RepoPilot (Member 1),
 * ImpactLens (Member 3), TestSheriff (Member 4), and UI (Member 5).
 * Strictly enforces human developer approval gates and limits auto-repair iterations.
 */

import { dispatchMcpTool } from "../verification/mcp/test-tools.ts";
import { mapReportToUIState, type UIStateView } from "../ui/ui-state-adapter.ts";
import type { VerificationReport, TestCandidate } from "../shared/types/verification.ts";
import type { ImpactReport } from "../shared/types/impact.ts";

export interface CodeChangeProposal {
  proposalId: string;
  description: string;
  changedFiles: string[];
  diff: string;
  proposedBy: string;
}

export interface DeveloperApproval {
  proposalId: string;
  approved: boolean;
  reviewedBy: string;
  approvedAt: string;
  notes?: string;
}

export interface VerificationWorkflowResult {
  proposalId: string;
  isApproved: boolean;
  authorizedForExecution: boolean;
  report: VerificationReport;
  uiView: UIStateView;
  nextStepRecommendation: string;
  iterationCount: number;
}

export class HumanApprovalRequiredError extends Error {
  constructor(proposalId: string) {
    super(`Cannot execute verification: Change proposal "${proposalId}" has not been approved by the developer.`);
    this.name = "HumanApprovalRequiredError";
  }
}

export class MaxRepairLoopExceededError extends Error {
  constructor(proposalId: string, maxIterations: number) {
    super(`Repair loop limit reached (${maxIterations} iterations) for proposal "${proposalId}". Escalate to human developer.`);
    this.name = "MaxRepairLoopExceededError";
  }
}

export class CentralWorkflowOrchestrator {
  private readonly MAX_REPAIR_ITERATIONS = 2;
  private readonly iterationCounters = new Map<string, number>();

  /**
   * Coordinates the 10-step verification lifecycle.
   */
  public async processApprovedChanges(
    proposal: CodeChangeProposal,
    approval: DeveloperApproval,
    impactReport?: ImpactReport,
    workspaceRoot: string = process.cwd()
  ): Promise<VerificationWorkflowResult> {
    const currentIteration = (this.iterationCounters.get(proposal.proposalId) || 0) + 1;
    this.iterationCounters.set(proposal.proposalId, currentIteration);

    // Rule: Never create an unlimited automatic repair loop
    if (currentIteration > this.MAX_REPAIR_ITERATIONS) {
      throw new MaxRepairLoopExceededError(proposal.proposalId, this.MAX_REPAIR_ITERATIONS);
    }

    // Step 2 Gate: Developer must review and approve the changes
    if (!approval || !approval.approved || approval.proposalId !== proposal.proposalId) {
      const blockedReport: VerificationReport = {
        requestId: `unapproved-${proposal.proposalId}`,
        status: "not_run",
        runner: "none",
        commandLabel: "execution-blocked-by-human-gate",
        selectedTests: [],
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        errors: 0,
        failures: [],
        outputSummary: "Execution blocked: Developer approval has not been granted for this code proposal.",
        outputTruncated: false,
        limitations: [
          "Human approval gate enforcement: Tests were not authorized to execute on unapproved source changes.",
        ],
      };

      return {
        proposalId: proposal.proposalId,
        isApproved: false,
        authorizedForExecution: false,
        report: blockedReport,
        uiView: mapReportToUIState(blockedReport),
        nextStepRecommendation: "Submit diff for human developer review and obtain approval before verification.",
        iterationCount: currentIteration,
      };
    }

    // Step 3 & 4: Merge ImpactLens candidates if available
    const candidateTests: TestCandidate[] = impactReport?.candidateTests || [];

    // Step 5 & 6: TestSheriff executes authorized tests through MCP
    const requestId = `req-${proposal.proposalId}-iter-${currentIteration}`;
    const mcpResponse = await dispatchMcpTool("run_tests", {
      requestId,
      workspaceRoot,
      changedFiles: proposal.changedFiles,
      candidateTests,
    });

    const report = mcpResponse.data as VerificationReport;
    const uiView = mapReportToUIState(report);

    // Step 9 & 10: RepoPilot explains verification outcome
    let nextStepRecommendation: string;
    if (report.status === "passed") {
      nextStepRecommendation = "Verification succeeded! All targeted tests passed. Ready for commit/merge.";
    } else if (report.status === "failed") {
      nextStepRecommendation = `Verification failed (${report.failed} failure). RepoPilot may propose a targeted diff correction, but it must be reviewed and approved by the developer.`;
    } else if (report.status === "timed_out") {
      nextStepRecommendation = "Execution timed out. Review long-running tests or increase timeout threshold.";
    } else {
      nextStepRecommendation = `Verification ended with status '${report.status}'. Inspect error tracebacks and environment dependencies.`;
    }

    return {
      proposalId: proposal.proposalId,
      isApproved: true,
      authorizedForExecution: true,
      report,
      uiView,
      nextStepRecommendation,
      iterationCount: currentIteration,
    };
  }

  /**
   * Resets iteration counter for a proposal.
   */
  public resetIterations(proposalId: string): void {
    this.iterationCounters.delete(proposalId);
  }
}

export const centralWorkflowOrchestrator = new CentralWorkflowOrchestrator();
