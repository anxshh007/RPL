
import {
  lstat,
  readdir,
  realpath,
  open,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  isSensitiveWorkspaceFile,
  normalizeWorkspacePath,
} from './path-safety';

export interface WorkspaceScanOptions {
  maxFiles?: number;
  maxFileSizeBytes?: number;
  maxDurationMs?: number;
}

export interface WorkspaceScanResult {
  files: string[];
  warnings: string[];
  incomplete: boolean;
}

const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_MAX_FILE_SIZE = 1_000_000;
const DEFAULT_MAX_DURATION_MS = 15_000;
const GIT_IGNORE_TIMEOUT_MS = 2_000;

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'out',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  'target',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.idea',
  '.vscode-test',
]);

const IGNORED_FILE_NAMES = new Set([
  '.ds_store',
  'thumbs.db',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.pdf', '.zip', '.gz', '.tar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.wav', '.avi',
  '.woff', '.woff2', '.ttf', '.otf',
  '.class', '.jar', '.pyc', '.pyo',
  '.sqlite', '.db',
]);

const GENERATED_SUFFIXES = [
  '.min.js',
  '.min.css',
  '.map',
];

interface IgnoreRule {
  base: string;
  pattern: string;
  negated: boolean;
  directoryOnly: boolean;
  regex: RegExp;
}

function globToRegExp(pattern: string): RegExp {
  let result = '';

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];

    if (char === '*' && pattern[i + 1] === '*') {
      result += '.*';
      i += 1;
    } else if (char === '*') {
      result += '[^/]*';
    } else if (char === '?') {
      result += '[^/]';
    } else {
      result += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }

  return new RegExp(`^${result}$`);
}

function parseIgnoreRules(
  content: string,
  base: string,
): IgnoreRule[] {
  const rules: IgnoreRule[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) continue;

    const negated = line.startsWith('!');
    let pattern = negated ? line.slice(1) : line;

    if (!pattern) continue;

    const directoryOnly = pattern.endsWith('/');
    if (directoryOnly) pattern = pattern.slice(0, -1);

    const anchored = pattern.startsWith('/');
    if (anchored) pattern = pattern.slice(1);

    if (!pattern) continue;

    // An unanchored pattern without a slash can match any path segment.
    const hasSlash = pattern.includes('/');
    const regex = globToRegExp(pattern);

    rules.push({
      base,
      pattern: `${anchored ? 'anchored:' : ''}${hasSlash ? 'path:' : 'segment:'}${pattern}`,
      negated,
      directoryOnly,
      regex,
    });
  }

  return rules;
}

async function loadIgnoreRules(
  directory: string,
  root: string,
  inherited: IgnoreRule[],
): Promise<IgnoreRule[]> {
  const relativeDirectory = path.relative(root, directory)
    .split(path.sep)
    .join('/');

  const ignoreFile = path.join(directory, '.gitignore');

  try {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(ignoreFile, 'utf8');

    return [
      ...inherited,
      ...parseIgnoreRules(content, relativeDirectory),
    ];
  } catch {
    return inherited;
  }
}

function isFallbackIgnored(
  relativePath: string,
  isDirectory: boolean,
  rules: IgnoreRule[],
): boolean {
  let ignored = false;

  for (const rule of rules) {
    const anchored = rule.pattern.startsWith('anchored:');
    const hasSlash = rule.pattern.startsWith('anchored:path:')
      || rule.pattern.startsWith('path:')
      || anchored;

    const ruleBase = rule.base;
    let candidate = relativePath;

    if (ruleBase) {
      if (relativePath !== ruleBase &&
          !relativePath.startsWith(`${ruleBase}/`)) {
        continue;
      }

      candidate = relativePath === ruleBase
        ? ''
        : relativePath.slice(ruleBase.length + 1);
    }

    if (!candidate) continue;

    const segments = candidate.split('/');
    let matches = false;

    if (rule.directoryOnly) {
      const prefixes = isDirectory
        ? segments.map((_, index) => segments.slice(0, index + 1).join('/'))
        : segments.slice(0, -1).map((_, index) =>
            segments.slice(0, index + 1).join('/'),
          );

      matches = prefixes.some((prefix) => {
        if (hasSlash) return rule.regex.test(prefix);
        return prefix.split('/').some((segment) => rule.regex.test(segment));
      });
    } else if (hasSlash) {
      matches = rule.regex.test(candidate);
    } else {
      matches = segments.some((segment) => rule.regex.test(segment));
    }

    if (matches) ignored = !rule.negated;
  }

  return ignored;
}

function checkIgnoredWithGit(
  root: string,
  relativePaths: string[],
): Promise<Set<string> | null> {
  if (relativePaths.length === 0) {
    return Promise.resolve(new Set());
  }

  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    let failed = false;

    const child = spawn(
      'git',
      ['check-ignore', '--no-index', '--stdin', '-z'],
      {
        cwd: root,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );

    const finish = (result: Set<string> | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      failed = true;
      child.kill();
      finish(null);
    }, GIT_IGNORE_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });

    child.on('error', () => {
      finish(null);
    });

    child.on('close', (code) => {
      if (failed || (code !== 0 && code !== 1)) {
        finish(null);
        return;
      }

      const ignored = new Set(
        output.split('\0').filter(Boolean),
      );

      finish(ignored);
    });

    child.stdin.on('error', () => {
      finish(null);
    });

    child.stdin.end(`${relativePaths.join('\0')}\0`);
  });
}

function isGeneratedFile(fileName: string): boolean {
  const name = fileName.toLowerCase();

  return (
    GENERATED_SUFFIXES.some((suffix) => name.endsWith(suffix)) ||
    /\.generated\.[^.]+$/.test(name)
  );
}

async function isBinaryFile(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);

    for (let i = 0; i < bytesRead; i += 1) {
      if (buffer[i] === 0) return true;
    }

    return false;
  } finally {
    await handle.close();
  }
}

export async function listWorkspaceFiles(
  workspaceRoot: string,
  options: WorkspaceScanOptions = {},
): Promise<WorkspaceScanResult> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileSizeBytes =
    options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
  const maxDurationMs =
    options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;

  if (
    !Number.isInteger(maxFiles) ||
    maxFiles < 1 ||
    !Number.isFinite(maxFileSizeBytes) ||
    maxFileSizeBytes < 0 ||
    !Number.isFinite(maxDurationMs) ||
    maxDurationMs < 1
  ) {
    throw new Error('Invalid workspace scan limits.');
  }

  const root = await realpath(workspaceRoot);
  const files: string[] = [];
  const warnings: string[] = [];
  const startedAt = Date.now();

  let incomplete = false;
  let gitIgnoreUnavailable = false;

  async function visit(
    directory: string,
    inheritedRules: IgnoreRule[],
  ): Promise<void> {
    if (incomplete) return;

    if (Date.now() - startedAt >= maxDurationMs) {
      warnings.push('Workspace scan stopped because the time limit was reached.');
      incomplete = true;
      return;
    }

    const rules = await loadIgnoreRules(
      directory,
      root,
      inheritedRules,
    );

    let entries;

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      warnings.push(
        `Could not read directory: ${path.relative(root, directory)}`,
      );
      return;
    }

    const candidates = entries
      .filter((entry) => !entry.isSymbolicLink())
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .filter((entry) => {
        if (entry.isDirectory()) {
          return (
            !entry.name.startsWith('.') &&
            !IGNORED_DIRECTORIES.has(entry.name)
          );
        }

        return (
          entry.name.toLowerCase() !== '.gitignore' &&
          !isSensitiveWorkspaceFile(entry.name) &&
          !isGeneratedFile(entry.name) &&
          !IGNORED_FILE_NAMES.has(entry.name.toLowerCase()) &&
          !BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        );
      });

    const candidatePaths = candidates.map((entry) =>
      path.relative(
        root,
        path.join(directory, entry.name),
      ).split(path.sep).join('/'),
    );

    const gitIgnored = gitIgnoreUnavailable
      ? null
      : await checkIgnoredWithGit(root, candidatePaths);

    if (gitIgnored === null && !gitIgnoreUnavailable) {
      gitIgnoreUnavailable = true;
      warnings.push(
        'Git ignore engine unavailable; using basic .gitignore fallback.',
      );
    }

    for (let index = 0; index < candidates.length; index += 1) {
      if (incomplete) return;

      if (Date.now() - startedAt >= maxDurationMs) {
        warnings.push('Workspace scan stopped because the time limit was reached.');
        incomplete = true;
        return;
      }

      const entry = candidates[index];
      const relativePath = candidatePaths[index];
      const absolutePath = path.join(directory, entry.name);

      const ignored = gitIgnored !== null
        ? gitIgnored.has(relativePath)
        : isFallbackIgnored(
            relativePath,
            entry.isDirectory(),
            rules,
          );

      if (ignored) continue;

      if (entry.isDirectory()) {
        await visit(absolutePath, rules);
        continue;
      }

      try {
        const metadata = await lstat(absolutePath);

        if (
          !metadata.isFile() ||
          metadata.size > maxFileSizeBytes
        ) {
          continue;
        }

        if (await isBinaryFile(absolutePath)) continue;

        files.push(normalizeWorkspacePath(relativePath));

        if (files.length >= maxFiles) {
          warnings.push(
            'Workspace scan stopped because the file limit was reached.',
          );
          incomplete = true;
          return;
        }
      } catch {
        warnings.push(`Could not inspect file: ${relativePath}`);
      }
    }
  }

  await visit(root, []);

  files.sort((a, b) => a.localeCompare(b));

  return {
    files,
    warnings,
    incomplete,
  };
}
