/**
 * Safe Structured Logger
 * Emits logs with automatic redaction of sensitive credentials.
 */

import { redactSecrets } from "./redactor.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export class SafeLogger {
  constructor(private readonly moduleName: string = "TestSheriff") {}

  private formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const redactedMessage = redactSecrets(message);
    const prefix = `[${timestamp}] [${this.moduleName}] [${level.toUpperCase()}]`;
    if (!context) {
      return `${prefix} ${redactedMessage}`;
    }
    const safeContext = JSON.stringify(context, (_key, val) =>
      typeof val === "string" ? redactSecrets(val) : val
    );
    return `${prefix} ${redactedMessage} ${safeContext}`;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (process.env.DEBUG || process.env.VERBOSE) {
      console.debug(this.formatMessage("debug", message, context));
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (process.env.MCP_STDIO === "1") {
      console.error(this.formatMessage("info", message, context));
    } else {
      console.info(this.formatMessage("info", message, context));
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    console.error(this.formatMessage("warn", message, context));
  }

  error(message: string, context?: Record<string, unknown>): void {
    console.error(this.formatMessage("error", message, context));
  }
}

export const logger = new SafeLogger("TestSheriff");
