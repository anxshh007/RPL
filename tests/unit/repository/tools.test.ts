import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRepositoryIntelligence } from '../../../src/repository/index';
import type {
  ChangeRequest,
  RepositoryContext,
  RepositoryIntelligence,
  SearchResult,
  SymbolRecord,
} from '../../../src/shared/contracts';
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

function isSafeError(
  result: unknown,
): result is { kind: string; message: string; retryable: boolean } {
  return typeof result === 'object' && result !== null &&
    'kind' in result && 'message' in result && 'retryable' in result;
}

function repository(
  overrides: Partial<RepositoryIntelligence> = {},
): RepositoryIntelligence {
  return {
    initialize: async () => {},
    search: async () => [],
    readFile: async () => '',
    findSymbol: async () => [],
    getContext: async (request): Promise<RepositoryContext> => ({
      requestId: request.requestId,
      relevantFiles: [],
      relevantSymbols: [],
      dependencyEdges: [],
      unresolvedImports: [],
      tokenEstimate: 0,
      tokenBudget: 16000,
      budgetConflicts: [],
      warnings: [],
    }),
    getDependencies: async () => [],
    invalidate: () => {},
    reindex: async () => {},
    ...overrides,
  };
}

const request: ChangeRequest = {
  requestId: 'tool-test',
  instruction: 'Find relevant context',
  mode: 'agent',
  explicitFileMentions: [],
  explicitSymbolMentions: [],
};

describe('repository tool handlers', () => {
  it('searches with validated query and optional limit', async () => {
    const expected: SearchResult[] = [{ path: 'src/app.ts', line: 2, text: 'match' }];
    let received: [string, number | undefined] | undefined;
    const result = await handleSearchWorkspace(repository({
      search: async (query, limit) => {
        received = [query, limit];
        return expected;
      },
    }), { query: ' match ', limit: 12 });

    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, expected);
    assert.deepEqual(received, ['match', 12]);
  });

  it('rejects invalid search inputs', async () => {
    const service = repository();
    for (const input of [{ query: '' }, { query: 'x', limit: 0 }, { query: 'x', limit: 1001 }]) {
      const result = await handleSearchWorkspace(service, input);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.kind, 'validation');
    }
  });

  it('reads safe workspace-relative paths with an optional line range', async () => {
    let received: [string, number | undefined, number | undefined] | undefined;
    const result = await handleReadFile(repository({
      readFile: async (path, startLine, endLine) => {
        received = [path, startLine, endLine];
        return 'content';
      },
    }), { path: 'src\\app.py', startLine: 3, endLine: 5 });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.content, 'content');
    assert.deepEqual(received, ['src/app.py', 3, 5]);
  });

  it('rejects unsafe paths and invalid line ranges', async () => {
    const service = repository();
    for (const input of [
      { path: '../outside.txt' },
      { path: 'src/app.py', startLine: 0 },
      { path: 'src/app.py', startLine: 5, endLine: 4 },
    ]) {
      const result = await handleReadFile(service, input);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.kind, 'validation');
    }
  });

  it('finds symbols by exact name and normalized optional file hint', async () => {
    const expected: SymbolRecord[] = [{
      name: 'build_app',
      kind: 'function',
      file: 'src/app.py',
      startLine: 1,
      endLine: 2,
    }];
    let received: [string, string | undefined] | undefined;
    const result = await handleFindSymbol(repository({
      findSymbol: async (name, hint) => {
        received = [name, hint];
        return expected;
      },
    }), { name: ' build_app ', fileHint: 'src\\app.py' });

    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, expected);
    assert.deepEqual(received, ['build_app', 'src/app.py']);
  });

  it('rejects invalid symbol inputs', async () => {
    const service = repository();
    for (const input of [
      { name: '' },
      { name: 'build_app', fileHint: '../outside.py' },
      { name: 'build_app', fileHint: 42 },
    ]) {
      const result = await handleFindSymbol(service, input);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.kind, 'validation');
    }
  });

  it('returns repository context and sanitizes unresolved mention warnings', async () => {
    const expected: RepositoryContext = {
      requestId: request.requestId,
      relevantFiles: [],
      relevantSymbols: [],
      dependencyEdges: [],
      unresolvedImports: [],
      tokenEstimate: 0,
      tokenBudget: 16000,
      budgetConflicts: [],
      warnings: ['Explicit file mention could not be resolved: C:\\private\\secret.py'],
    };
    let received: ChangeRequest | undefined;
    const result = await handleGetRepositoryContext(repository({
      getContext: async (value) => {
        received = value;
        return expected;
      },
    }), request);

    assert.deepEqual(received, request);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value.warnings, ['An explicit file mention could not be resolved.']);
      assert.ok(!JSON.stringify(result.value).includes('C:\\private'));
    }
  });

  it('rejects malformed or unsafe repository-context requests', async () => {
    const service = repository();
    for (const input of [
      { ...request, mode: 'invalid' },
      { ...request, explicitFileMentions: [4] },
      { ...request, activeFile: 'C:\\private\\secret.py' },
    ]) {
      const result = await handleGetRepositoryContext(service, input);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.kind, 'validation');
    }
  });

  it('returns sanitized SafeErrors when any repository operation fails', async () => {
    const failure = () => {
      throw new Error('API_KEY=top-secret at C:\\private\\repo');
    };
    const results = await Promise.all([
      handleSearchWorkspace(repository({ search: async () => failure() }), { query: 'needle' }),
      handleReadFile(repository({ readFile: async () => failure() }), { path: 'src/app.py' }),
      handleFindSymbol(repository({ findSymbol: async () => failure() }), { name: 'build_app' }),
      handleGetRepositoryContext(repository({ getContext: async () => failure() }), request),
    ]);

    for (const result of results) {
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(isSafeError(result.error));
        assert.equal(result.error.kind, 'internal');
        assert.equal(result.error.message, 'Repository operation failed.');
        assert.equal(result.error.retryable, false);
        assert.ok(!JSON.stringify(result).includes('top-secret'));
        assert.ok(!JSON.stringify(result).includes('C:\\private'));
      }
    }
  });
});
