import path from 'node:path';
import { normalizeWorkspacePath } from './path-safety';

export interface ParsedMentions {
  fileMentions: string[];
  symbolMentions: string[];
  warnings: string[];
}

function stripMentionDecorations(value: string): string {
  return value.trim().replace(/^['"`]|['"`]$/g, '').replace(/[),;]+$/, '');
}

function resolveMentionFromText(
  raw: string,
  availableFiles: Set<string>,
  activeFile?: string,
): string | undefined {
  const cleaned = stripMentionDecorations(raw);
  if (!cleaned) return undefined;

  const candidates = new Set<string>([cleaned]);
  if (activeFile && !/^(?:[a-zA-Z]:|\/|\\\\)/.test(cleaned)) {
    const activeDirectory = path.posix.dirname(activeFile.replace(/\\/g, '/'));
    candidates.add(path.posix.join(activeDirectory, cleaned));
  }

  for (const candidate of candidates) {
    try {
      const normalized = normalizeWorkspacePath(candidate);
      if (availableFiles.has(normalized)) return normalized;
    } catch {
      continue;
    }
  }

  return undefined;
}

export function parseRepositoryMentions(
  requestFileMentions: string[],
  requestSymbolMentions: string[],
  instruction: string,
  availableFiles: string[],
  activeFile?: string,
): ParsedMentions {
  const files = new Set(availableFiles);
  const fileMentions = new Set<string>();
  const symbolMentions = new Set<string>();
  const warnings: string[] = [];

  for (const raw of requestFileMentions) {
    const resolved = resolveMentionFromText(
      raw.replace(/^@file:/, ''),
      files,
      activeFile,
    );
    if (resolved) fileMentions.add(resolved);
    else warnings.push(`Explicit file mention could not be resolved: ${raw}`);
  }

  for (const raw of requestSymbolMentions) {
    const name = stripMentionDecorations(raw.replace(/^@symbol:/, ''));
    if (name) symbolMentions.add(name);
    else warnings.push('An empty explicit symbol mention was ignored.');
  }

  const filePattern = /@file:(?:"([^"]+)"|'([^']+)'|([^\r\n]+))/g;
  for (const match of instruction.matchAll(filePattern)) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw) continue;

    let resolved = resolveMentionFromText(raw, files, activeFile);
    if (!resolved && match[3]) {
      const remainder = match[3].trim();
      const activeDirectory = activeFile
        ? path.posix.dirname(activeFile.replace(/\\/g, '/'))
        : '';
      const pathMatches = [...files]
        .map((file) => ({
          file,
          relative: activeDirectory
            ? path.posix.relative(activeDirectory, file)
            : file,
        }))
        .filter(({ file, relative }) =>
          remainder.startsWith(file) || (relative && remainder.startsWith(relative)),
        )
        .sort((left, right) =>
          Math.max(right.file.length, right.relative.length) -
          Math.max(left.file.length, left.relative.length),
        );
      if (pathMatches.length > 0) resolved = pathMatches[0].file;
    }
    if (resolved) fileMentions.add(resolved);
    else warnings.push(`Explicit file mention could not be resolved: ${raw.trim()}`);
  }

  for (const match of instruction.matchAll(/@symbol:(?:"([^"]+)"|'([^']+)'|([^\s,;]+))/g)) {
    const name = stripMentionDecorations(match[1] ?? match[2] ?? match[3] ?? '');
    if (name) symbolMentions.add(name);
  }

  return {
    fileMentions: [...fileMentions].sort((left, right) => left.localeCompare(right)),
    symbolMentions: [...symbolMentions].sort((left, right) => left.localeCompare(right)),
    warnings,
  };
}
