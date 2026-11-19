import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readWorkspaceFile,
  searchWorkspace,
} from '../../../src/repository/ripgrep-search';

async function createWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'repopilot-search-'));
}

describe('searchWorkspace', () => {
  it('finds exact text with case-insensitive matches and correct lines', async () => {
    const root = await createWorkspace();

    try {
      await mkdir(path.join(root, 'src'));
      await writeFile(path.join(root, 'src', 'app.ts'), 'first\nNeedle here\nneedle again\n');

      const results = await searchWorkspace(root, 'NEEDLE');

      assert.deepEqual(results, [
        { path: 'src/app.ts', line: 2, text: 'Needle here' },
        { path: 'src/app.ts', line: 3, text: 'needle again' },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('filters by globs and enforces the result and excerpt limits', async () => {
    const root = await createWorkspace();

    try {
      await mkdir(path.join(root, 'src'));
      await mkdir(path.join(root, 'docs'));
      await writeFile(path.join(root, 'src', 'a.ts'), `match ${'x'.repeat(800)}\nmatch two`);
      await writeFile(path.join(root, 'docs', 'guide.md'), 'match docs');

      const results = await searchWorkspace(root, 'match', ['**/*.ts'], 1, {
        maxExcerptLength: 30,
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].path, 'src/a.ts');
      assert.equal(results[0].line, 1);
      assert.ok(results[0].text.length <= 31);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to Node search when ripgrep is missing or fails', async () => {
    const root = await createWorkspace();

    try {
      await writeFile(path.join(root, 'app.txt'), 'fallback match\n');

      const missing = await searchWorkspace(root, 'fallback', undefined, 10, {
        rgPath: path.join(root, 'missing-rg.exe'),
      });
      const failed = await searchWorkspace(root, 'fallback', undefined, 10, {
        rgPath: process.execPath,
      });

      assert.deepEqual(missing, [{ path: 'app.txt', line: 1, text: 'fallback match' }]);
      assert.deepEqual(failed, missing);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not search ignored directories or binary files', async () => {
    const root = await createWorkspace();

    try {
      await mkdir(path.join(root, 'node_modules'));
      await mkdir(path.join(root, 'logs'));
      await writeFile(path.join(root, '.gitignore'), 'logs/\n');
      await writeFile(path.join(root, 'node_modules', 'app.js'), 'hidden match');
      await writeFile(path.join(root, 'logs', 'app.log'), 'ignored match');
      await writeFile(path.join(root, 'image.png'), Buffer.from([0, 1, 2]));
      await writeFile(path.join(root, 'app.ts'), 'visible match');

      const results = await searchWorkspace(root, 'match');

      assert.deepEqual(results.map(({ path: file }) => file), ['app.ts']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects empty queries and invalid result limits', async () => {
    const root = await createWorkspace();

    try {
      await assert.rejects(searchWorkspace(root, '  '));
      await assert.rejects(searchWorkspace(root, 'x', undefined, 0));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('readWorkspaceFile', () => {
  it('returns a bounded, selected line range', async () => {
    const root = await createWorkspace();

    try {
      await writeFile(path.join(root, 'app.ts'), 'one\ntwo\nthree\nfour\n');

      assert.equal(await readWorkspaceFile(root, 'app.ts', 2, 3), 'two\nthree');
      assert.equal(await readWorkspaceFile(root, 'app.ts', 3, 3), 'three');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('caps default lines and output characters', async () => {
    const root = await createWorkspace();

    try {
      await writeFile(path.join(root, 'app.ts'), `${'x'.repeat(25_000)}\n${'line\n'.repeat(205)}`);
      const excerpt = await readWorkspaceFile(root, 'app.ts');

      assert.ok(excerpt.length <= 20_020);
      assert.ok(excerpt.includes('[Excerpt truncated.]'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects traversal, missing files, binaries, and oversized files', async () => {
    const root = await createWorkspace();

    try {
      await writeFile(path.join(root, 'binary.dat'), Buffer.from([0, 1, 2]));
      await writeFile(path.join(root, 'large.txt'), 'too large');

      await assert.rejects(readWorkspaceFile(root, '../outside.txt'));
      await assert.rejects(readWorkspaceFile(root, 'missing.txt'));
      await assert.rejects(readWorkspaceFile(root, 'binary.dat'));
      await assert.rejects(readWorkspaceFile(root, 'large.txt', 1, undefined, {
        maxFileSizeBytes: 2,
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
