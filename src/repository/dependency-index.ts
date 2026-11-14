import path from 'node:path';
import type {
  DependencyEdge,
  UnresolvedImport,
} from '../shared/contracts';
import {
  indexWorkspacePythonFiles,
  type PythonImportRecord,
  type PythonWorkspaceIndex,
} from './python-symbol-index';
import { listWorkspaceFiles } from './workspace-scanner';
import { readWorkspaceFile } from './ripgrep-search';
import { normalizeWorkspacePath } from './path-safety';

export interface PythonExternalImport {
  file: string;
  module: string;
  line: number;
  classification: 'stdlib' | 'declared_dependency';
}

export interface PythonDependencyIndex {
  dependencyEdges: DependencyEdge[];
  unresolvedImports: UnresolvedImport[];
  externalImports: PythonExternalImport[];
  incomplete: boolean;
  warnings: string[];
}

const STANDARD_LIBRARY_MODULES = new Set([
  '__future__', 'abc', 'argparse', 'array', 'ast', 'asyncio', 'atexit',
  'base64', 'binascii', 'bisect', 'builtins', 'bz2',
  'calendar', 'cmath', 'cmd', 'code', 'codecs', 'collections',
  'concurrent', 'configparser', 'contextlib', 'copy', 'copyreg', 'csv',
  'ctypes', 'dataclasses', 'datetime', 'decimal', 'difflib', 'dis',
  'email', 'enum', 'errno', 'faulthandler', 'fcntl', 'filecmp', 'fileinput',
  'fnmatch', 'fractions', 'functools', 'gc', 'getopt', 'getpass', 'gettext',
  'glob', 'graphlib', 'gzip', 'hashlib', 'heapq', 'hmac', 'html',
  'http', 'importlib', 'inspect', 'io', 'ipaddress', 'itertools',
  'json', 'keyword', 'linecache', 'locale', 'logging', 'lzma',
  'marshal', 'math', 'mimetypes', 'multiprocessing', 'operator', 'os',
  'pathlib', 'pickle', 'pkgutil', 'platform', 'plistlib', 'pprint',
  'queue', 'random', 're', 'readline', 'reprlib', 'runpy',
  'secrets', 'select', 'selectors', 'shelve', 'shlex', 'shutil',
  'signal', 'site', 'smtplib', 'socket', 'sqlite3', 'ssl', 'stat',
  'statistics', 'string', 'stringprep', 'struct', 'subprocess', 'sys',
  'sysconfig', 'tarfile', 'tempfile', 'textwrap', 'threading', 'time',
  'timeit', 'tkinter', 'token', 'tokenize', 'tomllib', 'traceback',
  'tracemalloc', 'types', 'typing', 'unicodedata', 'unittest', 'urllib',
  'uuid', 'venv', 'warnings', 'weakref', 'xml', 'xmlrpc', 'zipfile',
  'zipimport', 'zlib',
]);

const DECLARATION_FILES = /^(?:requirements(?:[-_.][^/]*)?\.txt|pyproject\.toml|setup\.cfg|setup\.py)$/i;
const PACKAGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*/;

function normalizedPackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function parseDeclaredPackages(content: string, file: string): string[] {
  const packages: string[] = [];

  if (/^requirements(?:[-_.][^/]*)?\.txt$/i.test(path.posix.basename(file))) {
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('-')) continue;
      const packageName = PACKAGE_NAME_PATTERN.exec(line)?.[0];
      if (packageName) packages.push(packageName);
    }
    return packages;
  }

  if (file.toLowerCase().endsWith('setup.py')) {
    const declaration = /install_requires\s*=\s*\[([\s\S]*?)\]/m.exec(content);
    if (declaration) {
      for (const match of declaration[1].matchAll(/['"]([^'"]+)['"]/g)) {
        const packageName = PACKAGE_NAME_PATTERN.exec(match[1])?.[0];
        if (packageName) packages.push(packageName);
      }
    }
    return packages;
  }

  if (file.toLowerCase().endsWith('setup.cfg')) {
    let inDependencySection = false;
    for (const rawLine of content.split(/\r?\n/)) {
      const section = /^\s*\[([^\]]+)\]\s*$/.exec(rawLine)?.[1]?.toLowerCase();
      if (section) {
        inDependencySection = section === 'options' ||
          section === 'options.extras_require';
        continue;
      }
      if (!inDependencySection) continue;

      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.includes('=')) continue;
      const packageName = PACKAGE_NAME_PATTERN.exec(line)?.[0];
      if (packageName) packages.push(packageName);
    }
    return packages;
  }

  let inProjectDependencies = false;
  let inDependencyArray = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(rawLine)?.[1]?.toLowerCase();
    if (section) {
      inProjectDependencies = section === 'project' ||
        section === 'project.optional-dependencies' ||
        section.startsWith('project.optional-dependencies.');
      inDependencyArray = false;
      continue;
    }
    if (!inProjectDependencies) continue;

    if (/^\s*dependencies\s*=\s*\[/.test(rawLine)) {
      inDependencyArray = true;
    }
    if (!inDependencyArray) continue;

    for (const match of rawLine.matchAll(/['"]([^'"]+)['"]/g)) {
      const packageName = PACKAGE_NAME_PATTERN.exec(match[1])?.[0];
      if (packageName) packages.push(packageName);
    }
    if (rawLine.includes(']')) inDependencyArray = false;
  }
  return packages;
}

async function loadDeclaredPackages(root: string): Promise<Set<string>> {
  const scan = await listWorkspaceFiles(root);
  const result = new Set<string>();

  for (const file of scan.files.filter((candidate) =>
    !candidate.includes('/') && DECLARATION_FILES.test(candidate),
  )) {
    try {
      const contents = await readWorkspaceFile(root, file, 1, undefined, {
        maxLines: 10_000,
        maxCharacters: 200_000,
      });
      for (const name of parseDeclaredPackages(contents, file)) {
        result.add(normalizedPackageName(name));
      }
    } catch {
      continue;
    }
  }
  return result;
}

function modulePathParts(module: string): string[] {
  if (!module) return [];
  return module.split('.').filter(Boolean);
}

function packagePartsForFile(file: string): string[] {
  const withoutExtension = file.slice(0, -path.posix.extname(file).length);
  const parts = withoutExtension.split('/');
  parts.pop();
  return parts;
}

function resolveImportModule(
  imported: PythonImportRecord,
): { module: string; validRelative: boolean } {
  if (imported.relativeLevel === 0) {
    return { module: imported.module, validRelative: true };
  }

  const packageParts = packagePartsForFile(imported.file);
  const parentCount = imported.relativeLevel - 1;
  if (parentCount > packageParts.length) {
    return { module: '', validRelative: false };
  }

  const base = packageParts.slice(0, packageParts.length - parentCount);
  const remainder = modulePathParts(imported.module);
  return {
    module: [...base, ...remainder].join('.'),
    validRelative: true,
  };
}

function moduleFileCandidates(
  module: string,
  prefixes: string[] = [''],
): string[] {
  const parts = modulePathParts(module);
  if (parts.length === 0) {
    return prefixes.map((prefix) => [prefix, '__init__.py'].filter(Boolean).join('/'));
  }
  const modulePath = parts.join('/');
  return prefixes.flatMap((prefix) => {
    const resolvedPrefix = [prefix, modulePath].filter(Boolean).join('/');
    return [`${resolvedPrefix}.py`, `${resolvedPrefix}/__init__.py`];
  });
}

function resolveImportTargets(
  imported: PythonImportRecord,
  files: Set<string>,
): { targets: string[]; validRelative: boolean; resolvedModule: string } {
  const resolved = resolveImportModule(imported);
  if (!resolved.validRelative) {
    return { targets: [], validRelative: false, resolvedModule: '' };
  }

  const targets = new Set<string>();
  const importRoots = imported.relativeLevel === 0 ? ['', 'src'] : [''];
  for (const candidate of moduleFileCandidates(resolved.module, importRoots)) {
    if (files.has(candidate)) targets.add(candidate);
  }

  if (imported.names.length > 0) {
    for (const name of imported.names) {
      if (!name || name === '*') continue;
      const namedModule = [resolved.module, name].filter(Boolean).join('.');
      for (const candidate of moduleFileCandidates(namedModule, importRoots)) {
        if (files.has(candidate)) targets.add(candidate);
      }
    }
  }

  return {
    targets: [...targets].sort((left, right) => left.localeCompare(right)),
    validRelative: true,
    resolvedModule: resolved.module,
  };
}

function externalClassification(
  module: string,
  declaredPackages: Set<string>,
): PythonExternalImport['classification'] | undefined {
  const topLevel = module.split('.')[0];
  if (STANDARD_LIBRARY_MODULES.has(topLevel)) return 'stdlib';
  if (declaredPackages.has(normalizedPackageName(topLevel))) {
    return 'declared_dependency';
  }
  return undefined;
}

function sortUniqueEdges(edges: DependencyEdge[]): DependencyEdge[] {
  const unique = new Map<string, DependencyEdge>();
  for (const edge of edges) {
    unique.set(`${edge.from}\0${edge.to}\0${edge.kind}`, edge);
  }
  return [...unique.values()].sort((left, right) =>
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to) ||
    left.kind.localeCompare(right.kind),
  );
}

export async function analyzePythonDependencies(
  workspaceRoot: string,
  paths?: string[],
  indexedPythonFiles?: PythonWorkspaceIndex,
): Promise<PythonDependencyIndex> {
  const index = indexedPythonFiles ?? await indexWorkspacePythonFiles(workspaceRoot);
  const allPythonFiles = new Set(index.files.map((file) => file.file));
  const requested = paths?.length
    ? new Set(paths.map(normalizeWorkspacePath))
    : undefined;
  const declaredPackages = await loadDeclaredPackages(workspaceRoot);
  const dependencyEdges: DependencyEdge[] = [];
  const unresolvedImports: UnresolvedImport[] = [];
  const externalImports: PythonExternalImport[] = [];
  const unresolvedKeys = new Set<string>();
  const externalKeys = new Set<string>();

  for (const analysis of index.files) {
    for (const imported of analysis.imports) {
      const resolution = resolveImportTargets(imported, allPythonFiles);
      if (resolution.targets.length > 0) {
        for (const target of resolution.targets) {
          dependencyEdges.push({
            from: analysis.file,
            to: normalizeWorkspacePath(target),
            kind: 'imports',
            evidence: 'observed',
          });
        }
        continue;
      }

      const module = resolution.resolvedModule || imported.module;
      const external = resolution.validRelative
        ? externalClassification(module, declaredPackages)
        : undefined;

      if (external) {
        const key = `${analysis.file}\0${module}`;
        if (!externalKeys.has(key)) {
          externalKeys.add(key);
          externalImports.push({
            file: analysis.file,
            module,
            line: imported.line,
            classification: external,
          });
        }
      } else {
        const key = `${analysis.file}\0${module}`;
        if (!unresolvedKeys.has(key)) {
          unresolvedKeys.add(key);
          unresolvedImports.push({ file: analysis.file, module });
        }
      }
    }
  }

  const filteredEdges = sortUniqueEdges(dependencyEdges).filter((edge) =>
    !requested || requested.has(edge.from) || requested.has(edge.to),
  );
  unresolvedImports.sort((left, right) =>
    left.file.localeCompare(right.file) || left.module.localeCompare(right.module),
  );
  externalImports.sort((left, right) =>
    left.file.localeCompare(right.file) ||
    left.module.localeCompare(right.module) ||
    left.line - right.line,
  );

  return {
    dependencyEdges: filteredEdges,
    unresolvedImports,
    externalImports,
    incomplete: index.incomplete,
    warnings: index.warnings,
  };
}

export async function getPythonDependencies(
  workspaceRoot: string,
  paths?: string[],
): Promise<DependencyEdge[]> {
  return (await analyzePythonDependencies(workspaceRoot, paths)).dependencyEdges;
}
