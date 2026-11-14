// Lifecycle tests for the orchestrator skeleton (owner: Member 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepoPilot, RepoPilotController } from '../../../src/agent';
import { createImpactAnalyser } from '../../../src/impact';
import { createVerificationService } from '../../../src/verification';
import { createEditService } from '../../../src/edits';
import type { ChangeRequest, RepoPilotEvent, RepositoryIntelligence } from '../../../src/shared/contracts';
import { createRepositoryIntelligence } from '../../../src/repository';

const req = (id: string): ChangeRequest => ({
  requestId: id,
  instruction: 'test',
  mode: 'agent',
  explicitFileMentions: [],
  explicitSymbolMentions: [],
});

test('emits context and impact before planning, ends completed', async () => {
  const events: RepoPilotEvent[] = [];
  const agent = createRepoPilot();
  agent.onEvent((e) => events.push(e));
  await agent.submit(req('r1'));
  const types = events.map((e) => e.type);
  assert.ok(types.indexOf('context.ready') < types.indexOf('impact.ready'));
  const last = events.filter((e) => e.type === 'agent.status').pop();
  assert.equal(last && last.type === 'agent.status' && last.state, 'completed');
});

test('ImpactLens failure is a warning, not a blocker', async () => {
  const events: RepoPilotEvent[] = [];
  const agent = new RepoPilotController({
    repository: createRepositoryIntelligence(),
    impact: { analyseImpact: async () => { throw new Error('boom'); } },
    verification: createVerificationService(),
    edits: createEditService(),
  });
  agent.onEvent((e) => events.push(e));
  await agent.submit(req('r2'));
  assert.ok(events.some((e) => e.type === 'agent.warning' && e.message.includes('ImpactLens unavailable')));
  assert.ok(!events.some((e) => e.type === 'agent.error'));
});

test('cancellation ends in "cancelled" with no proposal', async () => {
  const events: RepoPilotEvent[] = [];
  let release!: () => void;
  const slowRepo: RepositoryIntelligence = {
    ...createRepositoryIntelligence(),
    getContext: (r) =>
      new Promise((resolve) => {
        release = () => void createRepositoryIntelligence().getContext(r).then(resolve);
      }),
  };
  const agent = new RepoPilotController({
    repository: slowRepo,
    impact: createImpactAnalyser(),
    verification: createVerificationService(),
    edits: createEditService(),
  });
  agent.onEvent((e) => events.push(e));
  const run = agent.submit(req('r3'));
  await new Promise((r) => setImmediate(r));
  agent.cancel('r3');
  release();
  await run;
  const states = events.flatMap((e) => (e.type === 'agent.status' ? [e.state] : []));
  assert.equal(states.at(-1), 'cancelled');
  assert.ok(!events.some((e) => e.type === 'change.proposed' || e.type === 'impact.ready'));
});
