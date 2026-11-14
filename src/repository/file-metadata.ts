import { stat } from 'node:fs/promises';
import path from 'node:path';
import { normalizeWorkspacePath, resolveWorkspacePath } from './path-safety';

export interface FileMetadata {
  path: string;
  name: string;
  size: number;
  extension: string;
  modifiedAt: string;
}

export async function getFileMetadata(
  workspaceRoot: string,
  relativePath: string,
): Promise<FileMetadata> {
  const workspacePath = normalizeWorkspacePath(relativePath);
  const absolutePath = await resolveWorkspacePath(workspaceRoot, workspacePath);
  const metadata = await stat(absolutePath);

  if (!metadata.isFile()) {
    throw new Error('Workspace path does not identify a file.');
  }

  return {
    path: workspacePath,
    name: path.posix.basename(workspacePath),
    size: metadata.size,
    extension: path.posix.extname(workspacePath).toLowerCase(),
    modifiedAt: metadata.mtime.toISOString(),
  };
}
