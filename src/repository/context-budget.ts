import type { ContextFile } from '../shared/contracts';

export interface ContextBudgetResult {
  relevantFiles: ContextFile[];
  tokenEstimate: number;
  budgetConflicts: string[];
}

export function estimateContextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function fileTokenEstimate(file: ContextFile): number {
  return estimateContextTokens(JSON.stringify(file));
}

export function fitContextToBudget(
  rankedFiles: ContextFile[],
  tokenBudget: number,
  explicitPaths: Set<string>,
  additionalContext = '',
): ContextBudgetResult {
  const relevantFiles: ContextFile[] = [];
  const budgetConflicts: string[] = [];
  let tokenEstimate = estimateContextTokens(additionalContext);
  const explicitFiles = rankedFiles.filter((file) => explicitPaths.has(file.path));
  const remainingFiles = rankedFiles.filter((file) => !explicitPaths.has(file.path));

  function addWithinBudget(file: ContextFile, isExplicit: boolean): void {
    const availableTokens = tokenBudget - tokenEstimate;
    const fullCost = fileTokenEstimate(file);
    if (fullCost <= availableTokens) {
      relevantFiles.push(file);
      tokenEstimate += fullCost;
      return;
    }

    const excerpt = file.excerpts[0];
    const emptyExcerptFile: ContextFile = {
      ...file,
      excerpts: [{ ...excerpt, text: '' }],
    };
    const baseCost = fileTokenEstimate(emptyExcerptFile);
    const excerptCharacters = Math.max(0, (availableTokens - baseCost) * 4);
    if (!excerpt || excerptCharacters < 1) {
      if (isExplicit) budgetConflicts.push(file.path);
      return;
    }

    const clippedText = excerpt.text.slice(0, excerptCharacters);
    const clipped: ContextFile = {
      ...file,
      excerpts: [{
        ...excerpt,
        endLine: Math.min(
          excerpt.endLine,
          excerpt.startLine + Math.max(0, clippedText.split(/\r?\n/).length - 1),
        ),
        text: clippedText,
      }],
    };
    const clippedCost = fileTokenEstimate(clipped);
    if (clippedCost <= availableTokens) {
      relevantFiles.push(clipped);
      tokenEstimate += clippedCost;
      if (isExplicit) budgetConflicts.push(file.path);
    } else if (isExplicit) {
      budgetConflicts.push(file.path);
    }
  }

  for (const file of explicitFiles) addWithinBudget(file, true);
  for (const file of remainingFiles) addWithinBudget(file, false);

  budgetConflicts.sort((left, right) => left.localeCompare(right));
  return { relevantFiles, tokenEstimate, budgetConflicts };
}
