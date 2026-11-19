// Safe editing (owner: Member 1): propose writes nothing, apply writes only accepted hunks,
// stale files are refused, undo restores exactly and refuses after later edits.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createEditService, ChangeProposalService } from '../../../src/edits';
import type { SafeEditingService } from '../../../src/edits';
import type { HunkDecision } from '../../../src/shared/contracts';
import { toSafeError } from '../../../src/shared/contracts';

let root: string;
let edits: SafeEditingService;

const TEN = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text, 'utf-8');
};
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');
const acceptAll = (plan: { files: Array<{ path: string; hunks: Array<{ hunkId: string }> }> }): HunkDecision[] =>
  plan.files.flatMap((f) => f.hunks.map((h) => ({ path: f.path, hunkId: h.hunkId, decision: 'accept' as const })));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'repopilot-edits-'));
  edits = createEditService(root);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('createEditService requires a workspace root', () => {
  assert.throws(() => createEditService(''), /workspace root/);
});

test('propose computes hunks and writes nothing', async () => {
  write('app.py', 'DEBUG = True\nPORT = 5000\n');
  const plan = await edits.propose('r1', 'turn debug off', [{ path: 'app.py', proposedContent: 'DEBUG = False\nPORT = 5000\n' }], ['why']);
  assert.equal(plan.requestId, 'r1');
  assert.equal(plan.files.length, 1);
  assert.equal(plan.files[0].changeType, 'modify');
  assert.equal(plan.files[0].hunks.length, 1);
  assert.match(plan.files[0].unifiedDiff, /-DEBUG = True\n\+DEBUG = False/);
  assert.deepEqual(plan.rationale, ['why']);
  assert.equal(read('app.py'), 'DEBUG = True\nPORT = 5000\n');
});

test('apply writes only the accepted hunk and reports applied ids', async () => {
  write('m.py', TEN.join('\n') + '\n');
  const proposed = [...TEN];
  proposed[0] = 'FIRST';
  proposed[11] = 'LAST';
  const plan = await edits.propose('r2', 's', [{ path: 'm.py', proposedContent: proposed.join('\n') + '\n' }], []);
  const [first, last] = plan.files[0].hunks;
  assert.ok(first && last, 'two separate hunks');

  const res = await edits.apply('r2', [
    { path: 'm.py', hunkId: first.hunkId, decision: 'reject' },
    { path: 'm.py', hunkId: last.hunkId, decision: 'accept' },
  ]);
  assert.equal(res.status, 'applied');
  assert.equal(res.requestId, 'r2');
  assert.deepEqual(res.appliedPaths, ['m.py']);
  assert.deepEqual(res.appliedHunkIds, [last.hunkId]);
  const after = read('m.py').split('\n');
  assert.equal(after[0], 'line 1', 'rejected hunk keeps the original');
  assert.equal(after[11], 'LAST');
});

test('a hunk id is matched together with its path', async () => {
  write('a.py', 'x = 1\n');
  const plan = await edits.propose('r3', 's', [{ path: 'a.py', proposedContent: 'x = 2\n' }], []);
  const res = await edits.apply('r3', [{ path: 'other.py', hunkId: plan.files[0].hunks[0].hunkId, decision: 'accept' }]);
  assert.equal(res.status, 'nothing_to_apply');
  assert.equal(read('a.py'), 'x = 1\n');
});

test('no accepted hunks or no plan means nothing_to_apply', async () => {
  write('a.py', 'x = 1\n');
  const plan = await edits.propose('r4', 's', [{ path: 'a.py', proposedContent: 'x = 2\n' }], []);
  const rejected = await edits.apply('r4', [{ path: 'a.py', hunkId: plan.files[0].hunks[0].hunkId, decision: 'reject' }]);
  assert.equal(rejected.status, 'nothing_to_apply');
  assert.deepEqual(rejected.appliedPaths, []);
  const unknown = await edits.apply('nope', [{ path: 'a.py', hunkId: 'h', decision: 'accept' }]);
  assert.equal(unknown.status, 'nothing_to_apply');
  assert.equal(read('a.py'), 'x = 1\n');
});

test('a file changed after propose is refused as stale and nothing is written', async () => {
  write('a.py', 'x = 1\n');
  write('b.py', 'y = 1\n');
  const plan = await edits.propose('r5', 's', [
    { path: 'a.py', proposedContent: 'x = 2\n' },
    { path: 'b.py', proposedContent: 'y = 2\n' },
  ], []);
  write('b.py', 'y = 100\n');
  const res = await edits.apply('r5', acceptAll(plan));
  assert.equal(res.status, 'stale');
  assert.deepEqual(res.stalePaths, ['b.py']);
  assert.equal(read('a.py'), 'x = 1\n', 'no partial write');
});

test('CRLF files keep CRLF and are not reported stale', async () => {
  write('w.py', 'A = 1\r\nB = 2\r\nC = 3\r\n');
  const plan = await edits.propose('r6', 's', [{ path: 'w.py', proposedContent: 'A = 1\nB = 99\nC = 3\n' }], []);
  const res = await edits.apply('r6', acceptAll(plan));
  assert.equal(res.status, 'applied');
  assert.equal(read('w.py'), 'A = 1\r\nB = 99\r\nC = 3\r\n');
});

test('undo of a created file deletes it; undo of a modify restores it', async () => {
  write('keep.py', 'v = 1\n');
  const plan = await edits.propose('r7', 's', [
    { path: 'pkg/new.py', proposedContent: 'print("new")\n' },
    { path: 'keep.py', proposedContent: 'v = 2\n' },
  ], []);
  assert.equal(plan.files.find((f) => f.path === 'pkg/new.py')?.changeType, 'create');
  assert.equal((await edits.apply('r7', acceptAll(plan))).status, 'applied');
  assert.equal(read('pkg/new.py'), 'print("new")\n');

  const undone = await edits.undo('r7');
  assert.equal(undone.status, 'undone');
  assert.deepEqual([...undone.restoredPaths].sort(), ['keep.py', 'pkg/new.py']);
  assert.equal(fs.existsSync(path.join(root, 'pkg/new.py')), false);
  assert.equal(read('keep.py'), 'v = 1\n');
  assert.equal((await edits.undo('r7')).status, 'nothing_to_undo');
});

test('undo of a delete restores the file', async () => {
  write('gone.py', 'z = 1\n');
  const plan = await edits.propose('r8', 's', [{ path: 'gone.py', proposedContent: '' }], []);
  assert.equal(plan.files[0].changeType, 'delete');
  assert.equal((await edits.apply('r8', acceptAll(plan))).status, 'applied');
  assert.equal(fs.existsSync(path.join(root, 'gone.py')), false);
  assert.equal((await edits.undo('r8')).status, 'undone');
  assert.equal(read('gone.py'), 'z = 1\n');
});

test('undo is refused when a file changed after apply', async () => {
  write('a.py', 'x = 1\n');
  const plan = await edits.propose('r9', 's', [{ path: 'a.py', proposedContent: 'x = 2\n' }], []);
  await edits.apply('r9', acceptAll(plan));
  write('a.py', 'x = 3  # user edit\n');
  const res = await edits.undo('r9');
  assert.equal(res.status, 'error');
  assert.deepEqual(res.restoredPaths, []);
  assert.equal(read('a.py'), 'x = 3  # user edit\n');
});

test('discard drops the plan without touching disk', async () => {
  write('a.py', 'x = 1\n');
  const plan = await edits.propose('r10', 's', [{ path: 'a.py', proposedContent: 'x = 2\n' }], []);
  edits.discard('r10');
  assert.equal((await edits.apply('r10', acceptAll(plan))).status, 'nothing_to_apply');
  assert.equal(read('a.py'), 'x = 1\n');
});

test('unsafe paths are rejected at propose time with a validation error', async () => {
  for (const bad of ['../outside.py', path.join(root, 'abs.py'), '.env', '.git/config', 'node_modules/x.js']) {
    await assert.rejects(
      edits.propose('r11', 's', [{ path: bad, proposedContent: 'x' }], []),
      (err: unknown) => toSafeError(err).kind === 'validation',
      bad,
    );
  }
});

test('hunk ids do not collide for a/b.py and a_b.py', () => {
  const a = ChangeProposalService.createProposal('a/b.py', 'x = 1\n', 'x = 2\n', true);
  const b = ChangeProposalService.createProposal('a_b.py', 'x = 1\n', 'x = 2\n', true);
  assert.notEqual(a.hunks[0].hunkId, b.hunks[0].hunkId);
});
