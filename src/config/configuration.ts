// OWNER: Member 1 — TrueForge connection settings, validated with Zod (D-11).
// D-15: repopilot.trueforge.baseUrl ships empty. With no baseUrl the agent loop is
// reported as "not configured"; nothing is guessed.
import { z } from 'zod';
import { TrueForgeError } from '../agent/errors';

export const TrueForgeConfigSchema = z.object({
  baseUrl: z.string().trim().default(''),
  /** Bearer token. Never logged or sent anywhere except the configured baseUrl. */
  apiKey: z.string().optional(),
  /** Name of the agent configured on the TrueForge server. */
  agentName: z.string().min(1).default('repopilot-core'),
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
