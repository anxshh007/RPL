/**
 * ImpactLens: risk and confidence rules.
 *
 * One function, classifyImpact, turns the structural facts about an affected
 * file (how it is reached from the change) into a risk level, a confidence,
 * the name of the rule that decided it, and plain-English reasons.
 *
 * These rules are transparent heuristics. The result is an estimate of impact,
 * not a measurement: nothing here is statistically calibrated, and no numeric
 * score is produced (the optional AffectedFile.heuristicScore is left unset).
 *
 * ── Rules, in the order they are checked ──────────────────────────────────
 *
 *  #  Rule                    Risk    Applies when
 *  1  inferred-only           low     no all-observed path reaches the file;
 *                                     every route includes an inferred link
 *  2  multiple-direct-links   high    observed direct links to two or more
 *                                     changed files
 *  3  direct-dependency       high    an observed direct link to a changed file
 *  4  entry-or-config         high    the file name matches an entry-point or
 *                                     configuration pattern: __init__.py,
 *                                     app.py, cli.py, config*, settings*
 *  5  linked-test-or-doc      medium  the file is a test or a documentation file
 *  6  two-hop                 medium  two observed hops from a changed file
 *  7  distant                 low     three or more observed hops
 *
 * The first rule that applies is the matched rule and sets the risk. Rule 1 is
 * an override: weak evidence caps the risk at low whatever else is true. After
 * it the rules run from high to low, so the highest applicable risk wins.
 *
 * Every rule that applies contributes a reason, matched rule first. So a test
 * that imports a changed file is "direct-dependency" (high), and its reasons
 * also say that it is a test.
 *
 * ── Confidence ─────────────────────────────────────────────────────────────
 *
 *  high    observed, one hop
 *  medium  observed, two hops
 *  low     any inferred link on the path, or three or more hops
 *
 * Confidence describes how sure we are that the relationship exists. It is
 * separate from risk: a two-hop entry point is high risk, medium confidence.
 */
import type { Confidence, DependencyEdge, RiskLevel } from '../shared/contracts';
import type { ImpactTrace } from './impact-analyser';

export type ImpactRuleName =
  | 'inferred-only'
  | 'multiple-direct-links'
  | 'direct-dependency'
  | 'entry-or-config'
  | 'linked-test-or-doc'
  | 'two-hop'
  | 'distant';

export interface ImpactRule {
  readonly name: ImpactRuleName;
  readonly risk: RiskLevel;
  /** One line for documentation and the README table. */
  readonly summary: string;
}

/** The rules in the order they are checked. The first that applies is the matched rule. */
export const IMPACT_RULES: readonly ImpactRule[] = Object.freeze([
  {
    name: 'inferred-only',
    risk: 'low',
    summary: 'Linked to the change only through inferred links.',
  },
  {
    name: 'multiple-direct-links',
    risk: 'high',
    summary: 'Has observed direct links to two or more changed files.',
  },
  {
    name: 'direct-dependency',
    risk: 'high',
    summary: 'Has an observed direct link to a changed file.',
  },
  {
    name: 'entry-or-config',
    risk: 'high',
    summary: 'File name matches an entry-point or configuration pattern.',
  },
  {
    name: 'linked-test-or-doc',
    risk: 'medium',
    summary: 'A test or documentation file linked to the change.',
  },
  {
    name: 'two-hop',
    risk: 'medium',
    summary: 'Two observed hops from a changed file.',
  },
  {
    name: 'distant',
    risk: 'low',
    summary: 'Three or more observed hops from a changed file.',
  },
] as const);

/** File-name patterns for rule 4. A trailing "*" means "starts with". */
export const ENTRY_OR_CONFIG_PATTERNS: readonly string[] = Object.freeze([
  '__init__.py',
  'app.py',
  'cli.py',
  'config*',
  'settings*',
]);

export interface ImpactClassification {
  risk: RiskLevel;
  confidence: Confidence;
  /** The first rule that applied. */
  matchedRule: ImpactRuleName;
  /** At least one. The matched rule's reason comes first. */
  reasons: string[];
}

// ─────────────────────────── File kinds ───────────────────────────

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function directoriesOf(path: string): string[] {
  return path.split('/').slice(0, -1);
}

/** A file under a "tests" directory, or named test_*.py or *_test.py. */
export function isTestFile(path: string): boolean {
  const name = basenameOf(path);
  return (
    directoriesOf(path).includes('tests') || /^test_.*\.py$/.test(name) || /.+_test\.py$/.test(name)
  );
}

/** A file under a "docs" directory, or ending in .rst or .md. */
export function isDocFile(path: string): boolean {
  const name = basenameOf(path).toLowerCase();
  return directoriesOf(path).includes('docs') || name.endsWith('.rst') || name.endsWith('.md');
}

/** The entry-point or configuration pattern the file name matches, if any. */
export function entryOrConfigPattern(path: string): string | undefined {
  const name = basenameOf(path).toLowerCase();
  return ENTRY_OR_CONFIG_PATTERNS.find((pattern) =>
    pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
  );
}

// ───────────────────────────── Wording ─────────────────────────────

const OBSERVED_VERBS: Readonly<Record<DependencyEdge['kind'], string>> = {
  imports: 'imports',
  references: 'references',
  tests: 'tests',
};

const INFERRED_VERBS: Readonly<Record<DependencyEdge['kind'], string>> = {
  imports: 'appears to import',
  references: 'appears to reference',
  tests: 'appears to test',
};

function verbFor(edge: DependencyEdge): string {
  return edge.evidence === 'observed' ? OBSERVED_VERBS[edge.kind] : INFERRED_VERBS[edge.kind];
}

/**
 * Describes the relationship path from the affected file back to the change,
 * e.g. "imports src/flask/app.py, which imports src/flask/helpers.py, which
 * is being changed".
 */
function describePath(trace: ImpactTrace): string {
  const steps = [...trace.pathEdges].reverse().map((edge) => `${verbFor(edge)} ${edge.to}`);
  return `${steps.join(', which ')}, which is being changed`;
}

/** Changed files this file links to directly with observed evidence. Sorted, no repeats. */
function observedDirectTargets(trace: ImpactTrace): string[] {
  const targets = trace.directLinks
    .filter((link) => link.evidence === 'observed')
    .map((link) => link.to);
  return [...new Set(targets)];
}

// ───────────────────────────── Rules ─────────────────────────────

interface RuleMatch {
  readonly name: ImpactRuleName;
  readonly reason: string;
}

const RULE_ORDER: ReadonlyMap<ImpactRuleName, number> = new Map(
  IMPACT_RULES.map((rule, index) => [rule.name, index]),
);

const RISK_BY_RULE: ReadonlyMap<ImpactRuleName, RiskLevel> = new Map(
  IMPACT_RULES.map((rule) => [rule.name, rule.risk]),
);

/** The rule decided by evidence and hop count. Exactly one always applies. */
function hopRule(trace: ImpactTrace): RuleMatch {
  const route = describePath(trace);
  if (trace.pathEvidence === 'inferred') {
    const note =
      trace.distance === 1
        ? 'inferred, not observed in source'
        : 'the path includes an inferred link, not observed in source';
    return { name: 'inferred-only', reason: `${route} (${note})` };
  }
  if (trace.distance === 1) {
    return { name: 'direct-dependency', reason: route };
  }
  if (trace.distance === 2) {
    return { name: 'two-hop', reason: `is two hops from the change: ${route}` };
  }
  return { name: 'distant', reason: `is ${trace.distance} hops from the change: ${route}` };
}

/** Rules that can apply on top of the hop rule. */
function extraRules(trace: ImpactTrace): RuleMatch[] {
  const matches: RuleMatch[] = [];

  if (trace.pathEvidence === 'observed') {
    const targets = observedDirectTargets(trace);
    if (targets.length >= 2) {
      matches.push({
        name: 'multiple-direct-links',
        reason: `has direct links to ${targets.length} changed files: ${targets.join(', ')}`,
      });
    }
  }

  const pattern = entryOrConfigPattern(trace.path);
  if (pattern !== undefined) {
    matches.push({
      name: 'entry-or-config',
      reason: `is an entry point or configuration file (name matches "${pattern}")`,
    });
  }

  if (isTestFile(trace.path)) {
    matches.push({ name: 'linked-test-or-doc', reason: 'is a test file linked to the change' });
  } else if (isDocFile(trace.path)) {
    matches.push({
      name: 'linked-test-or-doc',
      reason: 'is a documentation file linked to the change',
    });
  }
  return matches;
}

/**
 * Extra context that is not a rule: an inferred direct link on a file that is
 * classified by a longer observed path.
 */
function inferredShortcutNotes(trace: ImpactTrace): string[] {
  if (trace.pathEvidence !== 'observed') {
    return [];
  }
  return trace.directLinks
    .filter((link) => link.evidence === 'inferred')
    .map((link) => `also ${verbFor(link)} ${link.to} directly (inferred, not observed in source)`);
}

function confidenceFor(trace: ImpactTrace): Confidence {
  if (trace.pathEvidence === 'inferred') {
    return 'low';
  }
  if (trace.distance === 1) {
    return 'high';
  }
  return trace.distance === 2 ? 'medium' : 'low';
}

/**
 * Classifies one affected file. See the table at the top of this file.
 *
 * Deterministic: the same trace always gives the same result, and the reasons
 * are always in the same order (matched rule first, then the other rules that
 * applied in rule order, then any notes).
 */
export function classifyImpact(trace: ImpactTrace): ImpactClassification {
  const hop = hopRule(trace);
  const matches = [hop, ...extraRules(trace)].sort(
    (a, b) => (RULE_ORDER.get(a.name) ?? 0) - (RULE_ORDER.get(b.name) ?? 0),
  );
  const matched = matches[0] ?? hop;

  return {
    risk: RISK_BY_RULE.get(matched.name) ?? 'low',
    confidence: confidenceFor(trace),
    matchedRule: matched.name,
    reasons: [...matches.map((match) => match.reason), ...inferredShortcutNotes(trace)],
  };
}
