/**
 * RepoPilot AI — TestSheriff Verification Errors
 * Categorized error hierarchy for verification lifecycle failures.
 */

export abstract class VerificationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends VerificationError {
  constructor(message: string, details?: unknown) {
    super(message, "VALIDATION_ERROR", details);
  }
}

export class SecurityViolationError extends VerificationError {
  constructor(message: string, details?: unknown) {
    super(message, "SECURITY_VIOLATION", details);
  }
}

export class ExecutionTimeoutError extends VerificationError {
  constructor(
    message: string,
    public readonly timeoutMs: number,
    public readonly partialOutput?: string
  ) {
    super(message, "EXECUTION_TIMEOUT", { timeoutMs });
  }
}

export class ExecutionCancellationError extends VerificationError {
  constructor(
    message: string = "Test execution was cancelled by user or central agent",
    public readonly partialOutput?: string
  ) {
    super(message, "EXECUTION_CANCELLED", { partialOutput });
  }
}

export class RunnerNotFoundError extends VerificationError {
  constructor(runner: string, details?: unknown) {
    super(`Test runner "${runner}" is not available or not installed in the workspace environment`, "RUNNER_NOT_FOUND", details);
  }
}

export class ParserError extends VerificationError {
  constructor(message: string, public readonly rawOutput?: string) {
    super(message, "PARSER_ERROR", { rawOutput });
  }
}
