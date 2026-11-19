// OWNER: Member 1. Typed errors used inside the core agent, edits and MCP layers.
// Every class extends the shared RepoPilotError from src/shared/contracts, so
// toSafeError() classifies them by ErrorKind without any change to the contracts.
import { RepoPilotError } from '../shared/contracts';
import type { ErrorKind } from '../shared/contracts';

/** Base class that also carries a stable machine-readable code for logs and tests. */
export class CodedError extends RepoPilotError {
  constructor(
    kind: ErrorKind,
    message: string,
    readonly code: string,
    retryable = false,
  ) {
    super(kind, message, retryable);
    this.name = new.target.name;
  }
}

export class CancellationError extends CodedError {
  constructor(requestId: string) {
    super('cancelled', `Request "${requestId}" was cancelled.`, 'CANCELLED');
  }
}

export class ValidationError extends CodedError {
  constructor(message: string, code = 'VALIDATION_FAILED') {
    super('validation', message, code);
  }
}

/** Path outside the workspace, absolute, protected (.git, .env, node_modules…) or a symlink escape. */
export class SecurityError extends CodedError {
  constructor(message: string, code = 'PATH_REJECTED') {
    super('validation', message, code);
  }
}

/** A state change that needs explicit user hunk approval was attempted without it. */
export class ApprovalRequiredError extends CodedError {
  constructor(message: string) {
    super('validation', message, 'APPROVAL_REQUIRED');
  }
}

export type TrueForgeErrorCode =
  | 'SERVER_OFFLINE'
  | 'AUTH_FAILED'
  | 'INVALID_CONFIG'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'TURN_FAILED'
  | 'NOT_CONFIGURED';

const TRUEFORGE_KIND: Record<TrueForgeErrorCode, ErrorKind> = {
  SERVER_OFFLINE: 'network',
  AUTH_FAILED: 'auth_config',
  INVALID_CONFIG: 'auth_config',
  NOT_CONFIGURED: 'auth_config',
  TIMEOUT: 'timeout',
  RATE_LIMITED: 'rate_limit',
  TURN_FAILED: 'tool_error',
};

export class TrueForgeError extends CodedError {
  constructor(message: string, code: TrueForgeErrorCode, retryable = false) {
    super(TRUEFORGE_KIND[code], message, code, retryable);
  }
}

export function isAbortLike(err: unknown): boolean {
  return (
    err instanceof CancellationError ||
    (err instanceof Error && err.name === 'AbortError') ||
    (err instanceof RepoPilotError && err.kind === 'cancelled')
  );
}
