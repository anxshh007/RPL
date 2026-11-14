// Component logic & state transition tests (Member 5 UI)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HunkDecision, ProposedFileChange } from '../../../src/shared/contracts';

test('hunk decisions correctly map accepted and rejected states', () => {
  const decisions = new Map<string, 'accept' | 'reject'>();
  decisions.set('src/flask/helpers.py:hunk-1', 'accept');
  decisions.set('src/flask/helpers.py:hunk-2', 'reject');

  const hunkDecisions: HunkDecision[] = Array.from(decisions.entries()).map(([key, decision]) => {
    const [path, hunkId] = key.split(':');
    return { path, hunkId, decision };
  });

  assert.equal(hunkDecisions.length, 2);
  assert.equal(hunkDecisions[0].decision, 'accept');
  assert.equal(hunkDecisions[1].decision, 'reject');
});

test('proposed file change structure contains valid hunks and hash', () => {
  const fileChange: ProposedFileChange = {
    path: 'src/flask/helpers.py',
    changeType: 'modify',
    originalContentHash: 'a1b2c3d4',
    proposedContent: 'def get_debug_flag(): return False\n',
    unifiedDiff: '@@ -18,3 +18,3 @@\n-old\n+new\n',
    hunks: [
      {
        hunkId: 'hunk-1',
        oldStart: 18,
        oldLines: 3,
        newStart: 18,
        newLines: 3,
        diffText: '-old\n+new\n',
      },
    ],
  };

  assert.equal(fileChange.hunks.length, 1);
  assert.equal(fileChange.hunks[0].hunkId, 'hunk-1');
  assert.ok(fileChange.originalContentHash.length > 0);
});
