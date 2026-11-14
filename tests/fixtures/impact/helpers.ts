/**
 * Builders for ImpactLens test fixtures.
 *
 * Fixtures are TypeScript modules (not JSON) because tsc only compiles .ts and
 * the tests run from out/.
 *
 * Every fixture is deep-frozen. ImpactLens is a read-only service, so any
 * attempt to mutate its input throws in the tests instead of passing silently.
 */
import type {
  ChangeRequest,
  DependencyEdge,
  Evidence,
  RepositoryContext,
} from '../../../src/shared/contracts';

/** A named input for ImpactLens: what the agent would pass to analyseImpact. */
export interface ImpactFixture {
  /** Stable and unique. The requestId is `fixture-${name}`. */
  name: string;
  /** What the fixture models and why it exists. */
  description: string;
  request: ChangeRequest;
  context: RepositoryContext;
  /** Present only when the fixture models a call made with proposed files. */
  proposedFiles?: string[];
}

export interface ImpactFixtureSpec {
  name: string;
  description: string;
  request?: Partial<Omit<ChangeRequest, 'requestId'>>;
  context?: Partial<Omit<RepositoryContext, 'requestId'>>;
  proposedFiles?: string[];
}

/** `from` depends on `to`. Defaults to an observed import. */
export function edge(
  from: string,
  to: string,
  kind: DependencyEdge['kind'] = 'imports',
  evidence: Evidence = 'observed',
): DependencyEdge {
  return { from, to, kind, evidence };
}

export function makeRequest(
  requestId: string,
  overrides: Partial<Omit<ChangeRequest, 'requestId'>> = {},
): ChangeRequest {
  return {
    requestId,
    instruction: 'Fixture request.',
    mode: 'agent',
    explicitFileMentions: [],
    explicitSymbolMentions: [],
    ...overrides,
  };
}

export function makeContext(
  requestId: string,
  overrides: Partial<Omit<RepositoryContext, 'requestId'>> = {},
): RepositoryContext {
  return {
    requestId,
    relevantFiles: [],
    relevantSymbols: [],
    dependencyEdges: [],
    unresolvedImports: [],
    tokenEstimate: 0,
    tokenBudget: 8000,
    budgetConflicts: [],
    warnings: [],
    ...overrides,
  };
}

/** Recursively freezes plain objects and arrays, and returns the same value. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function defineFixture(spec: ImpactFixtureSpec): ImpactFixture {
  const requestId = `fixture-${spec.name}`;
  const fixture: ImpactFixture = {
    name: spec.name,
    description: spec.description,
    request: makeRequest(requestId, spec.request),
    context: makeContext(requestId, spec.context),
  };
  if (spec.proposedFiles !== undefined) {
    fixture.proposedFiles = [...spec.proposedFiles];
  }
  return deepFreeze(fixture);
}
