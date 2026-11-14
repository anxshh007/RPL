import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import {
  centralWorkflowOrchestrator,
  MaxRepairLoopExceededError,
} from "../../../src/agent/orchestrator-integration.ts";

const FIXTURE_ROOT = path.resolve("tests/fixtures/sample-flask-repo");

test("orchestrator: blocks execution when developer approval is absent", async () => {
  const proposal = {
    proposalId: "prop-unapproved-1",
    description: "Refactor debug flag",
    changedFiles: ["src/flask/cli.py"],
    diff: "- default=False\n+ default=True",
    proposedBy: "RepoPilot",
  };

  const unapproved = {
    proposalId: "prop-unapproved-1",
    approved: false, // Rejected / not approved
    reviewedBy: "Developer",
    approvedAt: new Date().toISOString(),
  };

  const outcome = await centralWorkflowOrchestrator.processApprovedChanges(
    proposal,
    unapproved,
    undefined,
    FIXTURE_ROOT
  );

  assert.equal(outcome.isApproved, false);
  assert.equal(outcome.authorizedForExecution, false);
  assert.equal(outcome.report.status, "not_run");
  assert.ok(outcome.report.limitations.some((l) => l.includes("Human approval gate")));
});

test("orchestrator: executes verification when developer grants approval", async () => {
  process.env.TESTSHERIFF_MOCK_OUTPUT = "2 passed in 0.05s";
  process.env.TESTSHERIFF_MOCK_EXITCODE = "0";

  try {
    const proposal = {
      proposalId: "prop-approved-2",
      description: "Fix CLI helper",
      changedFiles: ["src/flask/cli.py"],
      diff: "...",
      proposedBy: "RepoPilot",
    };

    const approval = {
      proposalId: "prop-approved-2",
      approved: true,
      reviewedBy: "SeniorDev",
      approvedAt: new Date().toISOString(),
    };

    const outcome = await centralWorkflowOrchestrator.processApprovedChanges(
      proposal,
      approval,
      undefined,
      FIXTURE_ROOT
    );

    assert.equal(outcome.isApproved, true);
    assert.equal(outcome.authorizedForExecution, true);
    assert.equal(outcome.report.status, "passed");
    assert.ok(outcome.nextStepRecommendation.includes("Verification succeeded"));
  } finally {
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
  }
});

test("orchestrator: strictly limits auto-repair iterations to prevent infinite loops", async () => {
  const proposal = {
    proposalId: "prop-loop-3",
    description: "Recursive failure fix",
    changedFiles: ["src/flask/cli.py"],
    diff: "...",
    proposedBy: "RepoPilot",
  };

  const approval = {
    proposalId: "prop-loop-3",
    approved: true,
    reviewedBy: "Developer",
    approvedAt: new Date().toISOString(),
  };

  process.env.TESTSHERIFF_MOCK_OUTPUT = "1 failed in 0.05s";
  process.env.TESTSHERIFF_MOCK_EXITCODE = "1";

  try {
    // Iteration 1
    await centralWorkflowOrchestrator.processApprovedChanges(proposal, approval, undefined, FIXTURE_ROOT);
    // Iteration 2
    await centralWorkflowOrchestrator.processApprovedChanges(proposal, approval, undefined, FIXTURE_ROOT);

    // Iteration 3 should throw MaxRepairLoopExceededError
    await assert.rejects(
      () => centralWorkflowOrchestrator.processApprovedChanges(proposal, approval, undefined, FIXTURE_ROOT),
      (err: unknown) => {
        assert.ok(err instanceof MaxRepairLoopExceededError);
        assert.ok((err as Error).message.includes("Repair loop limit reached (2 iterations)"));
        return true;
      }
    );

    // After resetting iterations, proposal can be processed again
    centralWorkflowOrchestrator.resetIterations("prop-loop-3");
    const resetOutcome = await centralWorkflowOrchestrator.processApprovedChanges(
      proposal,
      approval,
      undefined,
      FIXTURE_ROOT
    );
    assert.equal(resetOutcome.iterationCount, 1);
  } finally {
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
  }
});

test("orchestrator: blocks execution when approval is undefined or has mismatched proposalId", async () => {
  const proposal = {
    proposalId: "prop-mismatch-test",
    description: "Refactor",
    changedFiles: ["src/flask/cli.py"],
    diff: "...",
    proposedBy: "RepoPilot",
  };

  // Case A: approval is undefined
  const outcomeUndefined = await centralWorkflowOrchestrator.processApprovedChanges(
    proposal,
    undefined as any,
    undefined,
    FIXTURE_ROOT
  );
  assert.equal(outcomeUndefined.isApproved, false);
  assert.equal(outcomeUndefined.authorizedForExecution, false);
  assert.equal(outcomeUndefined.report.status, "not_run");
  assert.equal(outcomeUndefined.report.commandLabel, "execution-blocked-by-human-gate");

  // Case B: mismatched proposalId
  const mismatchedApproval = {
    proposalId: "different-proposal-id",
    approved: true,
    reviewedBy: "Developer",
    approvedAt: new Date().toISOString(),
  };
  const outcomeMismatch = await centralWorkflowOrchestrator.processApprovedChanges(
    proposal,
    mismatchedApproval,
    undefined,
    FIXTURE_ROOT
  );
  assert.equal(outcomeMismatch.isApproved, false);
  assert.equal(outcomeMismatch.authorizedForExecution, false);
  assert.equal(outcomeMismatch.report.status, "not_run");
  assert.ok(outcomeMismatch.nextStepRecommendation.includes("Submit diff for human developer review"));
});

test("orchestrator: recommendations reflect execution outcomes", async () => {
  const proposal = {
    proposalId: "prop-timeout-recommendation",
    description: "Slow test",
    changedFiles: ["src/flask/cli.py"],
    diff: "...",
    proposedBy: "RepoPilot",
  };

  const approval = {
    proposalId: "prop-timeout-recommendation",
    approved: true,
    reviewedBy: "Dev",
    approvedAt: new Date().toISOString(),
  };

  // Set timeout mock
  process.env.TESTSHERIFF_MOCK_TIMEDOUT = "1";
  process.env.TESTSHERIFF_MOCK_EXITCODE = "124";
  process.env.TESTSHERIFF_MOCK_OUTPUT = "Running long tests...";

  try {
    const outcome = await centralWorkflowOrchestrator.processApprovedChanges(
      proposal,
      approval,
      undefined,
      FIXTURE_ROOT
    );
    assert.equal(outcome.report.status, "timed_out");
    assert.ok(outcome.nextStepRecommendation.includes("Execution timed out"));
  } finally {
    delete process.env.TESTSHERIFF_MOCK_TIMEDOUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
  }
});

