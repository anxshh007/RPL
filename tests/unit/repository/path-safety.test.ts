
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWorkspacePath,
  resolveWorkspacePath,
} from '../../../src/repository/path-safety';
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('normalizeWorkspacePath', () => {
  it('normalizes Windows separators to POSIX separators', () => {
    assert.equal(
      normalizeWorkspacePath('src\\repository\\index.ts'),
      'src/repository/index.ts',
    );
  });

  it('rejects empty paths', () => {
    assert.throws(() => normalizeWorkspacePath(''));
  });

  it('rejects traversal paths', () => {
    assert.throws(() => normalizeWorkspacePath('../secret.txt'));
    assert.throws(() => normalizeWorkspacePath('src/../../secret.txt'));
  });

  it('rejects absolute paths', () => {
    assert.throws(() => normalizeWorkspacePath('/etc/passwd'));
    assert.throws(() => normalizeWorkspacePath('C:\\Users\\secret.txt'));
    assert.throws(() => normalizeWorkspacePath('\\\\server\\share\\file.txt'));
  });

  it('rejects blocked directories', () => {
    assert.throws(() => normalizeWorkspacePath('.git/config'));
    assert.throws(() => normalizeWorkspacePath('node_modules/package.json'));
    assert.throws(() => normalizeWorkspacePath('dist/bundle.js'));
  });

  it('rejects sensitive filenames', () => {
    assert.throws(() => normalizeWorkspacePath('.env'));
    assert.throws(() => normalizeWorkspacePath('.env.local'));
    assert.throws(() => normalizeWorkspacePath('config/credentials.json'));
    assert.throws(() => normalizeWorkspacePath('config/client-secret.json'));
    assert.throws(() => normalizeWorkspacePath('config/api-token.json'));
    assert.throws(() => normalizeWorkspacePath('.npmrc'));
  });

  it('accepts safe workspace-relative paths', () => {
    assert.equal(
      normalizeWorkspacePath('src/repository/index.ts'),
      'src/repository/index.ts',
    );
  });
});

describe('resolveWorkspacePath', () => {
  it('resolves an existing file inside the workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'repopilot-test-'));

    try {
      await mkdir(path.join(root, 'src'));
      await writeFile(path.join(root, 'src', 'app.py'), 'print("hello")');

      const resolved = await resolveWorkspacePath(root, 'src/app.py');

      assert.equal(
        resolved,
        await import('node:fs/promises').then((fs) =>
          fs.realpath(path.join(root, 'src', 'app.py')),
        ),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects symlinks that escape the workspace', async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'repopilot-test-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'repopilot-outside-'));

    try {
      await writeFile(path.join(outside, 'secret.txt'), 'private');
      await symlink(
        outside,
        path.join(root, 'external'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      await assert.rejects(
        resolveWorkspacePath(root, 'external/secret.txt'),
      );
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

  it('rejects an absolute path outside the workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'repopilot-test-'));

    try {
      await assert.rejects(
        resolveWorkspacePath(root, path.join(root, '..', 'outside.txt')),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
