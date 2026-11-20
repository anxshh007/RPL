// OWNER: Member 1 — TrueForge connection settings, validated with Zod (D-11).
// D-15: repopilot.trueforge.baseUrl ships empty. With no baseUrl the agent loop is
// reported as "not configured"; nothing is guessed.
import { z } from 'zod';
import { TrueForgeError } from '../agent/errors';

export const TrueForgeConfigSchema = z.object({
  baseUrl: z.string().trim().default(''),
  /** Bearer token. Never logged or sent anywhere except the configured baseUrl. */
  apiKey: z.string().optional(),
  /** Name of a saved agent on the TrueForge server. Used only when `model` is empty. */
  agentName: z.string().min(1).default('repopilot-core'),
  /**
   * Model as "provider/model" (TrueForge's Model.name, e.g. "openai/gpt-5.2"). When set, RepoPilot
   * sends its own agent definition with each session (instructions + the RepoPilot connector),
   * so no agent has to be created on the server first.
   */
  model: z
    .string()
    .trim()
    .regex(/^$|^[\w.-]+\/[\w.:-]+$/, 'model must look like "provider/model"')
    .default(''),
  /** Name of the RepoPilot MCP connector in TrueForge (Settings → Connectors). */
  connectorName: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'connectorName: lowercase letters, digits and dashes')
    .default('repopilot'),
  timeoutMs: z.number().int().positive().max(600_000).default(120_000),
}).strict();

export type TrueForgeConfig = z.infer<typeof TrueForgeConfigSchema>;

export function parseTrueForgeConfig(raw: Partial<TrueForgeConfig> = {}): TrueForgeConfig {
  const result = TrueForgeConfigSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new TrueForgeError(`Invalid TrueForge settings: ${detail}`, 'INVALID_CONFIG');
  }
  const config = result.data;
  if (config.baseUrl) {
    let url: URL;
    try {
      url = new URL(config.baseUrl);
    } catch {
      throw new TrueForgeError('Invalid TrueForge settings: baseUrl is not a valid URL.', 'INVALID_CONFIG');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new TrueForgeError('Invalid TrueForge settings: baseUrl must use http or https.', 'INVALID_CONFIG');
    }
    config.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }
  return config;
}

export function isTrueForgeConfigured(config: TrueForgeConfig): boolean {
  return config.baseUrl.length > 0;
}
