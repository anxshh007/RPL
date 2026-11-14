/**
 * Test Selection Engine
 * Multi-tiered test selection prioritizing:
 * 1. Explicit user/caller specified test files
 * 2. ImpactLens candidate tests
 * 3. Conventional source-to-test name mapping
 * 4. Broader repository test suite fallback
 * Eliminates duplicates, validates workspace containment, and tracks selection reasons & limitations.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { validateSafePath } from "../shared/utils/path-validator.ts";
import type { TestCandidate, TestSelectionResult } from "../shared/types/verification.ts";
import { discoverTests } from "./test-discovery.ts";

export interface SelectTestsOptions {
  workspaceRoot: string;
  changedFiles: string[];
  candidateTests?: TestCandidate[];
  explicitTests?: string[];
}

/**
 * Finds conventional test file candidates for a given source file.
 * e.g., "src/flask/cli.py" -> "tests/test_cli.py", "tests/cli_test.py", "tests/flask/test_cli.py"
 */
export function findConventionalTestsForFile(
  changedFile: string,
  allDiscoveredTests: string[]
): TestCandidate[] {
  const candidates: TestCandidate[] = [];
  const baseName = path.basename(changedFile, path.extname(changedFile));
  const dirName = path.dirname(changedFile);

  // If the changed file itself is already a test file
  if (baseName.startsWith("test_") || baseName.endsWith("_test")) {
    const matched = allDiscoveredTests.find((t) => t.endsWith(path.basename(changedFile)));
    if (matched) {
      candidates.push({
        path: matched,
        reason: `Changed file "${changedFile}" is itself an existing test file`,
        source: "convention",
        confidence: "high",
      });
      return candidates;
    }
  }

  // Conventional patterns:
  // test_<baseName>.py or <baseName>_test.py
  const expectedTestNames = [
    `test_${baseName}.py`,
    `${baseName}_test.py`,
  ];

  for (const discovered of allDiscoveredTests) {
    const discoveredBase = path.basename(discovered);
    if (expectedTestNames.includes(discoveredBase)) {
      candidates.push({
        path: discovered,
        reason: `Conventional test name match for source file "${changedFile}" (matched ${discoveredBase})`,
        source: "convention",
        confidence: "high",
      });
    }
  }

  return candidates;
}

/**
 * Scans test files to check if they statically import the changed module.
 * e.g., if changedFile is "src/flask/cli.py", checks if test contains "flask.cli", "from flask.cli", etc.
 */
export function findImportBasedTestsForFile(
  changedFile: string,
  allDiscoveredTests: string[],
  workspaceRoot: string
): TestCandidate[] {
  const candidates: TestCandidate[] = [];
  const baseName = path.basename(changedFile, path.extname(changedFile));
  
  // Skip if changed file is already a test
  if (baseName.startsWith("test_") || baseName.endsWith("_test")) {
    return candidates;
  }

  const cleanPath = changedFile.replace(/\\/g, "/").replace(/^src\//, "").replace(/\.py$/, "");
  const moduleDotted = cleanPath.replace(/\//g, ".");

  const searchPatterns = [
    new RegExp(`\\bimport\\s+([\\w.]*\\.)?${baseName}\\b`, "i"),
    new RegExp(`\\bfrom\\s+([\\w.]*\\.)?${baseName}\\s+import\\b`, "i"),
  ];

  if (moduleDotted.includes(".")) {
    const parentModule = moduleDotted.split(".").slice(0, -1).join(".");
    searchPatterns.push(new RegExp(`\\bfrom\\s+${parentModule}\\s+import\\s+([\\w,\\s]*\\b)?${baseName}\\b`, "i"));
    searchPatterns.push(new RegExp(`\\bimport\\s+${moduleDotted}\\b`, "i"));
  }

  for (const testRel of allDiscoveredTests) {
    const fullTestPath = path.join(workspaceRoot, testRel);
    if (!fs.existsSync(fullTestPath)) continue;

    try {
      const content = fs.readFileSync(fullTestPath, "utf-8");
      for (const pattern of searchPatterns) {
        if (pattern.test(content)) {
          candidates.push({
            path: testRel,
            reason: `Static import analysis: test imports "${baseName}" or "${moduleDotted}"`,
            source: "import",
            confidence: "high",
          });
          break;
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  return candidates;
}

/**
 * Selects and prioritizes tests based on changed files, ImpactLens candidates, and repository conventions.
 */
export async function selectTests(options: SelectTestsOptions): Promise<TestSelectionResult> {
  const { workspaceRoot, changedFiles, candidateTests, explicitTests } = options;
  const safeRoot = validateSafePath(workspaceRoot, workspaceRoot);

  const discovery = await discoverTests(safeRoot);
  const allDiscovered = discovery.testFiles;

  const selectedPathsSet = new Set<string>();
  const candidatesList: TestCandidate[] = [];
  const reasons: string[] = [];
  const limitations: string[] = [];

  // Helper to add candidate safely and deduplicate
  const addCandidate = (candidate: TestCandidate) => {
    try {
      const safeAbs = validateSafePath(candidate.path, safeRoot);
      const relative = path.relative(safeRoot, safeAbs).replace(/\\/g, "/");

      // Verify file exists on disk
      if (!fs.existsSync(safeAbs)) {
        limitations.push(`Candidate test path does not exist on disk: ${candidate.path}`);
        return;
      }

      if (!selectedPathsSet.has(relative)) {
        selectedPathsSet.add(relative);
        candidatesList.push({
          ...candidate,
          path: relative,
        });
        reasons.push(`[${candidate.source.toUpperCase()}] ${relative}: ${candidate.reason} (Confidence: ${candidate.confidence})`);
      }
    } catch (err) {
      limitations.push(`Rejected invalid test candidate path "${candidate.path}": ${(err as Error).message}`);
    }
  };

  // ----------------------------------------------------
  // Priority 1: Explicitly provided test files
  // ----------------------------------------------------
  if (explicitTests && explicitTests.length > 0) {
    for (const exp of explicitTests) {
      addCandidate({
        path: exp,
        reason: "Explicitly requested by user or central workflow",
        source: "explicit",
        confidence: "high",
      });
    }
  }

  // ----------------------------------------------------
  // Priority 2: ImpactLens candidate tests
  // ----------------------------------------------------
  if (candidateTests && candidateTests.length > 0) {
    for (const impactCandidate of candidateTests) {
      addCandidate({
        path: impactCandidate.path,
        reason: impactCandidate.reason || "Identified as affected test by ImpactLens analysis",
        source: "impact",
        confidence: impactCandidate.confidence || "high",
      });
    }
  }

  // ----------------------------------------------------
  // Priority 3: Conventional & Import-Based Source-to-Test Mapping
  // ----------------------------------------------------
  for (const changedFile of changedFiles) {
    // 3a. Conventional name mapping
    const conventionalMatches = findConventionalTestsForFile(changedFile, allDiscovered);
    for (const match of conventionalMatches) {
      addCandidate(match);
    }

    // 3b. Static import mapping
    const importMatches = findImportBasedTestsForFile(changedFile, allDiscovered, safeRoot);
    for (const match of importMatches) {
      addCandidate(match);
    }
  }

  // ----------------------------------------------------
  // Priority 4: Broader repository suite fallback
  // ----------------------------------------------------
  let fallbackToFullSuite = false;
  if (selectedPathsSet.size === 0) {
    fallbackToFullSuite = true;
    if (allDiscovered.length > 0) {
      reasons.push("No direct or conventional test mapping found for changed files. Selected all discovered tests as fallback.");
      limitations.push("Broad test suite selected because targeted mapping was unavailable; verification may include unrelated tests.");
      for (const disc of allDiscovered) {
        addCandidate({
          path: disc,
          reason: "Fallback to discovered repository test suite",
          source: "configuration",
          confidence: "low",
        });
      }
    } else {
      reasons.push("No test files could be discovered in the workspace.");
      limitations.push("Repository contains no discovered test files matching test_*.py or *_test.py.");
    }
  } else {
    limitations.push("Targeted subset of tests executed. Broader repository test suite was not run; untested edge cases may exist.");
  }

  return {
    selectedTests: Array.from(selectedPathsSet).sort(),
    candidates: candidatesList,
    fallbackToFullSuite,
    reasons,
    limitations,
  };
}
