
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listWorkspaceFiles } from '../../../src/repository/workspace-scanner';

async function createWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'repopilot-scanner-'));
}

describe('listWorkspaceFiles', () => {
  it('discovers files and returns POSIX-relative paths', async () => {
    const root = await createWorkspace();

    try {
      await mkdir(path.join(root, 'src', 'utils'), { recursive: true });
      await writeFile(path.join(root, 'src', 'app.ts'), 'export const app = true;');
      await writeFile(path.join(root, 'src', 'utils', 'helper.py'), 'def helper(): pass');

      const result = await listWorkspaceFiles(root);

      assert.deepEqual(result.files, [
        'src/app.ts',
        'src/utils/helper.py',
      ]);
      assert.equal(result.incomplete, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('excludes default ignored directories', async () => {
    const root = await createWorkspace();

    try {
      await mkdir(path.join(root, 'node_modules'), { recursive: true });
      await mkdir(path.join(root, '.git'), { recursive: true });
      await mkdir(path.join(root, 'src'), { recursive: true });

      await writeFile(path.join(root, 'node_modules', 'package.json'), '{}');
      await writeFile(path.join(root, '.git', 'config'), 'private');
      await writeFile(path.join(root, 'src', 'app.ts'), 'export {};');

      const result = await listWorkspaceFiles(root);

      assert.deepEqual(result.files, ['src/app.ts']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('excludes hidden directories and generated files', async () => {
    const root = await createWorkspace();

    try {
      await mkdir(path.join(root, '.hidden'), { recursive: true });
      await mkdir(path.join(root, 'src'), { recursive: true });
      await writeFile(path.join(root, '.hidden', 'app.ts'), 'private');
      await writeFile(path.join(root, 'app.generated.ts'), 'generated');
      await writeFile(path.join(root, 'bundle.min.js'), 'generated');
      await writeFile(path.join(root, 'bundle.js.map'), '{}');
      await writeFile(path.join(root, 'src', 'app.ts'), 'export {};');

      const result = await listWorkspaceFiles(root);

      assert.deepEqual(result.files, ['src/app.ts']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('respects basic .gitignore patterns', async () => {
    const root = await createWorkspace();

    try {
      await mkdir(path.join(root, 'logs'), { recursive: true });
      await mkdir(path.join(root, 'src'), { recursive: true });

      await writeFile(
        path.join(root, '.gitignore'),
        'logs/\n*.tmp\n',
      );

      await writeFile(path.join(root, 'logs', 'app.log'), 'log');
      await writeFile(path.join(root, 'src', 'debug.tmp'), 'temporary');
      await writeFile(path.join(root, 'src', 'app.ts'), 'export {};');

      const result = await listWorkspaceFiles(root);

      assert.deepEqual(result.files, [
        'src/app.ts',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('excludes sensitive files and binary extensions', async () => {
    const root = await createWorkspace();

    try {
      await writeFile(path.join(root, '.env'), 'TOKEN=secret');
      await writeFile(path.join(root, 'client-secret.json'), '{}');
      await writeFile(path.join(root, 'api-token.json'), '{}');
      await writeFile(path.join(root, '.npmrc'), '//registry.npmjs.org/:_authToken=secret');
      await writeFile(path.join(root, 'private.pem'), 'private key');
      await writeFile(path.join(root, 'image.png'), 'not really an image');
      await writeFile(path.join(root, 'app.ts'), 'export {};');

      const result = await listWorkspaceFiles(root);

      assert.deepEqual(result.files, ['app.ts']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips files larger than the configured size limit', async () => {
    const root = await createWorkspace();

    try {
      await writeFile(path.join(root, 'small.ts'), 'ok');
      await writeFile(path.join(root, 'large.ts'), 'this file is too large');

      const result = await listWorkspaceFiles(root, {
        maxFileSizeBytes: 5,
      });

      assert.deepEqual(result.files, ['small.ts']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stops after reaching the configured file limit', async () => {
    const root = await createWorkspace();

    try {
      await writeFile(path.join(root, 'a.ts'), 'a');
      await writeFile(path.join(root, 'b.ts'), 'b');

      const result = await listWorkspaceFiles(root, {
        maxFiles: 1,
      });

      assert.equal(result.files.length, 1);
      assert.equal(result.incomplete, true);
      assert.ok(result.warnings.length > 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('marks scans incomplete when the configured time limit is reached', async () => {
    const root = await createWorkspace();

    try {
      for (let index = 0; index < 100; index += 1) {
        await writeFile(path.join(root, `file-${index}.ts`), 'export {};');
      }

      const result = await listWorkspaceFiles(root, {
        maxDurationMs: 1,
      });

      assert.equal(result.incomplete, true);
      assert.ok(result.warnings.some((warning) => warning.includes('time limit')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not follow symbolic links', async (t) => {
    const root = await createWorkspace();
    const outside = await createWorkspace();

    try {
      await writeFile(path.join(outside, 'secret.ts'), 'private');
      await symlink(
        outside,
        path.join(root, 'external'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const result = await listWorkspaceFiles(root);

      assert.deepEqual(result.files, []);
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
