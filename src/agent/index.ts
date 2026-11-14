// OWNER: Member 1 — composition root. The extension (Member 5) calls createRepoPilot() and nothing else.
import type { AgentController } from '../shared/contracts';
import { createRepositoryIntelligence } from '../repository';
import { createImpactAnalyser } from '../impact';
import { createVerificationService } from '../verification';
import { createEditService } from '../edits';
import { RepoPilotController } from './controller';

export interface RepoPilotOptions {
  tokenBudget?: number;
}

export function createRepoPilot(options: RepoPilotOptions = {}): AgentController {
  return new RepoPilotController({
    repository: createRepositoryIntelligence(options.tokenBudget),
    impact: createImpactAnalyser(),
    verification: createVerificationService(),
    edits: createEditService(),
  });
}

export { RepoPilotController } from './controller';
