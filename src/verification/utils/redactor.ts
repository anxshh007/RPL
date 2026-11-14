/**
 * Secret and credential redaction utility.
 * Scrubs tokens, passwords, and sensitive keys from command output and error logs.
 */

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // OpenAI API keys
  { pattern: /sk-[a-zA-Z0-9_-]{20,}/g, replacement: '[REDACTED_API_KEY]' },
  // Anthropic API keys
  { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g, replacement: '[REDACTED_ANTHROPIC_KEY]' },
  // Google / AIza API keys
  { pattern: /AIza[0-9A-Za-z-_]{35}/g, replacement: '[REDACTED_GOOGLE_KEY]' },
  // Bearer tokens
  { pattern: /Bearer\s+[a-zA-Z0-9_.\-+/=]{16,}/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  // GitHub tokens (ghp, gho, ghu, ghs, ghr)
  { pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  // Generic password in URLs (e.g. postgres://user:pass@host)
  { pattern: /(https?|postgres|mysql|mongodb):\/\/([^:]+):([^@]+)@/g, replacement: '$1://$2:[REDACTED_PASSWORD]@' },
];

export function redactSecrets(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let result = text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

const SENSITIVE_ENV_KEYS = [
  'TOKEN',
  'SECRET',
  'KEY',
  'PASSWORD',
  'AUTH',
  'CREDENTIAL',
  'PRIVATE',
];

export function sanitizeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleanEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    const upper = key.toUpperCase();
    const isSensitive = SENSITIVE_ENV_KEYS.some((sensitive) => upper.includes(sensitive));
    if (!isSensitive) {
      cleanEnv[key] = value;
    }
  }
  return cleanEnv;
}
