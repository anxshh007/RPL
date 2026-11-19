// OWNER: Member 1 — thin wrapper over the official @truefoundry/trueforge-sdk.
// Only SDK methods that exist in the installed version's type definitions are used:
// sessions.create / createTurnStream / createTurnEvents / cancel, server.getCapabilities.
// Every SDK failure is mapped to a TrueForgeError (network / auth_config / timeout / rate_limit).
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { TrueForgeConfig } from '../config/configuration';
import { CancellationError, TrueForgeError } from './errors';

export type TurnEvent = TrueForgeApi.TurnStreamingEvent;

/** The subset of the SDK the client uses; tests pass a fake with the same shape. */
export interface TrueForgeSdk {
  server: { getCapabilities(options?: { abortSignal?: AbortSignal }): Promise<unknown> };
  sessions: {
    create(
      body: { agent: { name: string }; metadata?: Record<string, string> },
      options?: { abortSignal?: AbortSignal },
    ): Promise<{ data: { id: string } }>;
    createTurnStream(
      sessionId: string,
      body: { input: Array<{ type: 'user.message'; content: string }> },
      options?: { abortSignal?: AbortSignal },
    ): Promise<AsyncIterable<TurnEvent>>;
    createTurnEvents(
      sessionId: string,
      turnId: string,
      body: { events: TrueForgeApi.TurnUserEventMessage[] },
      options?: { abortSignal?: AbortSignal },
    ): Promise<unknown>;
    cancel(sessionId: string, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
  };
}

export class TrueForgeClient {
  private sdk?: TrueForgeSdk;

  constructor(
    private readonly config: TrueForgeConfig,
    sdk?: TrueForgeSdk,
  ) {
    this.sdk = sdk;
  }

  private async loadSdk(): Promise<TrueForgeSdk> {
    if (this.sdk) {
      return this.sdk;
    }
    if (!this.config.baseUrl) {
      throw new TrueForgeError('TrueForge is not configured: set repopilot.trueforge.baseUrl.', 'NOT_CONFIGURED');
    }
    // The SDK's CommonJS build sits in a "type": "module" package, so Node cannot require() it.
    // Load the ESM build with a real dynamic import (TypeScript would turn import() into require()).
    const mod = (await importEsm('@truefoundry/trueforge-sdk')) as { TrueForge: typeof TrueForge };
    this.sdk = new mod.TrueForge({
      baseUrl: this.config.baseUrl,
      ...(this.config.apiKey ? { token: this.config.apiKey } : {}),
      timeoutInSeconds: Math.max(1, Math.ceil(this.config.timeoutMs / 1000)),
    }) as unknown as TrueForgeSdk;
    return this.sdk;
  }

  async healthCheck(signal?: AbortSignal): Promise<boolean> {
    try {
      await (await this.loadSdk()).server.getCapabilities({ abortSignal: signal });
      return true;
    } catch {
      return false;
    }
  }

  async createSession(metadata: Record<string, string>, signal?: AbortSignal): Promise<string> {
    try {
      const res = await (await this.loadSdk()).sessions.create(
        { agent: { name: this.config.agentName }, metadata },
        { abortSignal: signal },
      );
      if (!res?.data?.id) {
        throw new TrueForgeError('TrueForge returned no session id.', 'TURN_FAILED');
      }
      return res.data.id;
    } catch (err) {
      throw this.mapError(err, signal);
    }
  }

  async *streamTurn(sessionId: string, prompt: string, signal?: AbortSignal): AsyncIterable<TurnEvent> {
    let stream: AsyncIterable<TurnEvent>;
    try {
      stream = await (await this.loadSdk()).sessions.createTurnStream(
        sessionId,
        { input: [{ type: 'user.message', content: prompt }] },
        { abortSignal: signal },
      );
    } catch (err) {
      throw this.mapError(err, signal);
    }
    // Each read races the abort signal, so cancel() returns at once even if the server goes quiet.
    const iterator = stream[Symbol.asyncIterator]();
    let rejectOnAbort: ((err: Error) => void) | undefined;
    const aborted = new Promise<never>((_, reject) => (rejectOnAbort = reject));
    aborted.catch(() => undefined);
    const onAbort = () => rejectOnAbort?.(new CancellationError(sessionId));
    if (signal?.aborted) onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      while (true) {
        const next = await Promise.race([iterator.next(), aborted]);
        if (next.done) {
          return;
        }
        yield next.value;
      }
    } catch (err) {
      throw this.mapError(err, signal);
    } finally {
      signal?.removeEventListener('abort', onAbort);
      void iterator.return?.().catch(() => undefined);
    }
  }

  async sendToolResponse(
    sessionId: string,
    turnId: string,
    response: { threadId: string; toolCallId: string; content: string },
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await (await this.loadSdk()).sessions.createTurnEvents(
        sessionId,
        turnId,
        { events: [{ type: 'user.tool_response', ...response }] },
        { abortSignal: signal },
      );
    } catch (err) {
      throw this.mapError(err, signal);
    }
  }

  async sendToolApproval(
    sessionId: string,
    turnId: string,
    approval: { threadId: string; toolCallId: string; allow: boolean; reason?: string },
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await (await this.loadSdk()).sessions.createTurnEvents(
        sessionId,
        turnId,
        {
          events: [
            {
              type: 'user.tool_approval',
              threadId: approval.threadId,
              toolCallId: approval.toolCallId,
              approval: approval.allow ? { status: 'allow' } : { status: 'deny', reason: approval.reason },
            },
          ],
        } as { events: TrueForgeApi.TurnUserEventMessage[] },
        { abortSignal: signal },
      );
    } catch (err) {
      throw this.mapError(err, signal);
    }
  }

  async cancelSession(sessionId: string): Promise<void> {
    try {
      await (await this.loadSdk()).sessions.cancel(sessionId);
    } catch {
      // best effort: the local run is already cancelled
    }
  }

  private mapError(err: unknown, signal?: AbortSignal): Error {
    if (err instanceof TrueForgeError || err instanceof CancellationError) {
      return err;
    }
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return new CancellationError('trueforge');
    }
    const e = err as { statusCode?: number; name?: string; message?: string; cause?: unknown } | undefined;
    const status = e?.statusCode;
    const text = `${e?.name ?? ''} ${e?.message ?? ''} ${String((e?.cause as Error | undefined)?.message ?? '')}`;
    if (e?.name === 'TrueForgeTimeoutError' || /timed? ?out/i.test(text)) {
      return new TrueForgeError('TrueForge did not answer in time.', 'TIMEOUT', true);
    }
    if (status === 401 || status === 403) {
      return new TrueForgeError('TrueForge rejected the credentials. Check the API key setting.', 'AUTH_FAILED');
    }
    if (status === 404) {
      return new TrueForgeError(`TrueForge could not find agent "${this.config.agentName}" or the endpoint.`, 'INVALID_CONFIG');
    }
    if (status === 429) {
      return new TrueForgeError('TrueForge rate limit reached. Try again shortly.', 'RATE_LIMITED', true);
    }
    if (typeof status === 'number') {
      return new TrueForgeError(`TrueForge request failed (HTTP ${status}).`, 'TURN_FAILED', status >= 500);
    }
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET/i.test(text)) {
      return new TrueForgeError('TrueForge server is unreachable at the configured baseUrl.', 'SERVER_OFFLINE', true);
    }
    return new TrueForgeError('TrueForge request failed.', 'TURN_FAILED');
  }
}

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
