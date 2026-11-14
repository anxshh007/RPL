import assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import {
  redactSecrets,
  redactObject,
  sanitizeEnvironment,
} from "../src/shared/utils/redactor.ts";
import {
  generateFailureHypothesis,
  buildVerificationReport,
  parsePytestSummaryCounts,
} from "../src/verification/result-parser.ts";
import {
  validateExecutable,
  validateArguments,
} from "../src/verification/process/safe-process.ts";
import { validateSafePath, SecurityPathError } from "../src/shared/utils/path-validator.ts";
import { SecurityViolationError } from "../src/verification/errors.ts";
import { verifyChanges } from "../src/verification/index.ts";

console.log("================================================================================");
console.log("           TESTSHERIFF INDEPENDENT SECURITY & INTEGRITY AUDIT                   ");
console.log("================================================================================");

let passedChecks = 0;
let totalChecks = 0;

function check(name: string, fn: () => void) {
  totalChecks++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedChecks++;
  } catch (err: any) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

// -----------------------------------------------------------------------------
// CONTROL 1: SECRET REDACTION
// -----------------------------------------------------------------------------
console.log("\n--- AUDITING CONTROL 1: SECRET REDACTION (src/shared/utils/redactor.ts) ---");

check("1.1: Anthropic API keys redacted", () => {
  const secret = "sk-ant-api03-abcdef1234567890abcdef123456";
  const text = `Failed with key ${secret}`;
  const out = redactSecrets(text);
  assert.ok(!out.includes(secret));
  assert.ok(out.includes("[REDACTED_ANTHROPIC_KEY]"));
});

check("1.2: OpenAI / Generic sk- API keys redacted", () => {
  const secret = "sk-abcdef1234567890abcdef123456";
  const text = `Authorization: ${secret}`;
  const out = redactSecrets(text);
  assert.ok(!out.includes(secret));
  assert.ok(out.includes("[REDACTED_API_KEY]"));
});

check("1.3: Google API key / AI Studio key redacted", () => {
  const secret = "AIzaSyD-1234567890abcdefghijklmnopqrstu";
  const text = `Google Cloud key: ${secret}`;
  const out = redactSecrets(text);
  assert.ok(!out.includes(secret));
  assert.ok(out.includes("[REDACTED_GOOGLE_API_KEY]"));
});

check("1.4: GitHub tokens (ghp, gho, ghu, ghs, ghr) redacted", () => {
  for (const prefix of ["ghp", "gho", "ghu", "ghs", "ghr"]) {
    const token = `${prefix}_abcdef1234567890abcdef123456`;
    const text = `GitHub token: ${token}`;
    const out = redactSecrets(text);
    assert.ok(!out.includes(token), `Failed to redact ${prefix}`);
    assert.ok(out.includes("[REDACTED_GITHUB_TOKEN]"), `Missing replacement for ${prefix}`);
  }
});

check("1.5: AWS Access Key IDs redacted", () => {
  for (const prefix of ["AKIA", "ASIA", "AGPA", "AIDA", "AROA", "AIPA", "ANPA", "ANVA"]) {
    const key = `${prefix}1234567890ABCDEF`;
    const text = `AWS Key: ${key}`;
    const out = redactSecrets(text);
    assert.ok(!out.includes(key), `Failed to redact ${prefix}`);
    assert.ok(out.includes("[REDACTED_AWS_KEY]"), `Missing replacement for ${prefix}`);
  }
});

check("1.6: Generic Bearer tokens redacted", () => {
  const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
  const text = `Authorization: Bearer ${token}`;
  const out = redactSecrets(text);
  assert.ok(!out.includes(token));
  assert.ok(out.includes("Bearer [REDACTED_TOKEN]"));
});

check("1.7: Private RSA/EC/OpenSSH keys redacted", () => {
  const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0m\n-----END RSA PRIVATE KEY-----";
  const text = `Private key loaded:\n${key}\nContinuing...`;
  const out = redactSecrets(text);
  assert.ok(!out.includes("MIIEowIBAAKCAQEA0m"));
  assert.ok(out.includes("[REDACTED_PRIVATE_KEY]"));
});

check("1.8: Basic Auth URL credentials redacted", () => {
  const url = "https://admin:superSecretPass123@api.internal.org/endpoint";
  const out = redactSecrets(url);
  assert.ok(!out.includes("superSecretPass123"));
  assert.ok(out.includes("https://admin:[REDACTED_PASSWORD]@api.internal.org/endpoint"));
});

check("1.9: Key-value password/secret assignments redacted", () => {
  const text = "password='mySecretPassword' and api_key=\"keySecret123\" and token: secretTokenVal";
  const out = redactSecrets(text);
  assert.ok(!out.includes("mySecretPassword"));
  assert.ok(!out.includes("keySecret123"));
  assert.ok(!out.includes("secretTokenVal"));
});

check("1.10: Database connection strings redacted", () => {
  const dbs = [
    "postgres://user:dbpass123@localhost:5432/mydb",
    "mysql://root:mysqlPass@127.0.0.1:3306/db",
    "mongodb://app:mongoSecret@cluster0.net/test",
    "redis://default:redisSecret@cache:6379",
  ];
  for (const db of dbs) {
    const out = redactSecrets(db);
    assert.ok(!out.includes("dbpass123") && !out.includes("mysqlPass") && !out.includes("mongoSecret") && !out.includes("redisSecret"));
    assert.ok(out.includes("[REDACTED_CREDENTIALS]"));
  }
});

check("1.11: Deep object sanitization", () => {
  const obj = {
    user: "developer",
    apiKey: "sk-abcdef1234567890abcdef123456",
    nested: {
      password: "nestedPassword123",
      publicProperty: "safeValue",
      tokens: ["ghp_abcdef1234567890abcdef123456"],
    },
  };
  const sanitized: any = redactObject(obj);
  assert.equal(sanitized.apiKey, "[REDACTED_SECRET]");
  assert.equal(sanitized.nested.password, "[REDACTED_SECRET]");
  assert.equal(sanitized.nested.publicProperty, "safeValue");
  assert.ok(!sanitized.nested.tokens[0].includes("abcdef1234567890abcdef123456"));
});

check("1.12: Environment variable sanitization", () => {
  const env = {
    PATH: "C:\\Windows\\System32",
    OPENAI_API_KEY: "sk-1234567890abcdef1234567890",
    ANTHROPIC_API_KEY: "sk-ant-1234567890abcdef1234567890",
    AWS_SECRET_ACCESS_KEY: "SECRET123456",
    GITHUB_TOKEN: "ghp_123456",
    DATABASE_URL: "postgres://u:p@h/d",
    CUSTOM_API_KEY: "custom123456",
    SAFE_APP_VAR: "RepoPilot",
  };
  const sanitized = sanitizeEnvironment(env);
  assert.equal(sanitized.OPENAI_API_KEY, undefined);
  assert.equal(sanitized.ANTHROPIC_API_KEY, undefined);
  assert.equal(sanitized.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(sanitized.GITHUB_TOKEN, undefined);
  assert.equal(sanitized.DATABASE_URL, undefined);
  assert.equal(sanitized.CUSTOM_API_KEY, undefined);
  assert.equal(sanitized.SAFE_APP_VAR, "RepoPilot");
  assert.equal(sanitized.PATH, "C:\\Windows\\System32");
});

// -----------------------------------------------------------------------------
// CONTROL 2: ZERO HALLUCINATIONS IN FAILURE HYPOTHESES
// -----------------------------------------------------------------------------
console.log("\n--- AUDITING CONTROL 2: ZERO HALLUCINATIONS IN FAILURE HYPOTHESES ---");

const knownExceptions = [
  { err: "AssertionError: Expected 200 but got 500", expected: "assertion check" },
  { err: "assert 5 == 10", expected: "assertion check" },
  { err: "ModuleNotFoundError: No module named 'flask'", expected: "required module or import was not found" },
  { err: "ImportError: cannot import name 'cli' from 'flask'", expected: "required module or import was not found" },
  { err: "AttributeError: 'NoneType' object has no attribute 'get'", expected: "attribute or method was accessed on an object that does not define it" },
  { err: "TypeError: get_debug_flag() takes 0 positional arguments but 1 was given", expected: "called with invalid arguments, unexpected types, or mismatched parameter count" },
  { err: "KeyError: 'DATABASE_PORT'", expected: "dictionary or mapping key was missing" },
  { err: "IndexError: list index out of range", expected: "sequence index was accessed out of range" },
  { err: "PermissionError: [Errno 13] Permission denied", expected: "permission was denied" },
  { err: "FileNotFoundError: [Errno 2] No such file or directory", expected: "file or path expected by the test does not exist" },
];

for (const { err, expected } of knownExceptions) {
  check(`2.1: Grounded hypothesis for ${err.split(":")[0]}`, () => {
    const hyp = generateFailureHypothesis(err);
    assert.ok(hyp.startsWith("[Hypothesis]"));
    assert.ok(hyp.includes(expected), `Expected "${expected}" in "${hyp}"`);
  });
}

check("2.2: Unknown exception strictly defaults to unhandled exception without hallucinations", () => {
  const unknownError = "WeirdCustomProtocolError: code 0x892 failed in subsystem";
  const hyp = generateFailureHypothesis(unknownError);
  assert.equal(
    hyp,
    "[Hypothesis] Test execution encountered an unhandled exception. Review traceback and failure message for details."
  );
  // Strictly verify no invented explanation
  assert.ok(!hyp.includes("WeirdCustomProtocolError"));
  assert.ok(!hyp.includes("probable cause"));
});

check("2.3: VerificationReport truthfulness & limitation disclosures on truncated / incomplete output", () => {
  const fakeProcessResult: any = {
    exitCode: 1,
    stdout: "Incomplete log output without summary line...",
    stderr: "",
    combinedOutput: "Incomplete log output without summary line...",
    durationMs: 500,
    timedOut: false,
    cancelled: false,
    truncated: true,
  };

  const report = buildVerificationReport({
    requestId: "test-truthfulness-req",
    runner: "pytest",
    commandLabel: "pytest tests/",
    selectedTests: ["tests/test_cli.py"],
    processResult: fakeProcessResult,
    selectionLimitations: ["Selective test subset"],
  });

  assert.equal(report.outputTruncated, true);
  // Verify limitations truthfully inform developer of output issues
  assert.ok(report.limitations.some((l) => l.includes("truncated")));
  assert.ok(report.limitations.some((l) => l.includes("could not be fully parsed")));
  assert.ok(report.limitations.some((l) => l.includes("Selective test subset")));
});

// -----------------------------------------------------------------------------
// CONTROL 3: READ-ONLY EXECUTION BOUNDARIES & SAFETY
// -----------------------------------------------------------------------------
console.log("\n--- AUDITING CONTROL 3: READ-ONLY EXECUTION BOUNDARIES & PROCESS SAFETY ---");

const FIXTURE_DIR = path.resolve("tests/fixtures/sample-flask-repo");

function hashAllFiles(dir: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  const entries = fs.readdirSync(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      const full = path.join(entry.parentPath || dir, entry.name);
      const content = fs.readFileSync(full);
      hashes[path.relative(dir, full).replace(/\\/g, "/")] = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");
    }
  }
  return hashes;
}

check("3.1: Strict workspace non-modification verified via SHA-256 fixture hashes", async () => {
  const before = hashAllFiles(FIXTURE_DIR);

  process.env.TESTSHERIFF_MOCK_OUTPUT = "2 passed in 0.05s";
  process.env.TESTSHERIFF_MOCK_EXITCODE = "0";

  try {
    await verifyChanges({
      requestId: "audit-integrity-check",
      workspaceRoot: FIXTURE_DIR,
      changedFiles: ["src/flask/cli.py"],
    });
  } finally {
    delete process.env.TESTSHERIFF_MOCK_OUTPUT;
    delete process.env.TESTSHERIFF_MOCK_EXITCODE;
  }

  const after = hashAllFiles(FIXTURE_DIR);
  assert.deepEqual(before, after, "Fixture files were modified during verification!");
});

check("3.2: Path validator rejects directory traversal with '..'", () => {
  assert.throws(
    () => validateSafePath("../outside-repo/secret.txt", FIXTURE_DIR),
    SecurityPathError
  );
  assert.throws(
    () => validateSafePath("..\\..\\Windows\\System32\\cmd.exe", FIXTURE_DIR),
    SecurityPathError
  );
});

check("3.3: Path validator rejects absolute paths outside workspace", () => {
  const outsidePath = process.platform === "win32" ? "C:\\Windows\\System32" : "/etc/passwd";
  assert.throws(
    () => validateSafePath(outsidePath, FIXTURE_DIR),
    SecurityPathError
  );
});

check("3.4: Executable validator rejects unauthorized binaries", () => {
  const dangerousExecutables = ["bash", "sh", "cmd.exe", "powershell.exe", "curl", "wget", "rm", "netcat"];
  for (const exe of dangerousExecutables) {
    assert.throws(
      () => validateExecutable(exe, FIXTURE_DIR),
      SecurityViolationError,
      `Failed to reject dangerous executable: ${exe}`
    );
  }
});

check("3.5: Argument validator rejects forbidden commands and destructive flags", () => {
  const dangerousArgs = [
    ["--upgrade", "pip"],
    ["pip", "install", "malicious-pkg"],
    ["sudo", "pytest"],
    ["rm", "-rf", "/"],
    ["del", "C:\\*"],
    ["format", "C:"],
    ["runas", "/user:admin", "cmd.exe"],
  ];
  for (const args of dangerousArgs) {
    assert.throws(
      () => validateArguments(args),
      SecurityViolationError,
      `Failed to reject dangerous argument list: ${args.join(" ")}`
    );
  }
});

console.log("\n================================================================================");
console.log(`AUDIT COMPLETE: All ${passedChecks}/${totalChecks} security & integrity checks PASSED!`);
console.log("================================================================================");
