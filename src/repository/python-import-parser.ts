import { parsePythonSource, type PythonImportRecord } from './python-symbol-index';

export interface PythonImportParseResult {
  file: string;
  imports: PythonImportRecord[];
  status: 'complete' | 'partial' | 'fallback';
  warnings: string[];
}

export async function parsePythonImports(
  source: string,
  file: string,
): Promise<PythonImportParseResult> {
  const analysis = await parsePythonSource(source, file);
  const seen = new Set<string>();
  const imports = analysis.imports.filter((entry) => {
    const key = `${entry.line}:${entry.module}:${entry.names.join(',')}:${entry.relativeLevel}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    file: analysis.file,
    imports,
    status: analysis.status,
    warnings: analysis.warnings,
  };
}
