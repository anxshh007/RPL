import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRepositoryIntelligence } from '../../../src/repository/index';
import {
  createRepositoryToolHandlers,
  handleFindSymbol,
  handleGetRepositoryContext,
  handleReadFile,
  handleSearchWorkspace,
  REPOSITORY_TOOL_DEFINITIONS,
  validateFindSymbolInput,
  validateGetRepositoryContextInput,
  validateReadFileInput,
  validateSearchWorkspaceInput,
} from '../../../src/repository/tools';
import { TOOL_NAMES } from '../../../src/mcp/tool-names';

async function createWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'repopilot-tools-'));
}

async function writeWorkspaceFile(root: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

describe('repository MCP tools', () => {
  it('exposes tool definitions with valid schemas', () => {
    assert.equal(REPOSITORY_TOOL_DEFINITIONS.length, 4);
    const names = REPOSITORY_TOOL_DEFINITIONS.map((def) => def.name);
    assert.ok(names.includes(TOOL_NAMES.searchWorkspace));
    assert.ok(names.includes(TOOL_NAMES.readFile));
    assert.ok(names.includes(TOOL_NAMES.findSymbol));
    assert.ok(names.includes(TOOL_NAMES.getRepositoryContext));
  });

  describe('input validators', () => {
    it('validates search_workspace input', () => {
      const valid = validateSearchWorkspaceInput({ query: 'hello', limit: 10 });
      assert.equal(valid.ok, true);
      if (valid.ok) {
        assert.equal(valid.value.query, 'hello');
        assert.equal(valid.value.limit, 10);
      }

      const invalid = validateSearchWorkspaceInput({ query: '' });
      assert.equal(invalid.ok, false);
      if (!invalid.ok) {
        assert.equal(invalid.error.kind, 'validation');
      }
    });

    it('validates read_file input supporting both filePath and path', () => {
      const valid1 = validateReadFileInput({ filePath: 'src/main.py', startLine: 1, endLine: 5 });
      assert.equal(valid1.ok, true);
      if (valid1.ok) {
        assert.equal(valid1.value.filePath, 'src/main.py');
        assert.equal(valid1.value.startLine, 1);
        assert.equal(valid1.value.endLine, 5);
      }

      const valid2 = validateReadFileInput({ path: 'src/helper.py' });
      assert.equal(valid2.ok, true);
      if (valid2.ok) {
        assert.equal(valid2.value.filePath, 'src/helper.py');
      }

      const invalid = validateReadFileInput({});
      assert.equal(invalid.ok, false);
      if (!invalid.ok) {
        assert.equal(invalid.error.kind, 'validation');
      }
    });

    it('validates find_symbol input', () => {
      const valid = validateFindSymbolInput({ name: 'my_func', fileHint: 'src/a.py' });
      assert.equal(valid.ok, true);
      if (valid.ok) {
        assert.equal(valid.value.name, 'my_func');
        assert.equal(valid.value.fileHint, 'src/a.py');
      }

      const invalid = validateFindSymbolInput({ name: '' });
      assert.equal(invalid.ok, false);
      if (!invalid.ok) {
        assert.equal(invalid.error.kind, 'validation');
      }
    });

    it('validates get_repository_context input', () => {
      const valid = validateGetRepositoryContextInput({
        request: {
          requestId: 'req-1',
          instruction: 'Fix bugs',
          mode: 'agent',
          explicitFileMentions: [],
          explicitSymbolMentions: [],
        },
      });
      assert.equal(valid.ok, true);

      const invalid = validateGetRepositoryContextInput({ request: { mode: 'invalid' } });
      assert.equal(invalid.ok, false);
      if (!invalid.ok) {
        assert.equal(invalid.error.kind, 'validation');
      }
    });
  });

  describe('tool handlers execution', () => {
    it('executes search_workspace, read_file, find_symbol, and get_repository_context', async () => {
      const root = await createWorkspace();

      try {
        await writeWorkspaceFile(
          root,
          'src/service.py',
          'def calculate_tax(amount):\n    return amount * 0.2\n',
        );

        const repository = createRepositoryIntelligence();
        await repository.initialize(root);

        const handlers = createRepositoryToolHandlers(repository);

        // search_workspace
        const searchRes = await handlers[TOOL_NAMES.searchWorkspace]({ query: 'calculate_tax' });
        assert.equal(searchRes.ok, true);
        if (searchRes.ok) {
          assert.ok(searchRes.value.length > 0);
          assert.equal(searchRes.value[0].path, 'src/service.py');
        }

        // read_file
        const readRes = await handlers[TOOL_NAMES.readFile]({ filePath: 'src/service.py', startLine: 1, endLine: 1 });
        assert.equal(readRes.ok, true);
        if (readRes.ok) {
          assert.ok(readRes.value.content.includes('def calculate_tax'));
          assert.equal(readRes.value.startLine, 1);
        }

        // find_symbol
        const symbolRes = await handlers[TOOL_NAMES.findSymbol]({ name: 'calculate_tax' });
        assert.equal(symbolRes.ok, true);
        if (symbolRes.ok) {
          assert.equal(symbolRes.value.length, 1);
          assert.equal(symbolRes.value[0].name, 'calculate_tax');
        }

        // get_repository_context
        const contextRes = await handlers[TOOL_NAMES.getRepositoryContext]({
          request: {
            requestId: 'ctx-1',
            instruction: 'Add tax test',
            mode: 'agent',
            explicitFileMentions: ['src/service.py'],
            explicitSymbolMentions: ['calculate_tax'],
          },
        });
        assert.equal(contextRes.ok, true);
        if (contextRes.ok) {
          assert.equal(contextRes.value.requestId, 'ctx-1');
          assert.ok(contextRes.value.relevantFiles.some((f) => f.path === 'src/service.py'));
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('honours AbortSignal cancellation returning cancelled error', async () => {
      const repository = createRepositoryIntelligence();
      const controller = new AbortController();
      controller.abort();

      const searchRes = await handleSearchWorkspace(repository, { query: 'any' }, controller.signal);
      assert.equal(searchRes.ok, false);
      if (!searchRes.ok) {
        assert.equal(searchRes.error.kind, 'cancelled');
      }

      const readRes = await handleReadFile(repository, { filePath: 'a.py' }, controller.signal);
      assert.equal(readRes.ok, false);
      if (!readRes.ok) {
        assert.equal(readRes.error.kind, 'cancelled');
      }

      const symbolRes = await handleFindSymbol(repository, { name: 'sym' }, controller.signal);
      assert.equal(symbolRes.ok, false);
      if (!symbolRes.ok) {
        assert.equal(symbolRes.error.kind, 'cancelled');
      }

      const contextRes = await handleGetRepositoryContext(
        repository,
        {
          request: {
            requestId: '1',
            instruction: 'test',
            mode: 'agent',
            explicitFileMentions: [],
            explicitSymbolMentions: [],
          },
        },
        controller.signal,
      );
      assert.equal(contextRes.ok, false);
      if (!contextRes.ok) {
        assert.equal(contextRes.error.kind, 'cancelled');
      }
    });
  });
});
