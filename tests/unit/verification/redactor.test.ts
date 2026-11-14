import test from "node:test";
import assert from "node:assert/strict";
import {
  redactSecrets,
  redactObject,
  sanitizeEnvironment,
} from "../../../src/shared/utils/redactor.ts";

test("redactor: redacts OpenAI and Anthropic API keys", () => {
  const input = "Error calling api with key sk-1234567890abcdef1234567890 and sk-ant-api03-abcdef1234567890";
  const output = redactSecrets(input);

  assert.ok(!output.includes("sk-1234567890abcdef1234567890"));
  assert.ok(!output.includes("sk-ant-api03-abcdef1234567890"));
  assert.ok(output.includes("[REDACTED_API_KEY]"));
  assert.ok(output.includes("[REDACTED_ANTHROPIC_KEY]"));
});

test("redactor: redacts Bearer tokens and GitHub tokens", () => {
  const input = "Headers: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 and token ghp_1234567890abcdefghijklmnopqrstuvwxyz";
  const output = redactSecrets(input);

  assert.ok(!output.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
  assert.ok(!output.includes("ghp_1234567890abcdefghijklmnopqrstuvwxyz"));
  assert.ok(output.includes("Bearer [REDACTED_TOKEN]"));
  assert.ok(output.includes("[REDACTED_GITHUB_TOKEN]"));
});

test("redactor: redacts database connection passwords in URLs", () => {
  const input = "Connecting to postgres://admin:superSecretPassword123@db.example.com:5432/mydb";
  const output = redactSecrets(input);

  assert.ok(!output.includes("superSecretPassword123"));
  assert.ok(output.includes("[REDACTED_CREDENTIALS]"));
});

test("redactor: deeply redacts objects", () => {
  const data = {
    user: "alice",
    apiKey: "sk-99999999999999999999999",
    nested: {
      password: "secret_value_123",
      safe: "public_value",
    },
  };
  const sanitized = redactObject(data);

  assert.equal(sanitized.user, "alice");
  assert.equal(sanitized.apiKey, "[REDACTED_SECRET]");
  assert.equal(sanitized.nested.password, "[REDACTED_SECRET]");
  assert.equal(sanitized.nested.safe, "public_value");
});

test("redactor: sanitizeEnvironment strips secret variables", () => {
  const env = {
    PATH: "/bin:/usr/bin",
    OPENAI_API_KEY: "sk-abcdefghijklmnopqrstuvwxyz",
    DATABASE_URL: "postgres://user:pass@host/db",
    CUSTOM_SECRET_TOKEN: "some_secret_token",
    APP_NAME: "FlaskChallenge",
  };

  const sanitized = sanitizeEnvironment(env);

  assert.equal(sanitized.OPENAI_API_KEY, undefined);
  assert.equal(sanitized.DATABASE_URL, undefined);
  assert.equal(sanitized.CUSTOM_SECRET_TOKEN, undefined);
  assert.equal(sanitized.APP_NAME, "FlaskChallenge");
  assert.ok(sanitized.PATH.length > 0);
});
