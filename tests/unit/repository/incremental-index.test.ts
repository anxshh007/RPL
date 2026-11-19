import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRepositoryIntelligence } from '../../../src/repository/index';

async function createWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'repopilot-incremental-'));
}

async function writeWorkspaceFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const file = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

async function renameWithRetry(
  from: string,
  to: string,
  tries = 5,
  delayMs = 200,
): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;

      if (i >= tries || (code !== 'EPERM' && code !== 'EBUSY')) {
        throw err;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

describe('repository incremental indexing', () => {
  it('blocks stale symbol results and refreshes changed Python files', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'src/app.py', 'def old_name():\n    pass\n');
      const repository = createRepositoryIntelligence();
      await repository.initialize(root);
      assert.equal((await repository.findSymbol('old_name')).length, 1);

      repository.invalidate(['src/app.py']);
      await writeWorkspaceFile(root, 'src/app.py', 'def new_name():\n    pass\n');
      await assert.rejects(repository.findSymbol('old_name'), /call reindex/);
      await repository.reindex(['src/app.py']);

      assert.deepEqual(await repository.findSymbol('old_name'), []);
      assert.equal((await repository.findSymbol('new_name')).length, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refreshes dependency edges after a source edit and file rename', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'pkg/client.py', 'import pkg.old_module\n');
      await writeWorkspaceFile(root, 'pkg/old_module.py', 'value = 1\n');
      const repository = createRepositoryIntelligence();
      await repository.initialize(root);
      assert.deepEqual(await repository.getDependencies(['pkg/client.py']), [
        {
          from: 'pkg/client.py',
          to: 'pkg/old_module.py',
          kind: 'imports',
          evidence: 'observed',
        },
      ]);

      await rename(
        path.join(root, 'pkg', 'old_module.py'),
        path.join(root, 'pkg', 'new_module.py'),
      );
      await writeWorkspaceFile(root, 'pkg/client.py', 'import pkg.new_module\n');
      repository.invalidate(['pkg/client.py', 'pkg/old_module.py', 'pkg/new_module.py']);
      await repository.reindex(['pkg/client.py', 'pkg/old_module.py', 'pkg/new_module.py']);

      assert.deepEqual(await repository.getDependencies(['pkg/client.py']), [
        {
          from: 'pkg/client.py',
          to: 'pkg/new_module.py',
          kind: 'imports',
          evidence: 'observed',
        },
      ]);
      assert.deepEqual(await repository.findSymbol('missing', 'pkg/old_module.py'), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports failed reindexing and continues to block stale index queries', async () => {
    const root = await createWorkspace();
    const movedRoot = `${root}-moved`;

    try {
      await writeWorkspaceFile(root, 'src/app.py', 'def current():\n    pass\n');
      const repository = createRepositoryIntelligence();
      await repository.initialize(root);
      await repository.findSymbol('current');

      repository.invalidate(['src/app.py']);
      await renameWithRetry(root, movedRoot);
      await assert.rejects(repository.reindex(['src/app.py']));
      await assert.rejects(repository.findSymbol('current'), /call reindex/);
      await renameWithRetry(movedRoot, root);

      await repository.reindex(['src/app.py']);
      assert.equal((await repository.findSymbol('current')).length, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(movedRoot, { recursive: true, force: true });
    }
  });
});
