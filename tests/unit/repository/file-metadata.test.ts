import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getFileMetadata } from '../../../src/repository/file-metadata';

describe('getFileMetadata', () => {
  it('returns safe metadata for a workspace-relative file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'repopilot-metadata-'));

    try {
      await mkdir(path.join(root, 'src'));
      await writeFile(path.join(root, 'src', 'app.TS'), 'hello');

      const metadata = await getFileMetadata(root, 'src\\app.TS');

      assert.equal(metadata.path, 'src/app.TS');
      assert.equal(metadata.name, 'app.TS');
      assert.equal(metadata.size, 5);
      assert.equal(metadata.extension, '.ts');
      assert.doesNotThrow(() => new Date(metadata.modifiedAt).toISOString());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects directories, sensitive files, and paths outside the workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'repopilot-metadata-'));

    try {
      await mkdir(path.join(root, 'src'));
      await writeFile(path.join(root, 'secret.env'), 'hidden');

      await assert.rejects(getFileMetadata(root, 'src'));
      await assert.rejects(getFileMetadata(root, 'secret.env'));
      await assert.rejects(
        getFileMetadata(root, path.join(root, '..', 'outside.txt')),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects symlink escapes', async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'repopilot-metadata-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'repopilot-outside-'));

    try {
      await writeFile(path.join(outside, 'app.ts'), 'outside');
      await symlink(
        outside,
        path.join(root, 'external'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      await assert.rejects(getFileMetadata(root, 'external/app.ts'));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS') {
        t.skip('Symlink creation is not permitted in this environment.');
        return;
      }

      throw error;
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
