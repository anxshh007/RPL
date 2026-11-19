/**
 * RepoPilot AI - Workspace Safety & Path Validation
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { SecurityError } from "../agent/errors";

const FORBIDDEN_SEGMENTS = new Set([
  ".git",
  ".env",
  "node_modules",
  ".ssh",
  ".aws"
]);

export class PathSecurityValidator {
  private readonly workspaceRoot: string;
  private readonly realWorkspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    try {
      this.realWorkspaceRoot = fs.existsSync(this.workspaceRoot)
        ? fs.realpathSync(this.workspaceRoot)
        : this.workspaceRoot;
    } catch {
      this.realWorkspaceRoot = this.workspaceRoot;
    }
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  public getRealWorkspaceRoot(): string {
    return this.realWorkspaceRoot;
  }

  /**
   * Resolves a path safely relative to the workspace root.
   * Prevents path traversal, directory escapes, symlink escapes, and access to protected files.
   * Rule 8: Absolute paths are strictly rejected; paths must be workspace-relative.
   */
  public resolveSafePath(requestedPath: string): string {
    if (!requestedPath || typeof requestedPath !== "string") {
      throw new SecurityError("Path argument must be a non-empty string.", "PATH_TRAVERSAL");
    }

    // Normalise slashes
    const normalized = requestedPath.replace(/\\/g, "/");

    // Prevent direct null byte injection
    if (normalized.includes("\0")) {
      throw new SecurityError("Path contains null bytes.", "PATH_TRAVERSAL");
    }

    // Rule 8: Absolute paths are strictly rejected
    if (path.isAbsolute(normalized) || path.isAbsolute(requestedPath) || /^[a-zA-Z]:/.test(normalized)) {
      throw new SecurityError(
        this.sanitizeErrorMessage(
          `Path must be workspace-relative; absolute paths are forbidden: "${requestedPath}".`
        ), "ABSOLUTE_PATH_FORBIDDEN");
    }

    // Resolve full path relative to workspace root
    const resolvedPath = path.resolve(this.workspaceRoot, normalized);

    // Verify target is strictly within the workspace root
    const relative = path.relative(this.workspaceRoot, resolvedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new SecurityError(
        this.sanitizeErrorMessage(
          `Path traversal detected: "${requestedPath}" escapes workspace root "${this.workspaceRoot}".`
        ), "WORKSPACE_ESCAPE");
    }

    // Check for protected segments in the relative path
    const segments = relative.split(/[\\/]/);
    for (const seg of segments) {
      if (FORBIDDEN_SEGMENTS.has(seg.toLowerCase()) || seg.toLowerCase().startsWith(".env")) {
        throw new SecurityError(
          this.sanitizeErrorMessage(
            `Access to protected path segment "${seg}" is forbidden for security.`
          ), "FORBIDDEN_FILE");
      }
    }

    // Symlink escape validation: check target if it exists, or check nearest existing ancestor directory
    let existingAncestor = resolvedPath;
    while (!fs.existsSync(existingAncestor)) {
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) {
        break;
      }
      existingAncestor = parent;
    }

    if (fs.existsSync(existingAncestor)) {
      try {
        const realAncestor = fs.realpathSync(existingAncestor);
        const relReal = path.relative(this.realWorkspaceRoot, realAncestor);
        const relOrig = path.relative(this.workspaceRoot, realAncestor);

        const escapesReal = relReal.startsWith("..") || path.isAbsolute(relReal);
        const escapesOrig = relOrig.startsWith("..") || path.isAbsolute(relOrig);

        if (escapesReal && escapesOrig) {
          throw new SecurityError(
            this.sanitizeErrorMessage(
              `Symlink escape detected: path or parent directory of "${requestedPath}" resolves outside workspace to "${realAncestor}".`
            ), "WORKSPACE_ESCAPE");
        }
      } catch (err: unknown) {
        if (err instanceof SecurityError) {
          throw err;
        }
        throw new SecurityError(
          this.sanitizeErrorMessage(`Unable to verify real filesystem path for "${requestedPath}".`), "PATH_TRAVERSAL");
      }
    }

    return resolvedPath;
  }

  /**
   * Sanitizes error messages by masking workspace paths and secrets
   */
  public sanitizeErrorMessage(message: string): string {
    let sanitized = message;
    if (this.workspaceRoot) {
      sanitized = sanitized.split(this.workspaceRoot).join("<WORKSPACE>");
    }
    if (this.realWorkspaceRoot && this.realWorkspaceRoot !== this.workspaceRoot) {
      sanitized = sanitized.split(this.realWorkspaceRoot).join("<WORKSPACE>");
    }
    // Redact common secret patterns (tokens, keys, secrets)
    sanitized = sanitized.replace(/(bearer\s+[a-zA-Z0-9_\-.]+)/gi, "bearer [REDACTED]");
    sanitized = sanitized.replace(/(key=[a-zA-Z0-9_\-.]+)/gi, "key=[REDACTED]");
    sanitized = sanitized.replace(/(password=[^&\s]+)/gi, "password=[REDACTED]");
    return sanitized;
  }
}
