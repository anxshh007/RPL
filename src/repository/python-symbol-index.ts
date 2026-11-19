import { createRequire } from 'node:module';
import path from 'node:path';
import type { Node as SyntaxNode } from '@vscode/tree-sitter-wasm';
import type { SymbolRecord } from '../shared/contracts';
import { listWorkspaceFiles } from './workspace-scanner';
import { readWorkspaceFile } from './ripgrep-search';
import { normalizeWorkspacePath } from './path-safety';

export interface PythonImportRecord {
  file: string;
  module: string;
  names: string[];
  relativeLevel: number;
  line: number;
}

export type PythonParseStatus = 'complete' | 'partial' | 'fallback';

export interface PythonFileAnalysis {
  file: string;
  symbols: SymbolRecord[];
  imports: PythonImportRecord[];
  status: PythonParseStatus;
  warnings: string[];
}

export interface PythonParseOptions {
  forceFallback?: boolean;
}

export interface PythonWorkspaceIndex {
  files: PythonFileAnalysis[];
  incomplete: boolean;
  warnings: string[];
}

interface TreeSitterRuntime {
  Parser: typeof import('@vscode/tree-sitter-wasm').Parser;
  language: import('@vscode/tree-sitter-wasm').Language;
}

const moduleRequire = createRequire(
  typeof __filename === 'string'
    ? __filename
    : path.join(process.cwd(), 'package.json'),
);
const MAX_INDEX_LINES = 100_000;
const MAX_INDEX_CHARACTERS = 1_000_000;
const symbolNamePattern = /^[A-Za-z_]\w*$/;

let treeSitterRuntimePromise: Promise<TreeSitterRuntime | null> | undefined;

async function loadTreeSitterRuntime(): Promise<TreeSitterRuntime | null> {
  try {
    const treeSitter = moduleRequire(
      '@vscode/tree-sitter-wasm',
    ) as typeof import('@vscode/tree-sitter-wasm');
    await treeSitter.Parser.init();
    const wasmDirectory = path.dirname(
      moduleRequire.resolve('@vscode/tree-sitter-wasm'),
    );
    const language = await treeSitter.Language.load(
      path.join(wasmDirectory, 'tree-sitter-python.wasm'),
    );

    return { Parser: treeSitter.Parser, language };
  } catch {
    return null;
  }
}

function getTreeSitterRuntime(): Promise<TreeSitterRuntime | null> {
  treeSitterRuntimePromise ??= loadTreeSitterRuntime();
  return treeSitterRuntimePromise;
}

function endLineForNode(node: SyntaxNode): number {
  const { row, column } = node.endPosition;
  return Math.max(node.startPosition.row + 1, row + (column > 0 ? 1 : 0));
}

function importName(node: SyntaxNode): string {
  const nameNode = node.childForFieldName('name');
  return (nameNode?.text ?? node.text).trim();
}

function appendTreeSitterImports(
  node: SyntaxNode,
  source: string,
  file: string,
  imports: PythonImportRecord[],
): void {
  if (node.hasError) return;

  if (node.type === 'import_statement') {
    const sourceLine = source.split(/\r?\n/)[node.startPosition.row] ?? '';
    if (!/^\s*import\s+[A-Za-z_]/.test(sourceLine)) return;

    for (const child of node.namedChildren) {
      if (!child || !['aliased_import', 'dotted_name'].includes(child.type)) continue;
      const module = importName(child);
      if (module) {
        imports.push({
          file,
          module,
          names: [],
          relativeLevel: 0,
          line: node.startPosition.row + 1,
        });
      }
    }
    return;
  }

  if (node.type === 'import_from_statement' ||
      node.type === 'future_import_statement') {
    const sourceLine = source.split(/\r?\n/)[node.startPosition.row] ?? '';
    if (!/^\s*from\s+(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|\.{1,}[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|\.{1,})\s+import\b/.test(sourceLine)) {
      return;
    }

    const moduleNode = node.childForFieldName('module_name');
    const module = moduleNode?.text ??
      (node.type === 'future_import_statement' ? '__future__' : '');
    const names = node.namedChildren
      .filter((child): child is SyntaxNode =>
        Boolean(child && child !== moduleNode &&
          ['aliased_import', 'dotted_name', 'wildcard_import'].includes(child.type)),
      )
      .map(importName)
      .filter(Boolean);

    imports.push({
      file,
      module,
      names,
      relativeLevel: module.length - module.replace(/^\.+/, '').length,
      line: node.startPosition.row + 1,
    });
    return;
  }

  for (const child of node.namedChildren) {
    if (child) appendTreeSitterImports(child, source, file, imports);
  }
}

function extractTreeSitterAnalysis(
  source: string,
  file: string,
  runtime: TreeSitterRuntime,
): PythonFileAnalysis {
  const parser = new runtime.Parser();
  parser.setLanguage(runtime.language);

  try {
    const tree = parser.parse(source);
    if (!tree) {
      return {
        file,
        symbols: [],
        imports: [],
        status: 'partial',
        warnings: ['Tree-sitter did not return a syntax tree.'],
      };
    }

    try {
      const symbols: SymbolRecord[] = [];
      const imports: PythonImportRecord[] = [];

      function visit(
        node: SyntaxNode,
        parent?: { name: string; kind: 'class' | 'function' },
      ): void {
        if (node.type === 'import_statement' ||
            node.type === 'import_from_statement' ||
            node.type === 'future_import_statement') {
          appendTreeSitterImports(node, source, file, imports);
          return;
        }

        let nextParent = parent;
        if (node.type === 'class_definition' ||
            node.type === 'function_definition') {
          const name = node.childForFieldName('name')?.text;
          if (name) {
            const isClass = node.type === 'class_definition';
            const kind = isClass ? 'class' : parent?.kind === 'class' ? 'method' : 'function';
            symbols.push({
              name,
              kind,
              file,
              startLine: node.startPosition.row + 1,
              endLine: endLineForNode(node),
              ...(parent ? { parent: parent.name } : {}),
            });
            nextParent = { name, kind: isClass ? 'class' : 'function' };
          }
        }

        for (const child of node.namedChildren) {
          if (child) visit(child, nextParent);
        }
      }

      visit(tree.rootNode);
      const partial = tree.rootNode.hasError;
      const warnings: string[] = [];
      if (partial) {
        const fallback = extractFallbackAnalysis(source, file);
        const symbolKeys = new Set(
          symbols.map((symbol) => `${symbol.kind}:${symbol.name}:${symbol.startLine}`),
        );
        for (const symbol of fallback.symbols) {
          const key = `${symbol.kind}:${symbol.name}:${symbol.startLine}`;
          if (!symbolKeys.has(key)) {
            symbols.push(symbol);
            symbolKeys.add(key);
          }
        }

        const importKeys = new Set(
          imports.map((entry) => `${entry.line}:${entry.module}:${entry.names.join(',')}`),
        );
        for (const entry of fallback.imports) {
          const key = `${entry.line}:${entry.module}:${entry.names.join(',')}`;
          if (!importKeys.has(key)) {
            imports.push(entry);
            importKeys.add(key);
          }
        }
        warnings.push('Python source contains syntax errors; Tree-sitter results may be incomplete.');
        warnings.push('Heuristic extraction supplemented declarations not recovered by Tree-sitter.');
      }

      symbols.sort((left, right) =>
        left.startLine - right.startLine ||
        left.endLine - right.endLine ||
        left.name.localeCompare(right.name) ||
        left.kind.localeCompare(right.kind),
      );
      imports.sort((left, right) =>
        left.line - right.line || left.module.localeCompare(right.module),
      );

      return {
        file,
        symbols,
        imports,
        status: partial ? 'partial' : 'complete',
        warnings,
      };
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }
}

function indentationWidth(line: string): number {
  let width = 0;
  for (const character of line) {
    if (character === ' ') width += 1;
    else if (character === '\t') width += 8 - (width % 8);
    else break;
  }
  return width;
}

function parseFallbackImports(
  line: string,
  file: string,
  lineNumber: number,
): PythonImportRecord[] {
  const direct = /^\s*import\s+(.+?)\s*(?:#.*)?$/.exec(line);
  if (direct) {
    return direct[1].split(',').flatMap((rawName) => {
      const module = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/.exec(rawName.trim())?.[1];
      return module
        ? [{ file, module, names: [], relativeLevel: 0, line: lineNumber }]
        : [];
    });
  }

  const from = /^\s*from\s+([.]*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|[.]+)\s+import\s+(.+?)\s*(?:#.*)?$/.exec(line);
  if (!from) return [];

  const module = from[1];
  const names = from[2]
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .split(',')
    .map((name) => name.trim().replace(/\s+as\s+.*$/, ''))
    .filter((name) => name === '*' || symbolNamePattern.test(name));

  return [{
    file,
    module,
    names,
    relativeLevel: module.length - module.replace(/^\.+/, '').length,
    line: lineNumber,
  }];
}

function fallbackEndLine(lines: string[], startIndex: number, indent: number): number {
  let end = startIndex;

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (indentationWidth(lines[index]) <= indent) break;
    end = index;
  }

  return end + 1;
}

function extractFallbackAnalysis(source: string, file: string): PythonFileAnalysis {
  const lines = source.split(/\r?\n/);
  const symbols: SymbolRecord[] = [];
  const imports: PythonImportRecord[] = [];
  const scopes: Array<{ name: string; kind: 'class' | 'function'; indent: number }> = [];

  lines.forEach((line, index) => {
    const commentless = line.replace(/\s+#.*$/, '');
    const indent = indentationWidth(commentless);
    while (scopes.length > 0 && indent <= scopes[scopes.length - 1].indent) {
      scopes.pop();
    }

    imports.push(...parseFallbackImports(commentless, file, index + 1));

    const declaration = /^\s*(?:(?:async)\s+)?(def|class)\s+([A-Za-z_]\w*)\b/.exec(commentless);
    if (!declaration) return;

    const [, declarationKind, name] = declaration;
    const parent = scopes[scopes.length - 1];
    const kind = declarationKind === 'class'
      ? 'class'
      : parent?.kind === 'class' ? 'method' : 'function';

    symbols.push({
      name,
      kind,
      file,
      startLine: index + 1,
      endLine: fallbackEndLine(lines, index, indent),
      ...(parent ? { parent: parent.name } : {}),
    });
    scopes.push({
      name,
      kind: declarationKind === 'class' ? 'class' : 'function',
      indent,
    });
  });

  return {
    file,
    symbols,
    imports,
    status: 'fallback',
    warnings: ['Tree-sitter unavailable; Python symbols and imports were extracted heuristically.'],
  };
}

export async function parsePythonSource(
  source: string,
  inputPath: string,
  options: PythonParseOptions = {},
): Promise<PythonFileAnalysis> {
  const file = normalizeWorkspacePath(inputPath);
  if (!file.toLowerCase().endsWith('.py')) {
    throw new Error('Python analysis requires a .py file path.');
  }

  if (options.forceFallback) {
    return extractFallbackAnalysis(source, file);
  }

  const runtime = await getTreeSitterRuntime();
  if (!runtime) {
    return extractFallbackAnalysis(source, file);
  }

  try {
    return extractTreeSitterAnalysis(source, file, runtime);
  } catch {
    const fallback = extractFallbackAnalysis(source, file);
    return {
      ...fallback,
      warnings: [
        'Tree-sitter parsing failed; heuristic Python symbol extraction was used.',
      ],
    };
  }
}

export async function indexWorkspacePythonFiles(
  workspaceRoot: string,
): Promise<PythonWorkspaceIndex> {
  const scan = await listWorkspaceFiles(workspaceRoot);
  const files: PythonFileAnalysis[] = [];
  const warnings = [...scan.warnings];

  for (const file of scan.files.filter((candidate) => candidate.toLowerCase().endsWith('.py'))) {
    try {
      const analysis = await indexWorkspacePythonFile(workspaceRoot, file);
      files.push(analysis);
      warnings.push(...analysis.warnings.map((warning) => `${file}: ${warning}`));
    } catch {
      warnings.push(`${file}: Python file could not be indexed safely.`);
    }
  }

  return {
    files,
    incomplete: scan.incomplete || files.some((file) => file.status !== 'complete'),
    warnings,
  };
}

export async function indexWorkspacePythonFile(
  workspaceRoot: string,
  inputPath: string,
): Promise<PythonFileAnalysis> {
  const file = normalizeWorkspacePath(inputPath);
  if (!file.toLowerCase().endsWith('.py')) {
    throw new Error('Python analysis requires a .py file path.');
  }

  const content = await readWorkspaceFile(
    workspaceRoot,
    file,
    1,
    undefined,
    {
      maxLines: MAX_INDEX_LINES,
      maxCharacters: MAX_INDEX_CHARACTERS,
    },
  );
  const truncated = /\n\[(?:Excerpt truncated\.|Output limited to \d+ lines\.)\]$/.test(content);
  const source = truncated
    ? content.replace(/\n\[(?:Excerpt truncated\.|Output limited to \d+ lines\.)\]$/, '')
    : content;
  const analysis = await parsePythonSource(source, file);

  if (truncated) {
    analysis.status = 'partial';
    analysis.warnings.push('Python file exceeded the indexing read limit; trailing source was omitted.');
  }
  return analysis;
}

export async function findPythonSymbols(
  workspaceRoot: string,
  name: string,
  fileHint?: string,
): Promise<SymbolRecord[]> {
  const normalizedHint = fileHint ? normalizeWorkspacePath(fileHint) : undefined;
  if (normalizedHint && !normalizedHint.toLowerCase().endsWith('.py')) return [];

  const index = await indexWorkspacePythonFiles(workspaceRoot);
  return index.files
    .filter((file) => !normalizedHint || file.file === normalizedHint)
    .flatMap((file) => file.symbols)
    .filter((symbol) => symbol.name === name);
}
