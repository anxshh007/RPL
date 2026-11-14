import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  findPythonSymbols,
  indexWorkspacePythonFiles,
  parsePythonSource,
} from '../../../src/repository/python-symbol-index';
import { createRepositoryIntelligence } from '../../../src/repository/index';

const source = `import os as operating_system
from .helpers import Thing as Alias, helper

class Service:
    def run(self, value):
        def nested():
            return value
        return nested()

def build():
    return Service()
`;

describe('parsePythonSource', () => {
  it('extracts functions, classes, methods, nested functions and line ranges', async () => {
    const analysis = await parsePythonSource(source, 'src/service.py');

    assert.equal(analysis.status, 'complete');
    assert.deepEqual(analysis.symbols, [
      { name: 'Service', kind: 'class', file: 'src/service.py', startLine: 4, endLine: 8 },
      { name: 'run', kind: 'method', file: 'src/service.py', startLine: 5, endLine: 8, parent: 'Service' },
      { name: 'nested', kind: 'function', file: 'src/service.py', startLine: 6, endLine: 7, parent: 'run' },
      { name: 'build', kind: 'function', file: 'src/service.py', startLine: 10, endLine: 11 },
    ]);
  });

  it('extracts direct and relative imports with aliases and source lines', async () => {
    const analysis = await parsePythonSource(source, 'src/service.py');

    assert.deepEqual(analysis.imports, [
      {
        file: 'src/service.py',
        module: 'os',
        names: [],
        relativeLevel: 0,
        line: 1,
      },
      {
        file: 'src/service.py',
        module: '.helpers',
        names: ['Thing', 'helper'],
        relativeLevel: 1,
        line: 2,
      },
    ]);
  });

  it('extracts future and wildcard imports', async () => {
    const analysis = await parsePythonSource(
      'from __future__ import annotations\nfrom .. import *\n',
      'src/imports.py',
    );

    assert.deepEqual(analysis.imports, [
      {
        file: 'src/imports.py',
        module: '__future__',
        names: ['annotations'],
        relativeLevel: 0,
        line: 1,
      },
      {
        file: 'src/imports.py',
        module: '..',
        names: ['*'],
        relativeLevel: 2,
        line: 2,
      },
    ]);
  });

  it('marks malformed source partial while retaining recovered declarations', async () => {
    const analysis = await parsePythonSource(
      `def broken(:
    pass

class Recovered:
    pass
`,
      'broken.py',
    );

    assert.equal(analysis.status, 'partial');
    assert.ok(analysis.warnings.length > 0);
    assert.ok(analysis.symbols.some(({ name }) => name === 'Recovered'));
  });

  it('handles empty Python files without inventing symbols', async () => {
    const analysis = await parsePythonSource('', 'empty.py');

    assert.equal(analysis.status, 'complete');
    assert.deepEqual(analysis.symbols, []);
    assert.deepEqual(analysis.imports, []);
  });

  it('uses an explicitly identified heuristic fallback when Tree-sitter is unavailable', async () => {
    const analysis = await parsePythonSource(source, 'src/service.py', {
      forceFallback: true,
    });

    assert.equal(analysis.status, 'fallback');
    assert.ok(analysis.warnings.some((warning) => warning.includes('heuristically')));
    assert.ok(analysis.symbols.some(({ name, parent }) => name === 'nested' && parent === 'run'));
    assert.ok(analysis.imports.some(({ module }) => module === '.helpers'));
  });

  it('returns deterministic symbol ordering', async () => {
    const first = await parsePythonSource(source, 'src/service.py');
    const second = await parsePythonSource(source, 'src/service.py');

    assert.deepEqual(first, second);
  });
});

describe('workspace Python symbol index', () => {
  it('uses safe scanner and reader integrations and supports service lookup', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'repopilot-python-index-'));

    try {
      await mkdir(path.join(root, 'src'));
      await mkdir(path.join(root, 'node_modules'));
      await writeFile(path.join(root, 'src', 'service.py'), source);
      await writeFile(path.join(root, 'node_modules', 'service.py'), 'def hidden(): pass');

      const index = await indexWorkspacePythonFiles(root);
      assert.deepEqual(index.files.map(({ file }) => file), ['src/service.py']);

      const repository = createRepositoryIntelligence();
      await repository.initialize(root);
      assert.deepEqual(
        await repository.findSymbol('run', 'src/service.py'),
        [{
          name: 'run',
          kind: 'method',
          file: 'src/service.py',
          startLine: 5,
          endLine: 8,
          parent: 'Service',
        }],
      );
      assert.deepEqual(await findPythonSymbols(root, 'missing'), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
