/** Error classification shared by every module (Member 1 brief, Phase D). */
export type ErrorKind =
  | 'network'
  | 'auth_config'
  | 'rate_limit'
  | 'timeout'
  | 'tool_error'
  | 'validation'
  | 'cancelled'
  | 'internal';

/** Safe to show in the UI: no stack traces, keys, tokens or env values. */
export interface SafeError {
  kind: ErrorKind;
  message: string;
  retryable: boolean;
}

export class RepoPilotError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'RepoPilotError';
  }

  toSafe(): SafeError {
    return { kind: this.kind, message: this.message, retryable: this.retryable };
  }
}

export function toSafeError(err: unknown): SafeError {
  if (err instanceof RepoPilotError) {
    return err.toSafe();
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return { kind: 'cancelled', message: 'Request cancelled.', retryable: false };
  }
  return { kind: 'internal', message: 'Unexpected error. See the RepoPilot output log.', retryable: false };
}
