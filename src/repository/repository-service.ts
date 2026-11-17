
import path from 'node:path';
import type {
  ChangeRequest,
  ContextFile,
  ContextSource,
  DependencyEdge,
  RepositoryContext,
  SearchResult,
  SymbolRecord,
} from '../shared/contracts';
import { analyzePythonDependencies } from './dependency-index';
import {
  DEFAULT_CONTEXT_RANKING_WEIGHTS,
  rankContextCandidates,
  type ContextRankingSignal,
  type ContextRankingWeights,
  type RankedContextCandidate,
} from './context-ranker';
import {
  estimateContextTokens,
  fitContextToBudget,
  normalizeContextTokenBudget,
} from './context-budget';
import { parseRepositoryMentions } from './mention-parser';
import { indexWorkspacePythonFiles } from './python-symbol-index';
import { listWorkspaceFiles } from './workspace-scanner';
import { readWorkspaceFile, searchWorkspace } from './ripgrep-search';
import { normalizeWorkspacePath } from './path-safety';

export interface RepositoryServiceOptions {
  tokenBudget: number;
  rankingWeights?: Partial<ContextRankingWeights>;
}

interface CandidateData {
  path: string;
  score: number;
  signals: Set<ContextRankingSignal>;
  reasons: Set<string>;
  snippets: SearchResult[];
}

const STOP_WORDS = new Set([
  'about', 'add', 'after', 'again', 'also', 'and', 'are', 'change',
  'create', 'for', 'from', 'have', 'implement', 'into', 'make', 'modify',
  'new', 'please', 'support', 'that', 'the', 'this', 'use', 'using',
  'with', 'would', 'your',
]);
const MAX_QUERY_TERMS = 5;
const MAX_RESULTS_PER_TERM = 80;
const MAX_EXCERPTS_PER_FILE = 3;
const EXCERPT_CONTEXT_LINES = 2;
const MAX_EXCERPT_LINES = 80;
const MAX_CONTEXT_CANDIDATES = 150;
const MAX_CONTEXT_SYMBOLS = 100;
const MAX_CONTEXT_DEPENDENCIES = 200;
const MAX_CONTEXT_UNRESOLVED_IMPORTS = 100;

const SOURCE_PRIORITY: Record<ContextRankingSignal, ContextSource> = {
  explicitFile: 'explicit_mention',
  explicitSymbol: 'explicit_mention',
  activeSelection: 'active_selection',
  exactSymbol: 'symbol_match',
  filenameMatch: 'text_match',
  textMatch: 'text_match',
  dependency: 'dependency',
  testOrDocumentation: 'test_or_doc',
  namingConvention: 'test_or_doc',
};

function getInstructionTerms(instruction: string): string[] {
  const terms = instruction
    .toLowerCase()
    .match(/[a-z_][a-z0-9_]{2,}/g) ?? [];
  return [...new Set(terms.filter((term) => !STOP_WORDS.has(term)))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_QUERY_TERMS);
}

function getPathTerms(file: string): string[] {
  return file.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
}

function getSharedNameTerms(left: Set<string>, right: string[]): string[] {
  return [...left].filter((term) => term.length > 1 && right.includes(term));
}

function pathLooksLikeTest(file: string): boolean {
  return file.split('/').some((part) => /^(?:tests?|specs?)$/i.test(part)) ||
    /(?:^|[._-])test(?:[._-]|$)/i.test(path.posix.basename(file));
}

function pathLooksLikeDocumentation(file: string): boolean {
  return file.split('/').some((part) => /^(?:docs?|documentation)$/i.test(part)) ||
    /\.(?:md|mdx|rst|txt)$/i.test(file);
}

function signalReason(signal: ContextRankingSignal): string {
  const reasons: Record<ContextRankingSignal, string> = {
    explicitFile: 'Explicitly mentioned file.',
    explicitSymbol: 'Contains an explicitly mentioned symbol.',
    activeSelection: 'Active editor file or selected code.',
    exactSymbol: 'Contains a symbol matching the instruction.',
    filenameMatch: 'Filename matches instruction terms.',
    textMatch: 'File content matches instruction terms.',
    dependency: 'Directly imports or is imported by a relevant file.',
    testOrDocumentation: 'Related test or documentation has matching source evidence.',
    namingConvention: 'Related by test/documentation naming convention.',
  };
  return reasons[signal];
}

function candidateSource(signals: Set<ContextRankingSignal>): ContextSource {
  const priority: ContextRankingSignal[] = [
    'explicitFile',
    'explicitSymbol',
    'activeSelection',
    'exactSymbol',
    'dependency',
    'testOrDocumentation',
    'filenameMatch',
    'textMatch',
    'namingConvention',
  ];
  const signal = priority.find((entry) => signals.has(entry));
  return signal ? SOURCE_PRIORITY[signal] : 'text_match';
}

function addCandidate(
  candidates: Map<string, CandidateData>,
  file: string,
  signal: ContextRankingSignal,
  weight: number,
  reason = signalReason(signal),
): CandidateData {
  let candidate = candidates.get(file);
  if (!candidate) {
    candidate = {
      path: file,
      score: 0,
      signals: new Set(),
      reasons: new Set(),
      snippets: [],
    };
    candidates.set(file, candidate);
  }
  if (!candidate.signals.has(signal)) {
    candidate.score += weight;
    candidate.signals.add(signal);
  }
  candidate.reasons.add(reason);
  return candidate;
}

function addSnippet(candidate: CandidateData, result: SearchResult): void {
  if (!candidate.snippets.some((snippet) => snippet.line === result.line)) {
    candidate.snippets.push(result);
    candidate.snippets.sort((left, right) =>
      left.line - right.line || left.text.localeCompare(right.text),
    );
  }
}

async function buildExcerpts(
  workspaceRoot: string,
  candidate: CandidateData,
  activeSelection?: { startLine: number; endLine: number; text?: string },
): Promise<ContextFile['excerpts']> {
  const snippets = candidate.snippets.slice(0, MAX_EXCERPTS_PER_FILE);
  if (snippets.length === 0) {
    snippets.push({ path: candidate.path, line: 1, text: '' });
  }

  const excerpts: ContextFile['excerpts'] = [];
  for (const snippet of snippets) {
    let startLine = Math.max(1, snippet.line - EXCERPT_CONTEXT_LINES);
    let endLine = Math.min(
      startLine + MAX_EXCERPT_LINES - 1,
      snippet.line + EXCERPT_CONTEXT_LINES,
    );
    let text = '';

    if (activeSelection && candidate.signals.has('activeSelection')) {
      startLine = activeSelection.startLine;
      endLine = Math.min(
        activeSelection.endLine,
        startLine + MAX_EXCERPT_LINES - 1,
      );
      text = activeSelection.text ?? await readWorkspaceFile(
        workspaceRoot,
        candidate.path,
        startLine,
        endLine,
      );
    } else {
      text = await readWorkspaceFile(
        workspaceRoot,
        candidate.path,
        startLine,
        endLine,
      );
    }

    if (text.trim()) excerpts.push({ startLine, endLine, text });
  }

  if (excerpts.length === 0) {
    const text = await readWorkspaceFile(
      workspaceRoot,
      candidate.path,
      1,
      MAX_EXCERPT_LINES,
    );
    if (text.trim()) {
      excerpts.push({ startLine: 1, endLine: MAX_EXCERPT_LINES, text });
    }
  }

  const unique = new Map<string, ContextFile['excerpts'][number]>();
  for (const excerpt of excerpts) {
    const overlapping = [...unique.entries()].find(([, existing]) =>
      excerpt.startLine <= existing.endLine &&
      existing.startLine <= excerpt.endLine,
    );
    if (!overlapping) {
      unique.set(`${excerpt.startLine}:${excerpt.endLine}`, excerpt);
      continue;
    }
    const [key, existing] = overlapping;
    if (excerpt.text.length > existing.text.length) unique.set(key, excerpt);
  }
  return [...unique.values()].sort(
    (left, right) => left.startLine - right.startLine,
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Request cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

/**
 * Returns dependency edges inside the two-hop dependant neighbourhood
 * of the supplied root files.
 *
 * An edge A -> B means A depends on B.
 * Therefore, to find dependants of a root, traverse edges where
 * edge.to belongs to the current frontier and add edge.from.
 */
export function getTwoHopDependantEdges(
  dependencyEdges: DependencyEdge[],
  roots: Set<string>,
): { edges: DependencyEdge[]; omittedCount: number } {
  let frontier = new Set(roots);
  const visited = new Set(roots);
  const edgeDistances = new Map<string, { edge: DependencyEdge; hop: number }>();

  for (let hop = 1; hop <= 2 && frontier.size > 0; hop += 1) {
    const nextFrontier = new Set<string>();

    for (const edge of dependencyEdges) {
      if (!frontier.has(edge.to)) continue;

      const key = `${edge.from}\0${edge.to}\0${edge.kind}\0${edge.evidence}`;
      const existing = edgeDistances.get(key);
      if (!existing || hop < existing.hop) {
        edgeDistances.set(key, { edge, hop });
      }
      if (!visited.has(edge.from)) nextFrontier.add(edge.from);
    }

    for (const file of nextFrontier) visited.add(file);
    frontier = nextFrontier;
  }

  const prioritizedEdges = [...edgeDistances.values()].sort(
    (left, right) =>
      left.hop - right.hop ||
      left.edge.from.localeCompare(right.edge.from) ||
      left.edge.to.localeCompare(right.edge.to) ||
      left.edge.kind.localeCompare(right.edge.kind) ||
      left.edge.evidence.localeCompare(right.edge.evidence),
  );
  return {
    edges: prioritizedEdges
      .slice(0, MAX_CONTEXT_DEPENDENCIES)
      .map(({ edge }) => edge),
    omittedCount: Math.max(
      0,
      prioritizedEdges.length - MAX_CONTEXT_DEPENDENCIES,
    ),
  };
}

export async function assembleRepositoryContext(
  workspaceRoot: string,
  request: ChangeRequest,
  options: RepositoryServiceOptions,
  signal?: AbortSignal,
): Promise<RepositoryContext> {
  throwIfAborted(signal);

  const weights: ContextRankingWeights = {
    ...DEFAULT_CONTEXT_RANKING_WEIGHTS,
    ...options.rankingWeights,
  };

  const scan = await listWorkspaceFiles(workspaceRoot);
  const availableFiles = new Set(scan.files);

  const mentions = parseRepositoryMentions(
    request.explicitFileMentions,
    request.explicitSymbolMentions,
    request.instruction,
    scan.files,
    request.activeFile,
  );

  const candidates = new Map<string, CandidateData>();
  const warnings = [...scan.warnings, ...mentions.warnings];
  const explicitPaths = new Set(mentions.fileMentions);
  const resolvedExplicitSymbols: SymbolRecord[] = [];

  const normalizedBudget = normalizeContextTokenBudget(options.tokenBudget);
  const effectiveBudget = normalizedBudget.tokenBudget;
  if (normalizedBudget.warning) warnings.push(normalizedBudget.warning);

  for (const file of mentions.fileMentions) {
    addCandidate(candidates, file, 'explicitFile', weights.explicitFile);
  }

  let activeSelection:
    | { startLine: number; endLine: number; text?: string }
    | undefined;
  let activeFilePath: string | undefined;

  if (request.activeFile) {
    try {
      const activeFile = normalizeWorkspacePath(request.activeFile);
      activeFilePath = activeFile;

      if (availableFiles.has(activeFile)) {
        explicitPaths.add(activeFile);

        const candidate = addCandidate(
          candidates,
          activeFile,
          'activeSelection',
          weights.activeSelection,
        );

        if (request.selectionRange) {
          activeSelection = {
            startLine: request.selectionRange.startLine,
            endLine: request.selectionRange.endLine,
            text: request.selectedText,
          };

          if (request.selectedText) {
            candidate.snippets.push({
              path: activeFile,
              line: request.selectionRange.startLine,
              text: request.selectedText,
            });
          }
        } else if (request.selectedText) {
          const content = await readWorkspaceFile(workspaceRoot, activeFile);
          const lineIndex = content.split(/\r?\n/).findIndex((line) =>
            line.includes(request.selectedText ?? ''),
          );

          if (lineIndex >= 0) {
            activeSelection = {
              startLine: lineIndex + 1,
              endLine: lineIndex + 1,
              text: request.selectedText,
            };

            candidate.snippets.push({
              path: activeFile,
              line: lineIndex + 1,
              text: request.selectedText,
            });
          }
        }
      } else {
        warnings.push(
          `Active file is not in the scanned workspace: ${activeFile}`,
        );
      }
    } catch {
      warnings.push('Active file path is invalid or unsafe.');
    }
  }

  throwIfAborted(signal);

  const pythonIndex = await indexWorkspacePythonFiles(workspaceRoot);
  warnings.push(...pythonIndex.warnings);

  const allSymbols = pythonIndex.files.flatMap((file) => file.symbols);
  const allDependencies = await analyzePythonDependencies(workspaceRoot);

  warnings.push(...allDependencies.warnings);

  for (const name of mentions.symbolMentions) {
    const matches = allSymbols.filter((symbol) => symbol.name === name);

    if (matches.length === 0) {
      warnings.push(`Explicit symbol mention could not be resolved: ${name}`);
      continue;
    }

    for (const symbol of matches) {
      resolvedExplicitSymbols.push(symbol);
      explicitPaths.add(symbol.file);

      const candidate = addCandidate(
        candidates,
        symbol.file,
        'explicitSymbol',
        weights.explicitSymbol,
        `Explicit symbol @${name} found at line ${symbol.startLine}.`,
      );

      addSnippet(candidate, {
        path: symbol.file,
        line: symbol.startLine,
        text: symbol.name,
      });
    }
  }

  const instructionTerms = getInstructionTerms(request.instruction);

  for (const file of scan.files) {
    const filename = path.posix.basename(file).toLowerCase();
    const matches = instructionTerms.filter((term) =>
      filename.includes(term),
    );

    if (matches.length > 0) {
      addCandidate(
        candidates,
        file,
        'filenameMatch',
        weights.filenameMatch * matches.length,
        `Filename contains instruction term${matches.length > 1 ? 's' : ''}: ${matches.join(', ')}.`,
      );
    }
  }

  for (const term of instructionTerms) {
    throwIfAborted(signal);

    try {
      const results = await searchWorkspace(
        workspaceRoot,
        term,
        undefined,
        MAX_RESULTS_PER_TERM,
        { maxDurationMs: 2000, maxExcerptLength: 300 },
      );

      for (const result of results) {
        const candidate = addCandidate(
          candidates,
          result.path,
          'textMatch',
          weights.textMatch,
          `Source text matches instruction term "${term}".`,
        );

        addSnippet(candidate, result);
      }
    } catch {
      warnings.push(
        `Text search was incomplete for instruction term "${term}".`,
      );
    }
  }

  const normalizedTermSet = new Set(instructionTerms);

  for (const symbol of allSymbols) {
    const normalizedName = symbol.name.toLowerCase();

    if (normalizedTermSet.has(normalizedName)) {
      const candidate = addCandidate(
        candidates,
        symbol.file,
        'exactSymbol',
        weights.exactSymbol,
        `Exact symbol match "${symbol.name}" at line ${symbol.startLine}.`,
      );

      addSnippet(candidate, {
        path: symbol.file,
        line: symbol.startLine,
        text: symbol.name,
      });
    }
  }

  const seedFiles = new Set(candidates.keys());

  for (const edge of allDependencies.dependencyEdges) {
    if (!seedFiles.has(edge.from) && !seedFiles.has(edge.to)) continue;

    const related = seedFiles.has(edge.from) ? edge.to : edge.from;
    if (!availableFiles.has(related)) continue;

    addCandidate(
      candidates,
      related,
      'dependency',
      weights.dependency,
      `Direct ${edge.kind} relationship with relevant file ${seedFiles.has(edge.from) ? edge.from : edge.to}.`,
    );
  }

  for (const file of scan.files) {
    const testFile = pathLooksLikeTest(file);
    const documentationFile = pathLooksLikeDocumentation(file);

    if (!testFile && !documentationFile) continue;

    const fileTerms = new Set(getPathTerms(path.posix.basename(file)));

    const relatedCandidates = [...candidates.values()].filter((candidate) => {
      if (candidate.path === file) return false;

      const candidateTerms = getPathTerms(
        path.posix.basename(candidate.path),
      );

      const codeCandidate =
        !pathLooksLikeTest(candidate.path) &&
        !pathLooksLikeDocumentation(candidate.path);

      return codeCandidate &&
        (
          getSharedNameTerms(fileTerms, candidateTerms).length > 0 ||
          [...normalizedTermSet].some(
            (term) =>
              fileTerms.has(term) || candidateTerms.includes(term),
          )
        );
    });

    const textEvidence =
      candidates.get(file)?.signals.has('textMatch') ?? false;

    if (relatedCandidates.length === 0 && !textEvidence) continue;

    const sourceEvidence = allDependencies.dependencyEdges.some((edge) =>
      testFile
        ? edge.kind === 'tests' &&
          (edge.from === file || edge.to === file)
        : edge.from === file || edge.to === file,
    );

    const nameMatch = relatedCandidates.some((candidate) => {
      const fileName = path.posix.basename(file).toLowerCase();
      const candidateName = path.posix.basename(candidate.path).toLowerCase();

      return (
        fileName.includes(candidateName.replace(/\.[^.]+$/, '')) ||
        candidateName.includes(fileName.replace(/\.[^.]+$/, ''))
      );
    });

    const signal: ContextRankingSignal =
      sourceEvidence || textEvidence
        ? 'testOrDocumentation'
        : nameMatch
          ? 'namingConvention'
          : 'testOrDocumentation';

    const candidate = addCandidate(
      candidates,
      file,
      signal,
      weights[signal],
      sourceEvidence
        ? `Repository dependency evidence associates this ${testFile ? 'test' : 'documentation'} file with relevant code.`
        : textEvidence
          ? `Matching source text was found in this ${testFile ? 'test' : 'documentation'} file.`
          : `Related by ${testFile ? 'test' : 'documentation'} naming convention.`,
    );

    if (signal === 'testOrDocumentation' && !sourceEvidence && !textEvidence) {
      candidate.score -=
        weights.testOrDocumentation - weights.namingConvention;
      candidate.signals.delete('testOrDocumentation');
      candidate.signals.add('namingConvention');
    }

    if (testFile && nameMatch && !sourceEvidence) {
      for (const related of relatedCandidates) {
        const fileName = path.posix.basename(file).toLowerCase();
        const candidateName = path.posix.basename(related.path).toLowerCase();

        if (
          fileName.includes(candidateName.replace(/\.[^.]+$/, '')) ||
          candidateName.includes(fileName.replace(/\.[^.]+$/, ''))
        ) {
          const alreadyExists = allDependencies.dependencyEdges.some(
            (edge) => edge.from === file && edge.to === related.path,
          );

          if (!alreadyExists) {
            allDependencies.dependencyEdges.push({
              from: file,
              to: related.path,
              kind: 'tests',
              evidence: 'inferred',
            });
          }
        }
      }
    }
  }

  for (const candidate of candidates.values()) {
    for (const symbol of allSymbols) {
      if (symbol.file !== candidate.path) continue;

      if (
        candidate.signals.has('explicitSymbol') ||
        candidate.signals.has('exactSymbol') ||
        candidate.signals.has('textMatch')
      ) {
        resolvedExplicitSymbols.push(symbol);
      }
    }
  }

  // Calculate dependency metadata once, independently of excerpt selection.
  const dependencyNeighborhood = getTwoHopDependantEdges(
    allDependencies.dependencyEdges,
    new Set(explicitPaths),
  );
  if (dependencyNeighborhood.omittedCount > 0) {
    warnings.push(
      `Dependency edges were truncated to ${MAX_CONTEXT_DEPENDENCIES}; ${dependencyNeighborhood.omittedCount} eligible edge${dependencyNeighborhood.omittedCount === 1 ? '' : 's'} omitted.`,
    );
  }

  const ranked: RankedContextCandidate[] = rankContextCandidates(
    [...candidates.values()].map((candidate) => ({
      path: candidate.path,
      score: candidate.score,
      signals: [...candidate.signals],
      reasons: [...candidate.reasons].sort(
        (left, right) => left.localeCompare(right),
      ),
    })),
  );

  const prioritizedPaths = new Set([
    ...explicitPaths,
    ...ranked.slice(0, MAX_CONTEXT_CANDIDATES).map(
      (candidate) => candidate.path,
    ),
  ]);

  if (ranked.some((candidate) => !prioritizedPaths.has(candidate.path))) {
    warnings.push(
      'Context candidate limit reached; lower-ranked files were omitted.',
    );
  }

  const rankedFiles: ContextFile[] = [];

  for (const rankedCandidate of ranked.filter((candidate) =>
    prioritizedPaths.has(candidate.path),
  )) {
    throwIfAborted(signal);

    const candidate = candidates.get(rankedCandidate.path);
    if (!candidate) continue;

    try {
      const excerpts = await buildExcerpts(
        workspaceRoot,
        candidate,
        candidate.path === request.activeFile?.replace(/\\/g, '/')
          ? activeSelection
          : undefined,
      );

      if (excerpts.length === 0) continue;

      rankedFiles.push({
        path: candidate.path,
        reason: rankedCandidate.reasons.join(' '),
        score: rankedCandidate.score,
        source: candidateSource(candidate.signals),
        excerpts,
      });
    } catch {
      warnings.push(
        `${candidate.path}: could not assemble a safe context excerpt.`,
      );
    }
  }

  function getContextMetadata(files: ContextFile[]): {
    symbols: SymbolRecord[];
    edges: DependencyEdge[];
    unresolvedImports: RepositoryContext['unresolvedImports'];
  } {
    const selectedFileByPath = new Map(
      files.map((file) => [file.path, file]),
    );

    const symbols = [...new Map(
      resolvedExplicitSymbols
        .filter((symbol) => {
          const selected = selectedFileByPath.get(symbol.file);

          return selected?.excerpts.some((excerpt) =>
            symbol.startLine <= excerpt.endLine &&
            symbol.endLine >= excerpt.startLine,
          ) ?? false;
        })
        .map((symbol) => [
          `${symbol.file}\0${symbol.startLine}\0${symbol.name}`,
          symbol,
        ]),
    ).values()].sort((left, right) =>
      left.file.localeCompare(right.file) ||
      left.startLine - right.startLine ||
      left.name.localeCompare(right.name),
    );

    // Dependency edges do not depend on budget-selected excerpts.
    const edges = dependencyNeighborhood.edges;

    // Unresolved imports are still limited to selected context files.
    const unresolvedImports = allDependencies.unresolvedImports
      .filter((item) => selectedFileByPath.has(item.file))
      .sort((left, right) =>
        left.file.localeCompare(right.file) ||
        left.module.localeCompare(right.module),
      );

    return {
      symbols: symbols.slice(0, MAX_CONTEXT_SYMBOLS),
      edges,
      unresolvedImports: unresolvedImports.slice(
        0,
        MAX_CONTEXT_UNRESOLVED_IMPORTS,
      ),
    };
  }

  let budget = fitContextToBudget(
    rankedFiles,
    effectiveBudget,
    explicitPaths,
  );

  let metadata = getContextMetadata(budget.relevantFiles);

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const nextBudget = fitContextToBudget(
      rankedFiles,
      effectiveBudget,
      explicitPaths,
      JSON.stringify(metadata),
    );

    const nextMetadata = getContextMetadata(nextBudget.relevantFiles);

    const pathsUnchanged =
      nextBudget.relevantFiles.length === budget.relevantFiles.length &&
      nextBudget.relevantFiles.every(
        (file, index) =>
          file.path === budget.relevantFiles[index].path,
      );

    budget = nextBudget;
    metadata = nextMetadata;

    if (pathsUnchanged) break;
  }

  if (
    metadata.symbols.length >= MAX_CONTEXT_SYMBOLS ||
    metadata.unresolvedImports.length >= MAX_CONTEXT_UNRESOLVED_IMPORTS
  ) {
    warnings.push(
      'Context relationship details were capped to preserve the token budget.',
    );
  }

  if (budget.relevantFiles.length === 0) {
    const activeFileConflict = activeFilePath &&
      budget.budgetConflicts.includes(activeFilePath);
    warnings.push(
      activeFileConflict
        ? `No files could fit within the token budget of ${effectiveBudget} tokens; active file "${activeFilePath}" could not fit.`
        : `No files could fit within the token budget of ${effectiveBudget} tokens.`,
    );
  }

  return {
    requestId: request.requestId,
    relevantFiles: budget.relevantFiles,
    relevantSymbols: metadata.symbols,
    dependencyEdges: metadata.edges,
    unresolvedImports: metadata.unresolvedImports,
    tokenEstimate: budget.tokenEstimate,
    tokenBudget: effectiveBudget,
    budgetConflicts: budget.budgetConflicts,
    warnings: [...new Set(warnings)].sort(
      (left, right) => left.localeCompare(right),
    ),
  };
}
