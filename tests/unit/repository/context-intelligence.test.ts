import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChangeRequest, ContextFile } from '../../../src/shared/contracts';
import { createRepositoryIntelligence } from '../../../src/repository/index';
import { getTwoHopDependantEdges } from '../../../src/repository/repository-service';
import { fitContextToBudget } from '../../../src/repository/context-budget';
import { parseRepositoryMentions } from '../../../src/repository/mention-parser';
import {
  DEFAULT_CONTEXT_RANKING_WEIGHTS,
  rankContextCandidates,
  type RankedContextCandidate,
} from '../../../src/repository/context-ranker';

async function createWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'repopilot-context-'));
}

async function writeWorkspaceFile(root: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

const request = (instruction: string, fields: Partial<ChangeRequest> = {}): ChangeRequest => ({
  requestId: 'context-test',
  instruction,
  mode: 'agent',
  explicitFileMentions: [],
  explicitSymbolMentions: [],
  ...fields,
});

describe('parseRepositoryMentions', () => {
  const files = [
    'src/my module.py',
    'src/pkg/active.py',
    'src/pkg/helper.py',
  ];

  it('resolves quoted and unquoted @file paths containing spaces', () => {
    const parsed = parseRepositoryMentions(
      [],
      [],
      'Change @file:"src/my module.py" and @file:src/my module.py please.',
      files,
    );

    assert.deepEqual(parsed.fileMentions, ['src/my module.py']);
    assert.deepEqual(parsed.warnings, []);
  });

  it('resolves relative @file paths from the active file directory', () => {
    const parsed = parseRepositoryMentions(
      ['./helper.py'],
      [],
      '',
      files,
      'src/pkg/active.py',
    );

    assert.deepEqual(parsed.fileMentions, ['src/pkg/helper.py']);
  });

  it('parses @symbol mentions and reports missing file mentions', () => {
    const parsed = parseRepositoryMentions(
      ['missing.py'],
      ['build_app'],
      'Update @symbol:MissingClass',
      files,
    );

    assert.deepEqual(parsed.symbolMentions, ['build_app', 'MissingClass']);
    assert.equal(parsed.warnings.length, 1);
    assert.ok(parsed.warnings[0].includes('missing.py'));
  });
});

describe('context ranking and budget', () => {
  it('ranks deterministically and prioritizes explicit signals', () => {
    const candidates: RankedContextCandidate[] = [
      { path: 'z.py', score: 100, signals: ['textMatch'], reasons: ['text'] },
      { path: 'a.py', score: 100, signals: ['textMatch'], reasons: ['text'] },
      { path: 'explicit.py', score: DEFAULT_CONTEXT_RANKING_WEIGHTS.explicitFile, signals: ['explicitFile'], reasons: ['explicit'] },
    ];

    assert.deepEqual(
      rankContextCandidates(candidates).map(({ path: file }) => file),
      ['explicit.py', 'a.py', 'z.py'],
    );
  });

  it('enforces the budget and reports explicit-file conflicts', () => {
    const makeFile = (file: string, text: string): ContextFile => ({
      path: file,
      reason: 'Explicitly mentioned file.',
      score: DEFAULT_CONTEXT_RANKING_WEIGHTS.explicitFile,
      source: 'explicit_mention',
      excerpts: [{ startLine: 1, endLine: 1, text }],
    });

    const budget = fitContextToBudget(
      [makeFile('a.py', 'a'.repeat(120)), makeFile('b.py', 'b'.repeat(120))],
      40,
      new Set(['a.py', 'b.py']),
    );

    assert.ok(budget.tokenEstimate <= 40);
    assert.ok(budget.budgetConflicts.length > 0);
    assert.ok(budget.relevantFiles.length > 0);
  });

  it('prioritizes direct dependant edges before second-hop edges', () => {
    const result = getTwoHopDependantEdges([
      { from: 'a-second.py', to: 'z-direct.py', kind: 'imports', evidence: 'observed' },
      { from: 'z-direct.py', to: 'root.py', kind: 'imports', evidence: 'observed' },
    ], new Set(['root.py']));

    assert.deepEqual(result.edges.map(({ from }) => from), [
      'z-direct.py',
      'a-second.py',
    ]);
  });

  it('traverses dependants in reverse only and excludes unrelated edges', () => {
    const result = getTwoHopDependantEdges([
      { from: 'dependent.py', to: 'root.py', kind: 'imports', evidence: 'observed' },
      { from: 'outer.py', to: 'dependent.py', kind: 'imports', evidence: 'observed' },
      { from: 'root.py', to: 'dependency.py', kind: 'imports', evidence: 'observed' },
      { from: 'unrelated.py', to: 'elsewhere.py', kind: 'imports', evidence: 'observed' },
    ], new Set(['root.py']));

    assert.deepEqual(result.edges.map(({ from, to }) => `${from}->${to}`), [
      'dependent.py->root.py',
      'outer.py->dependent.py',
    ]);
  });

  it('caps the prioritized dependant edges at 200 and reports omissions', () => {
    const directEdges = Array.from({ length: 198 }, (_, index) => ({
      from: `direct-${String(index).padStart(3, '0')}.py`,
      to: 'root.py',
      kind: 'imports' as const,
      evidence: 'observed' as const,
    }));
    const secondHopEdges = Array.from({ length: 10 }, (_, index) => ({
      from: `second-${String(index).padStart(2, '0')}.py`,
      to: 'direct-000.py',
      kind: 'imports' as const,
      evidence: 'observed' as const,
    }));
    const result = getTwoHopDependantEdges(
      [...secondHopEdges, ...directEdges],
      new Set(['root.py']),
    );

    assert.equal(result.edges.length, 200);
    assert.equal(result.omittedCount, 8);
    assert.ok(result.edges.slice(0, 198).every(({ from }) => from.startsWith('direct-')));
    assert.deepEqual(
      result.edges.slice(198).map(({ from }) => from),
      ['second-00.py', 'second-01.py'],
    );
  });

  it('sorts equal-distance dependant edges deterministically', () => {
    const edges = [
      { from: 'b.py', to: 'root.py', kind: 'tests' as const, evidence: 'inferred' as const },
      { from: 'a.py', to: 'root.py', kind: 'imports' as const, evidence: 'observed' as const },
      { from: 'a.py', to: 'root.py', kind: 'imports' as const, evidence: 'inferred' as const },
    ];
    const first = getTwoHopDependantEdges(edges, new Set(['root.py']));
    const second = getTwoHopDependantEdges([...edges].reverse(), new Set(['root.py']));

    assert.deepEqual(first, second);
    assert.deepEqual(first.edges, [
      { from: 'a.py', to: 'root.py', kind: 'imports', evidence: 'inferred' },
      { from: 'a.py', to: 'root.py', kind: 'imports', evidence: 'observed' },
      { from: 'b.py', to: 'root.py', kind: 'tests', evidence: 'inferred' },
    ]);
    assert.equal(first.omittedCount, 0);
  });
});

describe('repository context intelligence', () => {
  it('returns deduplicated two-hop dependant edges for active files independently of excerpt budget', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'pkg/base.py', 'import pkg.direct\n');
      await writeWorkspaceFile(root, 'pkg/direct.py', 'import pkg.base\nimport pkg.base\n');
      await writeWorkspaceFile(root, 'pkg/deep.py', 'import pkg.direct\n');
      await writeWorkspaceFile(root, 'other/source.py', 'import other.target\n');
      await writeWorkspaceFile(root, 'other/target.py', '');

      const repository = createRepositoryIntelligence(1);
      await repository.initialize(root);
      const context = await repository.getContext(request('Unrelated instruction', {
        activeFile: 'pkg/base.py',
      }));

      assert.deepEqual(context.dependencyEdges, [
        { from: 'pkg/direct.py', to: 'pkg/base.py', kind: 'imports', evidence: 'observed' },
        { from: 'pkg/base.py', to: 'pkg/direct.py', kind: 'imports', evidence: 'observed' },
        { from: 'pkg/deep.py', to: 'pkg/direct.py', kind: 'imports', evidence: 'observed' },
      ]);
      assert.ok(!context.relevantFiles.some(({ path: file }) =>
        ['pkg/base.py', 'pkg/direct.py', 'pkg/deep.py'].includes(file)));
      assert.ok(!context.dependencyEdges.some(({ from, to }) =>
        from.startsWith('other/') || to.startsWith('other/')));
      assert.equal(
        new Set(context.dependencyEdges.map(({ from, to, kind }) => `${from}\0${to}\0${kind}`)).size,
        context.dependencyEdges.length,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses explicitly mentioned files as two-hop dependency roots', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'pkg/base.py', 'value = 1\n');
      await writeWorkspaceFile(root, 'pkg/direct.py', 'import pkg.base\n');
      await writeWorkspaceFile(root, 'pkg/deep.py', 'import pkg.direct\n');
      await writeWorkspaceFile(root, 'other/source.py', 'import other.target\n');
      await writeWorkspaceFile(root, 'other/target.py', '');

      const repository = createRepositoryIntelligence();
      await repository.initialize(root);
      const context = await repository.getContext(request(
        'Use the explicit file',
        { explicitFileMentions: ['pkg/base.py'] },
      ));

      assert.ok(context.relevantFiles.some(({ path: file }) => file === 'pkg/base.py'));
      assert.deepEqual(context.dependencyEdges, [
        { from: 'pkg/direct.py', to: 'pkg/base.py', kind: 'imports', evidence: 'observed' },
        { from: 'pkg/deep.py', to: 'pkg/direct.py', kind: 'imports', evidence: 'observed' },
      ]);
      assert.ok(!context.dependencyEdges.some(({ from, to }) =>
        from.startsWith('other/') || to.startsWith('other/')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('normalizes configured token budgets and uses the default when missing or invalid', async () => {
    const root = await createWorkspace();

    try {
      const cases: Array<{ value?: unknown; expected: number; warning?: string }> = [
        { value: 0, expected: 1, warning: 'clamped to the minimum' },
        { value: 1, expected: 1 },
        { value: 25001, expected: 20000, warning: 'clamped to the maximum' },
        { value: 20000, expected: 20000 },
        { value: 9000, expected: 9000 },
        { expected: 16000 },
        { value: 'not-a-number', expected: 16000, warning: 'using the default' },
        { value: Number.NaN, expected: 16000, warning: 'using the default' },
      ];

      for (const { value, expected, warning } of cases) {
        const repository = createRepositoryIntelligence(value);
        await repository.initialize(root);
        const context = await repository.getContext(request('Check context budget'));

        assert.equal(context.tokenBudget, expected);
        if (warning) {
          assert.ok(context.warnings.some((entry) => entry.includes(warning)));
        } else {
          assert.ok(!context.warnings.some((entry) => entry.includes('context token budget')));
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves explicit mention budget conflicts after clamping', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'src/app.py', 'def build_app():\n    return "ready"\n');
      const repository = createRepositoryIntelligence(0);
      await repository.initialize(root);
      const context = await repository.getContext(request(
        'Update @file:src/app.py and @symbol:build_app',
      ));

      assert.equal(context.tokenBudget, 1);
      assert.ok(context.budgetConflicts.includes('src/app.py'));
      assert.ok(context.warnings.some((entry) => entry.includes('clamped to the minimum')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolves explicit symbols and returns explainable, budgeted context', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(
        root,
        'src/app.py',
        'def build_app():\n    return "ready"\n',
      );
      await writeWorkspaceFile(root, 'README.md', 'The build_app factory creates the application.');
      const repository = createRepositoryIntelligence(12000);
      await repository.initialize(root);

      const context = await repository.getContext(request(
        'Update @file:src/app.py and @symbol:build_app',
      ));

      assert.equal(context.requestId, 'context-test');
      assert.ok(context.relevantFiles.some(({ path: file }) => file === 'src/app.py'));
      assert.ok(context.relevantFiles.every(({ reason, score, excerpts }) =>
        reason.length > 0 && score > 0 && excerpts.length > 0));
      assert.ok(context.relevantSymbols.some(({ name }) => name === 'build_app'));
      assert.ok(context.tokenEstimate <= context.tokenBudget);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes active selection and emits warnings for unresolved mentions', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'src/app.py', 'first\nselected_value = 1\nlast\n');
      const repository = createRepositoryIntelligence();
      await repository.initialize(root);
      const context = await repository.getContext(request(
        'Change @file:missing.py and @symbol:does_not_exist',
        {
          activeFile: 'src/app.py',
          selectedText: 'selected_value = 1',
          selectionRange: { startLine: 2, endLine: 2 },
        },
      ));

      const active = context.relevantFiles.find(({ path: file }) => file === 'src/app.py');
      assert.equal(active?.source, 'active_selection');
      assert.ok(active?.excerpts.some(({ text }) => text.includes('selected_value')));
      assert.ok(context.warnings.some((warning) => warning.includes('missing.py')));
      assert.ok(context.warnings.some((warning) => warning.includes('does_not_exist')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports an oversized active file as a budget conflict', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'src/large.py', `value = "${'x'.repeat(12000)}"\n`);
      const repository = createRepositoryIntelligence(600);
      await repository.initialize(root);

      const context = await repository.getContext(request('Review active file', {
        activeFile: 'src/large.py',
      }));

      assert.ok(context.budgetConflicts.includes('src/large.py'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('warns when no files fit the budget and identifies a conflicting active file', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'src/active.py', 'value = 1\n');
      const repository = createRepositoryIntelligence(1);
      await repository.initialize(root);

      const context = await repository.getContext(request('Review active file', {
        activeFile: 'src/active.py',
      }));

      assert.deepEqual(context.relevantFiles, []);
      assert.ok(context.warnings.some((warning) =>
        warning.includes('No files could fit within the token budget') &&
        warning.includes('src/active.py')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not warn about budget fit when files are successfully selected', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'src/active.py', 'value = 1\n');
      const repository = createRepositoryIntelligence();
      await repository.initialize(root);

      const context = await repository.getContext(request('Review active file', {
        activeFile: 'src/active.py',
      }));

      assert.ok(context.relevantFiles.length > 0);
      assert.ok(context.warnings.every((warning) =>
        !warning.includes('No files could fit within the token budget')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('discovers Flask CLI source, CLI tests, and docs from instruction evidence', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(
        root,
        'src/flask/cli.py',
        'def config_command():\n    """Show Flask configuration."""\n    return current_app.config\n',
      );
      await writeWorkspaceFile(
        root,
        'tests/test_cli.py',
        'def test_config_command():\n    assert "config" in cli_output\n',
      );
      await writeWorkspaceFile(
        root,
        'docs/cli.rst',
        'Flask CLI\n=========\n\nThe config command displays application configuration.\n',
      );
      await writeWorkspaceFile(root, 'src/flask/__init__.py', 'from .cli import config_command\n');

      const repository = createRepositoryIntelligence();
      await repository.initialize(root);
      const context = await repository.getContext(request('Add flask config'));
      const selectedPaths = context.relevantFiles.map(({ path: file }) => file);

      assert.ok(selectedPaths.includes('src/flask/cli.py'), selectedPaths.join(', '));
      assert.ok(selectedPaths.includes('tests/test_cli.py'), selectedPaths.join(', '));
      assert.ok(selectedPaths.includes('docs/cli.rst'), selectedPaths.join(', '));
      assert.ok(context.relevantFiles.every(({ reason, excerpts }) =>
        reason.length > 0 && excerpts.length > 0));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('clamps out-of-range token budget without throwing and emits a warning', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'src/main.py', 'def run():\n    pass\n');
      const repository = createRepositoryIntelligence(32000);
      await repository.initialize(root);

      const context = await repository.getContext(request('Review code'));
      assert.equal(context.tokenBudget, 20000);
      assert.ok(context.warnings.some((warning) => warning.includes('clamped to 20000')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves two-hop dependency edges independent of budget trimming', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'src/target.py', 'def base():\n    return 1\n');
      await writeWorkspaceFile(root, 'src/intermediate.py', 'import target\ndef middle():\n    return target.base()\n');
      await writeWorkspaceFile(root, 'src/outer.py', 'import intermediate\ndef outer():\n    return intermediate.middle()\n');

      const repository = createRepositoryIntelligence();
      await repository.initialize(root);

      const context = await repository.getContext(request(
        'Inspect @file:src/target.py',
        { explicitFileMentions: ['src/target.py'] },
      ));

      const edgePairs = context.dependencyEdges.map((edge) => `${edge.from}->${edge.to}`);
      assert.ok(edgePairs.includes('src/intermediate.py->src/target.py'), `expected 1-hop edge in ${edgePairs.join(', ')}`);
      assert.ok(edgePairs.includes('src/outer.py->src/intermediate.py'), `expected 2-hop edge in ${edgePairs.join(', ')}`);
      assert.ok(context.warnings.every((warning) =>
        !warning.includes('Dependency edges were truncated')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('warns with the omitted count when dependant edges exceed 200', async () => {
    const root = await createWorkspace();

    try {
      await writeWorkspaceFile(root, 'src/root.py', 'value = 1\n');
      for (let index = 0; index < 202; index += 1) {
        await writeWorkspaceFile(
          root,
          `src/dependants/dependent-${String(index).padStart(3, '0')}.py`,
          'import root\n',
        );
      }

      const repository = createRepositoryIntelligence(20000);
      await repository.initialize(root);
      const context = await repository.getContext(request(
        'Inspect @file:src/root.py',
        { explicitFileMentions: ['src/root.py'] },
      ));

      assert.equal(context.dependencyEdges.length, 200);
      assert.ok(context.warnings.some((warning) =>
        warning.includes('Dependency edges were truncated to 200') &&
        warning.includes('2 eligible edges omitted')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
