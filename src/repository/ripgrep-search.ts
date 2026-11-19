import { spawn } from 'node:child_process';
import { open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { SearchResult } from '../shared/contracts';
import { listWorkspaceFiles } from './workspace-scanner';
import { normalizeWorkspacePath, resolveWorkspacePath } from './path-safety';

export interface WorkspaceSearchOptions {
  rgPath?: string;
  maxDurationMs?: number;
  maxFileSizeBytes?: number;
  maxExcerptLength?: number;
}

export interface WorkspaceReadOptions {
  maxFileSizeBytes?: number;
  maxLines?: number;
  maxCharacters?: number;
}

const DEFAULT_SEARCH_LIMIT = 100;
const MAX_SEARCH_LIMIT = 1000;
const DEFAULT_SEARCH_DURATION_MS = 5000;
const DEFAULT_FILE_SIZE_LIMIT = 1_000_000;
const DEFAULT_EXCERPT_LENGTH = 500;
const MAX_EXCERPT_LENGTH = 2000;
const MAX_READ_LINES = 200;
const MAX_READ_CHARACTERS = 20_000;
const MAX_CONFIGURED_READ_LINES = 100_000;
const MAX_CONFIGURED_READ_CHARACTERS = 1_000_000;
const OUTPUT_OVERHEAD = 200;
const FILE_ARGUMENT_BUDGET = 12_000;
const BINARY_SAMPLE_SIZE = 8192;
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.pdf', '.zip', '.gz', '.tar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.wav', '.avi',
  '.woff', '.woff2', '.ttf', '.otf',
  '.class', '.jar', '.pyc', '.pyo',
  '.sqlite', '.db',
]);

function globToRegExp(glob: string): RegExp {
  let pattern = glob.replace(/\\/g, '/');
  const basenameOnly = !pattern.includes('/');

  if (basenameOnly) pattern = `**/${pattern}`;
  if (pattern.startsWith('/')) pattern = pattern.slice(1);
  pattern = pattern.replace(/\*\*\//g, '\u0001');

  let result = '';

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    if (character === '\u0001') {
      result += '(?:.*/)?';
    } else if (character === '*' && pattern[index + 1] === '*') {
      result += '.*';
      index += 1;
    } else if (character === '*') {
      result += '[^/]*';
    } else if (character === '?') {
      result += '[^/]';
    } else {
      result += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }

  return new RegExp(`^${result}$`);
}

function filterGlobs(files: string[], globs?: string[]): string[] {
  if (!globs?.length) return files;

  const include = globs.filter((glob) => !glob.startsWith('!'));
  const exclude = globs
    .filter((glob) => glob.startsWith('!'))
    .map((glob) => globToRegExp(glob.slice(1)));
  const includeMatchers = include.map(globToRegExp);

  return files.filter((file) => {
    if (exclude.some((matcher) => matcher.test(file))) return false;
    return includeMatchers.length === 0 || includeMatchers.some((matcher) => matcher.test(file));
  });
}

function makeSearchResult(pathname: string, line: number, text: string, maxExcerptLength: number): SearchResult {
  const excerpt = text.trimEnd();
  return {
    path: pathname,
    line,
    text: excerpt.length > maxExcerptLength
      ? `${excerpt.slice(0, maxExcerptLength)}…`
      : excerpt,
  };
}

function parseRipgrepOutput(
  output: string,
  allowedFiles: Set<string>,
  maxExcerptLength: number,
  limit: number,
): SearchResult[] {
  const results: SearchResult[] = [];

  for (const row of output.split(/\r?\n/)) {
    if (results.length >= limit) break;
    const match = /^(.*):(\d+):(.*)$/.exec(row);
    if (!match) continue;

    const [, rawPath, rawLine, text] = match;
    const pathname = rawPath.split(path.sep).join('/');
    if (!allowedFiles.has(pathname)) continue;

    results.push(makeSearchResult(pathname, Number(rawLine), text, maxExcerptLength));
  }

  return results;
}

function runRipgrep(
  executable: string,
  root: string,
  query: string,
  files: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const child = spawn(
      executable,
      [
        '--no-heading',
        '--line-number',
        '--with-filename',
        '--color',
        'never',
        '--fixed-strings',
        '--ignore-case',
        '--no-messages',
        '--',
        query,
        ...files,
      ],
      { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );

    const finish = (error?: Error, output = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(output);
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error('ripgrep search timed out.'));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 4_000_000) {
        child.kill();
        finish(new Error('ripgrep output limit exceeded.'));
        return;
      }
      chunks.push(chunk);
    });

    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code === 0 || code === 1) {
        finish(undefined, Buffer.concat(chunks).toString('utf8'));
      } else {
        finish(new Error(`ripgrep exited with status ${code ?? 'unknown'}.`));
      }
    });
  });
}

async function searchWithNode(
  workspaceRoot: string,
  files: string[],
  query: string,
  limit: number,
  maxExcerptLength: number,
  deadline: number,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const needle = query.toLocaleLowerCase();

  for (const relativePath of files) {
    if (results.length >= limit || Date.now() >= deadline) break;

    try {
      const absolutePath = await resolveWorkspacePath(workspaceRoot, relativePath);
      const content = await readFile(absolutePath, 'utf8');
      if (content.includes('\0')) continue;

      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (Date.now() >= deadline || results.length >= limit) break;
        if (lines[index].toLocaleLowerCase().includes(needle)) {
          results.push(makeSearchResult(relativePath, index + 1, lines[index], maxExcerptLength));
        }
      }
    } catch {
      continue;
    }
  }

  return results;
}

export async function searchWorkspace(
  workspaceRoot: string,
  query: string,
  globs?: string[],
  limit = DEFAULT_SEARCH_LIMIT,
  options: WorkspaceSearchOptions = {},
): Promise<SearchResult[]> {
  if (!query.trim()) throw new Error('Search query must not be empty.');
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Search limit must be a positive integer.');

  const maxDurationMs = options.maxDurationMs ?? DEFAULT_SEARCH_DURATION_MS;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_FILE_SIZE_LIMIT;
  const maxExcerptLength = Math.min(
    options.maxExcerptLength ?? DEFAULT_EXCERPT_LENGTH,
    MAX_EXCERPT_LENGTH,
  );
  if (!Number.isFinite(maxDurationMs) || maxDurationMs < 1) {
    throw new Error('Search duration must be a positive finite number.');
  }
  if (!Number.isFinite(maxFileSizeBytes) || maxFileSizeBytes < 0) {
    throw new Error('Search file size limit must be a non-negative finite number.');
  }
  if (!Number.isInteger(maxExcerptLength) || maxExcerptLength < 1) {
    throw new Error('Search excerpt length must be a positive integer.');
  }

  const root = await realpath(workspaceRoot);
  const startedAt = Date.now();
  const scan = await listWorkspaceFiles(root, {
    maxFileSizeBytes,
    maxDurationMs,
  });
  const files = filterGlobs(scan.files, globs);
  const limitBounded = Math.min(limit, MAX_SEARCH_LIMIT);
  const deadline = startedAt + maxDurationMs;

  if (files.length === 0 || Date.now() >= deadline) return [];

  const executable = options.rgPath ?? 'rg';
  const allowedFiles = new Set(files);
  const rgResults: SearchResult[] = [];
  let chunk: string[] = [];
  let chunkLength = 0;

  try {
    for (const file of files) {
      const argumentLength = file.length + 1;
      if (chunk.length > 0 && chunkLength + argumentLength > FILE_ARGUMENT_BUDGET) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const output = await runRipgrep(executable, root, query, chunk, remaining);
        rgResults.push(...parseRipgrepOutput(output, allowedFiles, maxExcerptLength, limitBounded - rgResults.length));
        if (rgResults.length >= limitBounded) return rgResults.slice(0, limitBounded);
        chunk = [];
        chunkLength = 0;
      }
      chunk.push(file);
      chunkLength += argumentLength;
    }

    if (chunk.length > 0 && Date.now() < deadline) {
      const output = await runRipgrep(
        executable,
        root,
        query,
        chunk,
        deadline - Date.now(),
      );
      rgResults.push(...parseRipgrepOutput(output, allowedFiles, maxExcerptLength, limitBounded - rgResults.length));
    }
    return rgResults.slice(0, limitBounded);
  } catch {
    return searchWithNode(
      root,
      files,
      query,
      limitBounded,
      maxExcerptLength,
      deadline,
    );
  }
}

export async function readWorkspaceFile(
  workspaceRoot: string,
  inputPath: string,
  startLine = 1,
  endLine?: number,
  options: WorkspaceReadOptions = {},
): Promise<string> {
  const relativePath = normalizeWorkspacePath(inputPath);
  if (!Number.isInteger(startLine) || startLine < 1) {
    throw new Error('Start line must be a positive integer.');
  }
  if (endLine !== undefined && (!Number.isInteger(endLine) || endLine < startLine)) {
    throw new Error('End line must be an integer greater than or equal to the start line.');
  }

  const absolutePath = await resolveWorkspacePath(workspaceRoot, relativePath);
  if (BINARY_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase())) {
    throw new Error('Binary files cannot be read as text.');
  }
  const handle = await open(absolutePath, 'r');

  try {
    const metadata = await handle.stat();
    const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_FILE_SIZE_LIMIT;
    const maxLines = options.maxLines ?? MAX_READ_LINES;
    const maxCharacters = options.maxCharacters ?? MAX_READ_CHARACTERS;
    if (!Number.isFinite(maxFileSizeBytes) || maxFileSizeBytes < 0) {
      throw new Error('Read file size limit must be a non-negative finite number.');
    }
    if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > MAX_CONFIGURED_READ_LINES) {
      throw new Error('Read line limit must be an integer between 1 and 100000.');
    }
    if (!Number.isInteger(maxCharacters) || maxCharacters < 1 ||
        maxCharacters > MAX_CONFIGURED_READ_CHARACTERS) {
      throw new Error('Read character limit must be an integer between 1 and 1000000.');
    }
    if (!metadata.isFile()) throw new Error('Workspace path does not identify a file.');
    if (metadata.size > maxFileSizeBytes) throw new Error('Workspace file exceeds the read size limit.');

    const sample = Buffer.alloc(Math.min(metadata.size, BINARY_SAMPLE_SIZE));
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    if (sample.subarray(0, bytesRead).includes(0)) {
      throw new Error('Binary files cannot be read as text.');
    }

    const content = await handle.readFile({ encoding: 'utf8' });
    const lines = content.split(/\r?\n/);
    const lastLine = Math.min(
      endLine ?? startLine + maxLines - 1,
      startLine + maxLines - 1,
    );
    const selected = lines.slice(startLine - 1, lastLine);
    let excerpt = selected.join('\n');

    if (excerpt.length > maxCharacters) {
      excerpt = `${excerpt.slice(0, Math.max(0, maxCharacters - OUTPUT_OVERHEAD))}\n[Excerpt truncated.]`;
    }
    if (lines.length > lastLine && (endLine === undefined || endLine > lastLine)) {
      excerpt = `${excerpt}\n[Output limited to ${maxLines} lines.]`;
    }
    return excerpt;
  } finally {
    await handle.close();
  }
}
