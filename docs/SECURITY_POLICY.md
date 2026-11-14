# TestSheriff Security & Sandboxing Policy
**Zero-Trust Execution for Untrusted Repository Code**

---

## 1. Threat Model & Mitigations

When an AI coding agent operates on a software repository, test files and configuration files must be treated as untrusted data and executable code. TestSheriff mitigates risks through defense-in-depth:

| Threat Category | Potential Attack Vector | TestSheriff Defense Mechanism |
|---|---|---|
| **Path Traversal / Escape** | Specifying `../../etc/passwd` or outside files in test arguments | `validateSafePath` canonicalizes paths, verifies absolute workspace prefix containment, and verifies symlink targets stay within workspace. |
| **Command Injection** | Model output injecting `; rm -rf /` or `& del C:\` | Non-shell execution (`shell: false`). Arguments are strictly parsed into string arrays. |
| **Silent Package Poisoning** | Executing `pip install malicious-pkg` during tests | Prohibits arguments matching `pip`, `install`, `uninstall`, `npm`, `pnpm add`. |
| **Privilege Escalation** | Running `sudo`, `runas`, or administrator scripts | Rejects commands containing `sudo`, `runas`, `su`. Executed processes retain low-privilege token. |
| **Secret / Key Leakage** | Repository tests dumping API keys in assertion tracebacks | Automated regex scrubbing filters OpenAI, Anthropic, Google, GitHub, and AWS keys, Bearer tokens, private keys, and URL credentials. |
| **Infinite Hang / Resource Exhaustion** | Tests with infinite loops (`while True`) | Hard timeout enforcement with process tree termination (`taskkill /F /T /PID` or `SIGKILL`). Bounded 512 KB stream buffers. |
| **Autonomous Code Corruption** | AI modifying source files during test runs | Cryptographic non-mutation policy: TestSheriff never performs write operations on workspace files. |

---

## 2. Redaction Engine Patterns

TestSheriff scrubs the following credential patterns before logs or reports are written:
- **Anthropic API Keys**: `sk-ant-[a-zA-Z0-9_-]{16,}` $\to$ `[REDACTED_ANTHROPIC_KEY]`
- **OpenAI API Keys**: `sk-[a-zA-Z0-9_-]{20,}` $\to$ `[REDACTED_API_KEY]`
- **Google API Keys**: `AIza[0-9A-Za-z-_]{35}` $\to$ `[REDACTED_GOOGLE_API_KEY]`
- **GitHub Tokens**: `gh[pousr][-_][a-zA-Z0-9_]{20,}` $\to$ `[REDACTED_GITHUB_TOKEN]`
- **AWS Access Keys**: `AKIA...`, `ASIA...` $\to$ `[REDACTED_AWS_KEY]`
- **Bearer Tokens**: `Bearer <token>` $\to$ `Bearer [REDACTED_TOKEN]`
- **Private Keys**: `-----BEGIN PRIVATE KEY-----...` $\to$ `[REDACTED_PRIVATE_KEY]`
- **Database Connection Strings**: `postgres://user:pass@host` $\to `postgres://[USER]:[REDACTED_CREDENTIALS]@host`
