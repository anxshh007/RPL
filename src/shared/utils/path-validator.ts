/**
 * Safe Path Validation & Workspace Boundary Enforcement
 * Prevents directory traversal attacks and verifies all file paths reside within the workspace.
 */

import * as path from "node:path";
import * as fs from "node:fs";

export class SecurityPathError extends Error {
  constructor(message: string, public readonly attemptedPath: string) {
    super(message);
    this.name = "SecurityPathError";
  }
}

/**
 * Normalizes a path string by resolving relative components,
 * removing redundant slashes, and standardizing case on Windows.
 */
export function normalizePath(p: string): string {
  if (!p || typeof p !== "string") {
    throw new SecurityPathError("Path must be a non-empty string", String(p));
  }
  const resolved = path.resolve(p);
  // Standardize drive letters on Windows (e.g., c: -> C:)
  if (process.platform === "win32" && resolved.length >= 2 && resolved[1] === ":") {
    return resolved[0].toUpperCase() + resolved.slice(1);
  }
  return resolved;
}

/**
 * Validates that targetPath resides strictly inside workspaceRoot.
 * Returns the normalized absolute path if valid.
 * Throws SecurityPathError if path attempts directory traversal outside workspace.
 */
export function validateSafePath(targetPath: string, workspaceRoot: string): string {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new SecurityPathError("workspaceRoot must be a valid directory path", String(workspaceRoot));
  }
  if (!targetPath || typeof targetPath !== "string") {
    throw new SecurityPathError("targetPath must be a non-empty string", String(targetPath));
  }

  const normalizedRoot = normalizePath(workspaceRoot);
  
  // If targetPath is relative, resolve it against workspaceRoot
  const resolvedTarget = path.isAbsolute(targetPath)
    ? normalizePath(targetPath)
    : normalizePath(path.join(normalizedRoot, targetPath));

  // Check prefix containment
  const relative = path.relative(normalizedRoot, resolvedTarget);
  const isOutside = relative.startsWith("..") || path.isAbsolute(relative);

  if (isOutside) {
    throw new SecurityPathError(
      `Access denied: Path "${targetPath}" resolves outside workspace boundary "${workspaceRoot}"`,
      targetPath
    );
  }

  // Ensure realpath (symlinks) does not escape workspace if path exists
  try {
    if (fs.existsSync(resolvedTarget)) {
      const realTarget = fs.realpathSync(resolvedTarget);
      const realRoot = fs.existsSync(normalizedRoot) ? fs.realpathSync(normalizedRoot) : normalizedRoot;
      const normalizedRealRoot = normalizePath(realRoot);
      const normalizedRealTarget = normalizePath(realTarget);

      const realRelative = path.relative(normalizedRealRoot, normalizedRealTarget);
      if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
        throw new SecurityPathError(
          `Access denied: Symlink resolves outside workspace boundary: "${targetPath}"`,
          targetPath
        );
      }
    }
  } catch (err) {
    if (err instanceof SecurityPathError) throw err;
    // If realpath fails because file does not exist yet, containment check above suffices
  }

  return resolvedTarget;
}

/**
 * Validates an array of test or source paths, ensuring all paths reside safely inside workspaceRoot.
 * Returns an array of safe, workspace-relative normalized paths.
 */
export function validateSafePaths(paths: string[], workspaceRoot: string): string[] {
  const normalizedRoot = normalizePath(workspaceRoot);
  return paths.map((p) => {
    const safeAbsolute = validateSafePath(p, normalizedRoot);
    const relative = path.relative(normalizedRoot, safeAbsolute);
    return relative.replace(/\\/g, "/");
  });
}
