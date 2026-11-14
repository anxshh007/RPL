import * as path from 'node:path';

export class SecurityPathError extends Error {
  public readonly attemptedPath: string;
  constructor(message: string, attemptedPath: string) {
    super(message);
    this.name = 'SecurityPathError';
    this.attemptedPath = attemptedPath;
  }
}

/**
 * Normalizes a path string, converting backslashes to forward slashes.
 */
export function normalizePosixPath(p: string): string {
  if (!p || typeof p !== 'string') {
    throw new SecurityPathError('Path must be a non-empty string', String(p));
  }
  return p.replace(/\\/g, '/');
}

/**
 * Validates that targetPath is contained within workspaceRoot.
 * Rejects path traversal (..), absolute path escapes, and prohibited directories (.git, node_modules, .env).
 * Returns the normalized POSIX relative path from workspaceRoot.
 */
export function validateWorkspacePath(workspaceRoot: string, targetPath: string): string {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new SecurityPathError('Target path must be a non-empty string', String(targetPath));
  }

  const trimmed = targetPath.trim();
  const normalizedInput = normalizePosixPath(trimmed);

  // Prohibit hidden system/secret targets
  const segments = normalizedInput.split('/');
  for (const segment of segments) {
    if (segment === '.git' || segment === 'node_modules' || segment.startsWith('.env')) {
      throw new SecurityPathError(`Access to protected folder/file is prohibited: ${segment}`, targetPath);
    }
  }

  // Resolve absolute paths against workspaceRoot
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedTarget = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(resolvedRoot, trimmed);

  const relative = path.relative(resolvedRoot, resolvedTarget);

  // Verify containment (must not begin with '..' and must not be a distinct drive)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new SecurityPathError(`Path traversal outside workspace root rejected: ${targetPath}`, targetPath);
  }

  return normalizePosixPath(relative);
}
