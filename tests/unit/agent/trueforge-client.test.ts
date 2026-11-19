// TrueForge client and settings (owner: Member 1): SDK failures map to safe, classified errors;
// nothing is sent when no baseUrl is configured (D-15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrueForgeClient } from '../../../src/agent';
import type { TrueForgeSdk } from '../../../src/agent';
import { parseTrueForgeConfig, isTrueForgeConfigured } from '../../../src/config/configuration';
import { toSafeError } from '../../../src/shared/contracts';

const config = parseTrueForgeConfig({ baseUrl: 'http://127.0.0.1:9', apiKey: 'sk-secret-123' });

function failingSdk(err: unknown): TrueForgeSdk {
  const fail = async () => {
    throw err;
  };
  return { server: { getCapabilities: fail }, sessions: { create: fail, createTurnStream: fail, createTurnEvents: fail, cancel: fail } };
}

test('settings: empty baseUrl = not configured; bad URLs are rejected; trailing slash trimmed', () => {
  assert.equal(isTrueForgeConfigured(parseTrueForgeConfig({})), false);
  assert.equal(parseTrueForgeConfig({ baseUrl: 'https://tf.example.com/' }).baseUrl, 'https://tf.example.com');
  assert.throws(() => parseTrueForgeConfig({ baseUrl: 'not a url' }), /baseUrl/);
  assert.throws(() => parseTrueForgeConfig({ baseUrl: 'file:///etc/passwd' }), /http/);
});

test('an unconfigured client refuses before any network call', async () => {
  const client = new TrueForgeClient(parseTrueForgeConfig({}));
  await assert.rejects(client.createSession({}), (e: unknown) => toSafeError(e).kind === 'auth_config');
});

const cases: Array<[string, unknown, string, boolean]> = [
  ['401', Object.assign(new Error('unauthorized'), { statusCode: 401 }), 'auth_config', false],
  ['404', Object.assign(new Error('missing'), { statusCode: 404 }), 'auth_config', false],
  ['429', Object.assign(new Error('slow down'), { statusCode: 429 }), 'rate_limit', true],
  ['503', Object.assign(new Error('down'), { statusCode: 503 }), 'tool_error', true],
  ['offline', Object.assign(new TypeError('fetch failed'), { cause: new Error('connect ECONNREFUSED 127.0.0.1:9') }), 'network', true],
  ['timeout', Object.assign(new Error('Timeout exceeded'), { name: 'TrueForgeTimeoutError' }), 'timeout', true],
];

for (const [label, err, kind, retryable] of cases) {
  test(`SDK error "${label}" → ${kind}`, async () => {
    const client = new TrueForgeClient(config, failingSdk(err));
    await assert.rejects(client.createSession({ requestId: 'r' }), (e: unknown) => {
      const safe = toSafeError(e);
      return safe.kind === kind && safe.retryable === retryable && !safe.message.includes('sk-secret');
    });
  });
}

test('healthCheck is false when the server is unreachable and true when it answers', async () => {
  assert.equal(await new TrueForgeClient(config, failingSdk(new TypeError('fetch failed'))).healthCheck(), false);
  const ok: TrueForgeSdk = { ...failingSdk(null), server: { getCapabilities: async () => ({}) } };
  assert.equal(await new TrueForgeClient(config, ok).healthCheck(), true);
});
