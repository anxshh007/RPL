import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DependencyEdge } from '../../../src/shared/contracts';
import { createRepositoryIntelligence } from '../../../src/repository/index';
import {
  analyzePythonDependencies,
} from '../../../src/repository/dependency-index';
import { parsePythonImports } from '../../../src/repository/python-import-parser';

async function createWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'repopilot-dependencies-'));
}

async function writeWorkspaceFile(root: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

describe('parsePythonImports', () => {
  it('parses absolute, relative, aliased, and multiple imports', async () => {
    const result = await parsePythonImports(
      'import package.module, other as alias\nfrom . import utils\nfrom ..services import auth\n',
      'pkg/sub/client.py',
    );

    assert.equal(result.status, 'complete');
    assert.deepEqual(result.imports, [
      {
        file: 'pkg/sub/client.py',
        module: 'other',
        names: [],
        relativeLevel: 0,
        line: 1,
      },
      {
        file: 'pkg/sub/client.py',
        module: 'package.module',
        names: [],
        relativeLevel: 0,
        line: 1,
      },
      {
        file: 'pkg/sub/client.py',
        module: '.',
        names: ['utils'],
        relativeLevel: 1,
        line: 2,
      },
      {
        file: 'pkg/sub/client.py',
        module: '..services',
        names: ['auth'],
        relativeLevel: 2,
        line: 3,
      },
    ]);
  });

  it('reports invalid import syntax as a partial parse without inventing imports', async () => {
    const result = await parsePythonImports(
      'from ??? import missing\n',
      'pkg/invalid.py',
    );

    assert.equal(result.status, 'partial');
    assert.deepEqual(result.imports, []);
    assert.ok(result.warnings.length > 0);
  });
});

describe('analyzePythonDependencies', () => {
  it('resolves absolute and relative imports, reports external and unresolved imports, and deduplicates edges', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'requirements.txt', 'requests>=2\n');
      await writeWorkspaceFile(root, 'pkg/__init__.py', '');
      await writeWorkspaceFile(root, 'pkg/utils.py', 'from . import client\ndef helper(): pass\n');
      await writeWorkspaceFile(root, 'pkg/services/__init__.py', '');
      await writeWorkspaceFile(root, 'pkg/services/auth.py', 'def authorize(): pass\n');
      await writeWorkspaceFile(
        root,
        'pkg/client.py',
        [
          'import os',
          'import requests',
          'import mystery_package',
          'import pkg.utils, pkg.services.auth',
          'from pkg.utils import helper',
          'from . import utils',
          'from .services import auth',
          'from .missing import absent',
          '',
        ].join('\n'),
      );

      const result = await analyzePythonDependencies(root);

      const expectedEdges: DependencyEdge[] = [
        { from: 'pkg/client.py', to: 'pkg/__init__.py', kind: 'imports', evidence: 'observed' },
        { from: 'pkg/client.py', to: 'pkg/services/__init__.py', kind: 'imports', evidence: 'observed' },
        { from: 'pkg/client.py', to: 'pkg/services/auth.py', kind: 'imports', evidence: 'observed' },
        { from: 'pkg/client.py', to: 'pkg/utils.py', kind: 'imports', evidence: 'observed' },
        { from: 'pkg/utils.py', to: 'pkg/__init__.py', kind: 'imports', evidence: 'observed' },
        { from: 'pkg/utils.py', to: 'pkg/client.py', kind: 'imports', evidence: 'observed' },
      ];
      assert.deepEqual(result.dependencyEdges, expectedEdges);
      assert.deepEqual(result.unresolvedImports, [
        { file: 'pkg/client.py', module: 'mystery_package' },
        { file: 'pkg/client.py', module: 'pkg.missing' },
      ]);
      assert.deepEqual(result.externalImports, [
        {
          file: 'pkg/client.py',
          module: 'os',
          line: 1,
          classification: 'stdlib',
        },
        {
          file: 'pkg/client.py',
          module: 'requests',
          line: 2,
          classification: 'declared_dependency',
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolves parent-directory imports and returns stable deduplicated output', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'pkg/__init__.py', '');
      await writeWorkspaceFile(root, 'pkg/services/__init__.py', '');
      await writeWorkspaceFile(root, 'pkg/services/auth.py', '');
      await writeWorkspaceFile(root, 'pkg/features/__init__.py', '');
      await writeWorkspaceFile(
        root,
        'pkg/features/client.py',
        'from ..services import auth\nfrom ..services.auth import authorize\n',
      );

      const first = await analyzePythonDependencies(root);
      const second = await analyzePythonDependencies(root);

      assert.deepEqual(first, second);
      assert.deepEqual(first.dependencyEdges, [
        { from: 'pkg/features/client.py', to: 'pkg/services/__init__.py', kind: 'imports', evidence: 'observed' },
        { from: 'pkg/features/client.py', to: 'pkg/services/auth.py', kind: 'imports', evidence: 'observed' },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolves absolute imports from a conventional src directory', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'src/project/__init__.py', '');
      await writeWorkspaceFile(root, 'src/project/models.py', '');
      await writeWorkspaceFile(root, 'src/consumer.py', 'from project import models\n');

      const result = await analyzePythonDependencies(root);

      assert.deepEqual(result.dependencyEdges, [
        {
          from: 'src/consumer.py',
          to: 'src/project/__init__.py',
          kind: 'imports',
          evidence: 'observed',
        },
        {
          from: 'src/consumer.py',
          to: 'src/project/models.py',
          kind: 'imports',
          evidence: 'observed',
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('infers test edges only for clear unique filename counterparts', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'tests/test_cli.py', 'def test_cli(): pass\n');
      await writeWorkspaceFile(root, 'src/cli.py', 'def run(): pass\n');
      await writeWorkspaceFile(root, 'tests/test_client.py', 'def test_client(): pass\n');
      await writeWorkspaceFile(root, 'src/climate.py', 'def weather(): pass\n');

      const result = await analyzePythonDependencies(root);
      assert.deepEqual(result.dependencyEdges, [
        {
          from: 'tests/test_cli.py',
          to: 'src/cli.py',
          kind: 'tests',
          evidence: 'inferred',
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not infer test edges when the source filename is ambiguous', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'tests/test_cli.py', 'def test_cli(): pass\n');
      await writeWorkspaceFile(root, 'src/cli.py', 'def run(): pass\n');
      await writeWorkspaceFile(root, 'tools/cli.py', 'def run(): pass\n');

      const result = await analyzePythonDependencies(root);
      assert.deepEqual(result.dependencyEdges, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('filters dependency edges to requested paths and wires service getDependencies', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'pkg/a.py', 'import pkg.b\n');
      await writeWorkspaceFile(root, 'pkg/b.py', '');
      await writeWorkspaceFile(root, 'other/c.py', 'import pkg.b\n');

      const repository = createRepositoryIntelligence();
      await repository.initialize(root);
      assert.deepEqual(await repository.getDependencies(['pkg/b.py']), [
        { from: 'other/c.py', to: 'pkg/b.py', kind: 'imports', evidence: 'observed' },
        { from: 'pkg/a.py', to: 'pkg/b.py', kind: 'imports', evidence: 'observed' },
      ].sort((left, right) => left.from.localeCompare(right.from)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
