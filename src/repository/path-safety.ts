
import path from 'node:path';
import { realpath } from 'node:fs/promises';

const BLOCKED_DIRECTORIES = new Set([
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

export function isSensitiveWorkspaceFile(fileName: string): boolean {
  const name = fileName.toLowerCase();

  return (
    name === '.env' ||
    name.startsWith('.env.') ||
    name === '.npmrc' ||
    name === '.pypirc' ||
    name === '.netrc' ||
    name === '.pgpass' ||
    name === '.htpasswd' ||
    name.includes('credential') ||
    name.includes('secret') ||
    name.includes('token') ||
    name.endsWith('.pem') ||
    name.endsWith('.key') ||
    name.endsWith('.p12') ||
    name.endsWith('.pfx') ||
    name.endsWith('.jks') ||
    name.endsWith('.kdbx')
  );
}

/**
 * Normalize a user-provided path into a workspace-relative POSIX path.
 * Absolute paths, traversal and unsafe workspace directories are rejected.
 */
export function normalizeWorkspacePath(input: string): string {
  if (!input || input.includes('\0')) {
    throw new Error('Invalid workspace path.');
  }

  const normalizedInput = input.replace(/\\/g, '/');

  // Reject POSIX absolute paths, Windows drive paths and UNC paths.
  if (
    path.posix.isAbsolute(normalizedInput) ||
    /^[a-zA-Z]:/.test(normalizedInput) ||
    normalizedInput.startsWith('//')
  ) {
    throw new Error('Absolute paths are not allowed.');
  }

  const segments = normalizedInput.split('/');

  if (segments.some((segment) => segment === '..')) {
    throw new Error('Path traversal is not allowed.');
  }

  const normalized = path.posix.normalize(normalizedInput);

  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error('Path must identify a workspace entry.');
  }

  if (normalized.split('/').some((segment) => BLOCKED_DIRECTORIES.has(segment))) {
    throw new Error('Access to excluded workspace directories is not allowed.');
  }

  if (isSensitiveWorkspaceFile(path.posix.basename(normalized))) {
    throw new Error('Access to sensitive files is not allowed.');
  }

  return normalized;
}

/**
 * Resolve an existing workspace file and verify that its real path
 * remains inside the real workspace root.
 *
 * realpath() also detects symlink escapes.
 */
export async function resolveWorkspacePath(
  workspaceRoot: string,
  relativePath: string,
): Promise<string> {
  const safeRelativePath = normalizeWorkspacePath(relativePath);

  const realRoot = await realpath(workspaceRoot);
  const candidate = path.resolve(
    realRoot,
    ...safeRelativePath.split('/'),
  );

  const realCandidate = await realpath(candidate);
  const relativeToRoot = path.relative(realRoot, realCandidate);

  if (
    relativeToRoot === '..' ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error('Resolved path escapes the workspace.');
  }

  return realCandidate;
}
