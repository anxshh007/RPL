/**
 * Safe Secret & Credential Redaction Engine
 * Prevents sensitive environment variables, passwords, API tokens, and secrets
 * from leaking into VerificationReports, logs, or MCP outputs.
 */

const REDACTION_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // Anthropic API Key (must be checked before generic sk-)
  { regex: /sk-ant-[a-zA-Z0-9_-]{16,}/g, replacement: "[REDACTED_ANTHROPIC_KEY]" },
  // OpenAI / Generic sk- API Key
  { regex: /sk-[a-zA-Z0-9_-]{20,}/g, replacement: "[REDACTED_API_KEY]" },
  // Google API Key / AI Studio
  { regex: /AIza[0-9A-Za-z-_]{35}/g, replacement: "[REDACTED_GOOGLE_API_KEY]" },
  // GitHub Tokens (ghp_, gho_, ghu_, ghs_, ghr_)
  { regex: /gh[pousr][-_][a-zA-Z0-9_]{20,}/g, replacement: "[REDACTED_GITHUB_TOKEN]" },
  // AWS Access Key ID
  { regex: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g, replacement: "[REDACTED_AWS_KEY]" },
  // Generic Bearer Tokens
  { regex: /Bearer\s+[a-zA-Z0-9_\-\.]{16,}/gi, replacement: "Bearer [REDACTED_TOKEN]" },
  // Private Key Headers
  { regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, replacement: "[REDACTED_PRIVATE_KEY]" },
  // Basic Auth in URLs (e.g. http://user:password@host)
  { regex: /(https?:\/\/)([^:\/\s]+):([^@\/\s]+)@/g, replacement: "$1$2:[REDACTED_PASSWORD]@" },
  // Key-value password/secret assignments (e.g. password="xxx", token=xxx)
  { regex: /(password|passwd|secret|token|api_key|apikey|access_token|auth_token)\s*[:=]\s*["']?([a-zA-Z0-9_\-~@#%^&*!]{6,})["']?/gi, replacement: "$1=[REDACTED_SECRET]" },
  // Database connection strings
  { regex: /(postgres|mysql|mongodb|redis):\/\/[^:\s]+:[^@\s]+@/gi, replacement: "$1://[USER]:[REDACTED_CREDENTIALS]@" },
];

/**
 * Redacts secrets from any given string.
 */
export function redactSecrets(input: string): string {
  if (!input || typeof input !== "string") {
    return "";
  }
  let sanitized = input;
  for (const { regex, replacement } of REDACTION_PATTERNS) {
    sanitized = sanitized.replace(regex, replacement);
  }
  return sanitized;
}

/**
 * Redacts secrets from an object deeply (returns a sanitized clone).
 */
export function redactObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return redactSecrets(obj) as unknown as T;
  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item)) as unknown as T;
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (/password|secret|token|key|credential|auth/i.test(key) && typeof value === "string") {
        result[key] = "[REDACTED_SECRET]";
      } else {
        result[key] = redactObject(value);
      }
    }
    return result as T;
  }
  return obj;
}

/**
 * Returns a sanitized copy of an environment variables map,
 * stripping high-risk credentials and redacting sensitive values.
 */
export function sanitizeEnvironment(env: Record<string, string | undefined>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const BLOCKED_VARS = new Set([
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "DATABASE_URL",
    "SECRET_KEY",
    "SECRET_KEY_BASE",
    "ENCRYPTION_KEY",
  ]);

  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    if (BLOCKED_VARS.has(key.toUpperCase())) {
      continue; // completely strip out
    }
    if (/password|secret|token|api_key|credential/i.test(key)) {
      continue; // strip out generic credential env vars
    }
    sanitized[key] = redactSecrets(value);
  }
  return sanitized;
}
