/** Entry point for the ImpactLens fixtures. */
import { basicFixtures } from './contexts';
import type { ImpactFixture } from './helpers';
import { miniFlaskFixtures } from './mini-flask';

export * from './helpers';
export * from './contexts';
export * from './mini-flask';
export * from './sample-report';

/** Every fixture, in a fixed order. */
export const allFixtures: readonly ImpactFixture[] = Object.freeze([
  ...basicFixtures,
  ...miniFlaskFixtures,
]);
