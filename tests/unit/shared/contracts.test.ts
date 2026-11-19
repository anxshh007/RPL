// Honesty invariants every module must keep (owners: Lead + all members).
// Uses node:test until Member 1's PR installs Vitest; then migrate unchanged assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImpactAnalyser } from '../../../src/impact';
import { createVerificationService } from '../../../src/verification';
import { createRepositoryIntelligence } from '../../../src/repository';
import { createEditService } from '../../../src/edits';
import { isWebviewToHost, toSafeError, RepoPilotError } from '../../../src/shared/contracts';
import type { ChangeRequest } from '../../../src/shared/contracts';

const request: ChangeRequest = {
  requestId: 'req-1',
  instruction: 'add flask config command',
  mode: 'agent',
  explicitFileMentions: [],
  explicitSymbolMentions: [],
};

test('verification never reports unknown counts as 0 or a run as passed', async () => {
  const report = await createVerificationService().verify({ requestId: 'req-1', changedFiles: [], candidateTests: [] });
  assert.equal(report.status, 'not_run');
  assert.deepEqual(report.counts, { total: null, passed: null, failed: null, skipped: null, errors: null });
  assert.ok(report.limitations.length > 0);
});

test('impact stub is marked incomplete with a warning, collections are arrays', async () => {
  const ctx = await createRepositoryIntelligence().getContext(request);
  const report = await createImpactAnalyser().analyseImpact(request, ctx);
  assert.equal(report.summary.incomplete, true);
  assert.ok(report.warnings.length > 0);
  for (const key of ['affectedFiles', 'testCandidates', 'nodes', 'edges'] as const) {
    assert.ok(Array.isArray(report[key]));
  }
});

test('context respects the configured budget field', async () => {
  const ctx = await createRepositoryIntelligence(12000).getContext(request);
  assert.equal(ctx.tokenBudget, 12000);
  assert.equal(ctx.requestId, 'req-1');
});

test('edit service applies nothing without accepted hunks', async () => {
  // The real edit service needs an explicit workspace root (no process.cwd() fallback).
  const edits = createEditService(require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'repopilot-contracts-')));
  await edits.propose('req-1', 'x', [{ path: 'a.py', proposedContent: 'print(1)\n' }], []);
  const res = await edits.apply('req-1', [{ path: 'a.py', hunkId: 'h1', decision: 'reject' }]);
  assert.equal(res.status, 'nothing_to_apply');
  assert.deepEqual(res.appliedPaths, []);
});

test('webview messages are validated', () => {
  assert.equal(isWebviewToHost({ type: 'ui.submit', instruction: 'x', mode: 'agent' }), true);
  assert.equal(isWebviewToHost({ type: 'run.shell', cmd: 'rm -rf /' }), false);
  assert.equal(isWebviewToHost(null), false);
});

test('errors are converted to safe, classified messages', () => {
  assert.equal(toSafeError(new RepoPilotError('network', 'TrueForge unreachable', true)).kind, 'network');
  const leaked = toSafeError(new Error('API_KEY=sk-secret failed'));
  assert.equal(leaked.kind, 'internal');
  assert.ok(!leaked.message.includes('sk-secret'));
});
