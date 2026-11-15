import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChangeRequest, ContextFile } from '../../../src/shared/contracts';
import { createRepositoryIntelligence } from '../../../src/repository/index';
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
});

describe('repository context intelligence', () => {
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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
