/**
 * Typed message protocol between the extension host and the webview (Member 5 §6).
 * The host validates every inbound message; the webview never sends paths or commands
 * that the host executes blindly.
 */
import type { HunkDecision } from './domain';
import type { RepoPilotEvent } from './events';

/** Webview → extension host */
export type WebviewToHost =
  | { type: 'ui.ready' }
  | { type: 'ui.submit'; instruction: string; mode: 'inline' | 'agent' }
  | { type: 'ui.cancel'; requestId: string }
  | { type: 'ui.applyDecisions'; requestId: string; decisions: HunkDecision[] }
  | { type: 'ui.undo'; requestId: string }
  | { type: 'ui.openDiff'; requestId: string; path: string }
  | { type: 'ui.setModel'; model: string };

/** Extension host → webview */
export type HostToWebview =
  | { type: 'host.event'; event: RepoPilotEvent }
  | { type: 'host.workspace'; available: boolean; name?: string }
  | { type: 'host.error'; message: string }
  | { type: 'host.model'; model: string };

const INBOUND_TYPES = new Set<WebviewToHost['type']>([
  'ui.ready',
  'ui.submit',
  'ui.cancel',
  'ui.applyDecisions',
  'ui.undo',
  'ui.openDiff',
  'ui.setModel',
]);

/** Minimal structural check. Member 1 replaces this with Zod schemas once Zod is installed. */
export function isWebviewToHost(value: unknown): value is WebviewToHost {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const msg = value as { type?: unknown };
  return typeof msg.type === 'string' && INBOUND_TYPES.has(msg.type as WebviewToHost['type']);
}
