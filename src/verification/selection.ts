import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { TestCandidate } from '../shared/contracts';
import { normalizePosixPath } from './utils/path-validator';
import { findTestFiles } from './discovery';

export interface SelectedTestItem {
  path: string;
  reason: string;
}

export interface TestSelectionOutput {
  selectedTests: SelectedTestItem[];
  allCandidates: TestCandidate[];
  fallbackUsed: boolean;
  limitations: string[];
}

/**
 * Derives candidate test paths for a source file by standard Python test naming conventions:
 * e.g. src/flask/cli.py -> tests/test_cli.py, test_cli.py, tests/cli_test.py
 */
export function getConventionalTestPaths(sourcePath: string): string[] {
  const norm = normalizePosixPath(sourcePath);
  const baseName = path.basename(norm, path.extname(norm));
  if (!baseName || baseName.startsWith('test_') || baseName.endsWith('_test')) {
    return [];
  }

  const testFile1 = `test_${baseName}.py`;
  const testFile2 = `${baseName}_test.py`;

  return [
    `tests/${testFile1}`,
    `test/${testFile1}`,
    testFile1,
    `tests/${testFile2}`,
    `test/${testFile2}`,
    testFile2,
  ];
}

/**
 * Checks whether a relative file exists within the workspace.
 */
async function fileExistsInWorkspace(workspaceRoot: string, relativePath: string): Promise<boolean> {
  try {
    const full = path.join(workspaceRoot, relativePath);
    await fs.access(full);
    return true;
  } catch {
    return false;
  }
}

/**
 * Selects relevant tests based on:
 * Tier 1: Explicit test candidates (source: 'explicit')
 * Tier 2: ImpactLens candidates (source: 'impact', prioritizing high & medium confidence over low)
 * Tier 3: Naming convention match (e.g. cli.py -> test_cli.py, source: 'convention')
 * Tier 4: Fallback to broader workspace test suite (source: 'configuration')
 */
export async function selectRelevantTests(params: {
  workspaceRoot: string;
  changedFiles?: string[];
  candidateTests?: TestCandidate[];
}): Promise<TestSelectionOutput> {
  const { workspaceRoot, changedFiles = [], candidateTests = [] } = params;
  const selectedMap = new Map<string, SelectedTestItem>();
  const candidatesAccumulator: TestCandidate[] = [];
  const limitations: string[] = [];

  // Tier 1 & 2: Process candidates passed in (from user/central agent or ImpactLens)
  // Per item 19: high and medium candidates run first; carry reason into selectedTests.
  const sortedCandidates = [...candidateTests].sort((a, b) => {
    const rank = (c: TestCandidate['confidence']) => (c === 'high' ? 3 : c === 'medium' ? 2 : 1);
    return rank(b.confidence) - rank(a.confidence);
  });

  for (const candidate of sortedCandidates) {
    const norm = normalizePosixPath(candidate.path);
    if (!selectedMap.has(norm)) {
      const reason = candidate.confidence === 'low'
        ? `${candidate.reason} (inferred)`
        : candidate.reason;
      selectedMap.set(norm, { path: norm, reason });
      candidatesAccumulator.push({
        path: norm,
        reason,
        source: candidate.source,
        confidence: candidate.confidence,
      });
    }
  }

  // Tier 3: Naming convention match for changed files
  for (const changedFile of changedFiles) {
    const normChanged = normalizePosixPath(changedFile);

    // If changedFile is itself a test file, select it directly
    if (
      (normChanged.startsWith('tests/') || normChanged.startsWith('test/')) &&
      (normChanged.includes('test_') || normChanged.endsWith('_test.py'))
    ) {
      if (!selectedMap.has(normChanged)) {
        const reason = `Direct test modification: ${normChanged}`;
        selectedMap.set(normChanged, { path: normChanged, reason });
        candidatesAccumulator.push({
          path: normChanged,
          reason,
          source: 'convention',
          confidence: 'high',
        });
      }
      continue;
    }

    const conventionalCandidates = getConventionalTestPaths(normChanged);
    for (const testRel of conventionalCandidates) {
      if (await fileExistsInWorkspace(workspaceRoot, testRel)) {
        if (!selectedMap.has(testRel)) {
          const reason = `Conventional name match for changed file "${normChanged}" -> "${testRel}"`;
          selectedMap.set(testRel, { path: testRel, reason });
          candidatesAccumulator.push({
            path: testRel,
            reason,
            source: 'convention',
            confidence: 'high',
          });
        }
      }
    }
  }

  let fallbackUsed = false;

  // Tier 4: Fallback to broader suite if no tests matched and changed files exist
  if (selectedMap.size === 0 && changedFiles.length > 0) {
    // Search tests/ or test/ directory
    const candidatesFound: string[] = [];
    for (const testDir of ['tests', 'test']) {
      const fullDir = path.join(workspaceRoot, testDir);
      const files = await findTestFiles(fullDir, workspaceRoot);
      candidatesFound.push(...files);
    }

    if (candidatesFound.length > 0) {
      fallbackUsed = true;
      limitations.push('No direct conventional or ImpactLens test matches found; fell back to discovered workspace test suite.');
      for (const testFile of candidatesFound) {
        if (!selectedMap.has(testFile)) {
          // Per item 10: fallback source MUST be 'configuration'
          const reason = `Broader test suite fallback: discovered in test directory`;
          selectedMap.set(testFile, { path: testFile, reason });
          candidatesAccumulator.push({
            path: testFile,
            reason,
            source: 'configuration',
            confidence: 'low',
          });
        }
      }
    } else {
      limitations.push('No tests could be discovered for the changed files.');
    }
  }

  return {
    selectedTests: Array.from(selectedMap.values()),
    allCandidates: candidatesAccumulator,
    fallbackUsed,
    limitations,
  };
}
