<p align="center">
  <img src="assets/logo.png" alt="RunCheck Header Banner" width="100%" />
</p>

<h1 align="center">RunCheck</h1>

<p align="center">
  <strong>Pre-ship sanity check for your codebase.</strong><br>
  <em>You vibe-coded it. RunCheck makes sure you can actually ship it.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/runcheck"><img src="https://img.shields.io/npm/v/runcheck?color=0ea5e9&label=runcheck" alt="npm version"></a>
  <a href="https://github.com/RohitIndurke/RunCheck/actions/workflows/ci.yml"><img src="https://github.com/RohitIndurke/RunCheck/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node >=20"></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-blueviolet" alt="PRs Welcome"></a>
</p>

---

<p align="center">
  <video src="assets/demo.mp4" autoplay loop muted playsinline width="100%"></video>
</p>

---

RunCheck runs **five focused checks** against your project and produces a single Ship Report that answers one question:

> **Can I confidently move on to shipping, or should I inspect something first?**

```
npx runcheck
```

```
◈ RunCheck
Pre-ship sanity check

Scanning /path/to/my-app

  ✓ Environment checked
  ✗ Secrets detected
  ✓ Code quality analyzed
  ✓ Dependencies checked
  ✓ Build verified

────────────────────────────────────────────────────────

RESULT

  ✗ NOT READY TO SHIP

  1 critical · 4 warnings

────────────────────────────────────────────────────────

BUILD

  ✓ Build passed  18.4s

SECURITY

  ✗ Possible OpenAI API key detected
     src/config.ts:18
     Value: sk-p••••••••••••••••
     → Move to an environment variable and rotate the key

CODE QUALITY

  ⚠ 4 TODO/FIXME comments
  ⚠ 2 swallowed errors
     src/services/payment.ts:81
     src/api/users.ts:12

DEPENDENCIES

  ⚠ 3 potentially unused dependencies in package.json
     lodash
     moment
     axios

ENVIRONMENT

  ✓ Node v24.21.0 satisfies required >=20
  ✓ pnpm 9.2.0 available
  ✓ node_modules present and up-to-date

────────────────────────────────────────────────────────

CRITICAL FINDINGS

   1.  Possible OpenAI API key detected
       src/config.ts:18
       Value: sk-p••••••••••••••••
       → Move to an environment variable and rotate the key
       Confidence: high

────────────────────────────────────────────────────────

Run runcheck --verbose for full details.
Run runcheck --json for machine-readable output.
```

---

## Contents

- [Why RunCheck?](#why-runcheck)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Checks](#checks)
- [Output Formats](#output-formats)
- [Architecture](#architecture)
- [Development](#development)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)

---

## Why RunCheck?

Every developer who builds quickly with AI assistance leaves the same garbage behind:

- Secrets hardcoded in config files instead of env vars
- `// TODO: implement this` left in production paths
- Empty `catch {}` blocks silently swallowing errors
- `throw new Error('Not implemented')` stubs forgotten in payment logic
- Packages installed then never used
- A build that fails before you even push

RunCheck finds all of it in one pass, tells you what's critical vs. worth noting, and gets out of your way.

---

## Quick Start

No install required:

```bash
# Scan the current directory
npx runcheck

# Scan any local project
npx runcheck ./path/to/project

# Scan a public GitHub repository (clones with --depth 1, then deletes the clone)
npx runcheck https://github.com/user/repo
```

Or install globally:

```bash
npm install -g runcheck
pnpm add -g runcheck
bun add -g runcheck
```

---

## Usage

```
runcheck [path] [options]

Arguments:
  path               Local directory or GitHub URL to scan  [default: "."]

Options:
  --verbose          Show additional detail in findings
  --json             Machine-readable JSON output (also auto-enabled in CI/pipes)
  --fix              Apply safe fixes (coming in v1.1)
  -V, --version      Print RunCheck version + Node/OS runtime info
  -h, --help         Show this help message
```

### Examples

```bash
# Scan current project
npx runcheck

# Scan with verbose output
npx runcheck --verbose

# CI-friendly JSON output
npx runcheck --json > runcheck-report.json

# Gate a CI step (exit code 1 if critical issues found)
npx runcheck || exit 1

# Scan a GitHub repo
npx runcheck https://github.com/facebook/react
```

---

## Checks

RunCheck runs five categories of checks:

### 🔒 Security

Detects secrets and API keys accidentally left in source code:

| Pattern | Examples |
|---------|---------|
| OpenAI API keys | `sk-proj-...` |
| AWS Access Key IDs | `AKIA...` |
| GitHub Personal Access Tokens | `ghp_...`, `gho_...` |
| Stripe keys | `sk_live_...`, `pk_live_...` |
| Slack tokens | `xoxb-...`, `xoxp-...` |
| Google API keys | `AIza...` |
| PEM private keys | `-----BEGIN PRIVATE KEY-----` |
| JWT tokens | `eyJ...` |
| Generic high-entropy tokens | Any `api_key=`, `secret=`, `token=` with long values |
| `.env` not in `.gitignore` | Prevents accidental credential commits |

Values are **always redacted** — RunCheck never prints full secrets.

### 🔍 Code Quality

Detects common vibe-code smells:

| Rule | What it catches | Severity |
|------|----------------|---------|
| `TODO/FIXME` | `// TODO: implement this`, `// FIXME: temporary` | Warning |
| `stub` | `throw new Error('Not implemented')`, functions that only return `null`/`true`/`false` | Error / Warning |
| `swallowed-error` | Empty `catch {}` blocks, catch blocks that only `console.log(err)` | Warning |
| `console-log` | Excessive `console.log/warn/error` statements (≥5 total) | Warning |
| `hardcoded-value` | Hardcoded `localhost:PORT` URLs, hardcoded IPs | Warning |

### 📦 Dependencies

- **Potentially unused packages** — compares `package.json` dependencies against actual imports

### 🔨 Build

- Runs `<pm> run build` and captures the result
- Reports pass/fail with duration
- Extracts key error lines without dumping the full log

### ⚙️ Environment

- **Node version** — checks `engines.node` / `.nvmrc` / `.node-version` against running Node
- **Package manager** — verifies the right PM is installed (pnpm/yarn/bun/npm)
- **Dependencies** — checks `node_modules` existence and lockfile freshness
- **Env vars** — compares `.env.example` keys against `.env`
- **Docker** — verifies CLI and daemon when Dockerfile/docker-compose detected
- **Ports** — checks if required ports are already bound

### Severity levels

| Symbol | Level | Meaning |
|--------|-------|---------|
| `✗` | **critical** | Blocker — must fix before shipping |
| `⚠` | **warning** | Should review |
| `✓` | **passed** | All clear |
| `ℹ` | **info** | Expected setup step |

---

## Output Formats

### Human-readable (default TTY)

Clean, minimal output styled after GitHub CLI / Vercel CLI. Shown when stdout is a TTY.

### JSON (`--json` or non-TTY)

Automatically enabled when stdout is not a TTY (CI, pipes). Structure:

```json
{
  "status": "failed",
  "summary": {
    "critical": 1,
    "warnings": 4,
    "suggestions": 0
  },
  "projectName": "my-app",
  "targetDir": "/path/to/my-app",
  "scannedAt": "2026-09-26T14:00:00.000Z",
  "durationMs": 8420,
  "build": {
    "passed": true,
    "durationMs": 18400
  },
  "findings": [
    {
      "severity": "error",
      "category": "security",
      "rule": "secret",
      "priority": 10,
      "message": "Possible OpenAI API key detected",
      "file": "src/config.ts",
      "line": 18,
      "confidence": "high",
      "value": "sk-p••••••••••••••••",
      "suggestion": "Move to an environment variable and rotate the key"
    }
  ]
}
```

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | All checks passed (no critical issues, build passed) |
| `1` | One or more critical findings or build failed |
| `2` | RunCheck itself encountered an unexpected error |

---

## Architecture

```
src/
├── cli.ts                      # Entry point — orchestrates all checks
├── types.ts                    # TypeScript types (Finding, ScanResult, BuildResult…)
│
├── checks/                     # V1 ship-readiness checks
│   ├── utils.ts                # walkSourceFiles(), isGeneratedFile()
│   ├── code-quality/
│   │   ├── todo.ts             # TODO/FIXME/HACK/XXX detector
│   │   ├── stubs.ts            # Not-implemented & bare-return stub detector
│   │   ├── swallowed-errors.ts # Empty catch / console-only catch detector
│   │   ├── console-logs.ts     # Excessive console.log detector
│   │   └── hardcoded-values.ts # Hardcoded localhost/IP detector
│   ├── security/
│   │   └── secrets.ts          # API key / token / credential detector
│   ├── dependencies/
│   │   └── unused-deps.ts      # Unused package.json dependency detector
│   └── build/
│       └── build-check.ts      # Runs build command, captures result
│
├── scanners/                   # Legacy environment health scanners (preserved)
│   ├── requirements.ts         # Reads engines.node, lockfiles, .env.example, ports…
│   ├── environment.ts          # Probes Node, PM, docker, ports
│   └── diff.ts                 # Pure function: requirements × environment → findings
│
├── report/
│   ├── ship-report.ts          # V1 Ship Report renderer (human + JSON)
│   └── format.ts               # Legacy renderer (backwards compat for tests)
│
├── remote/
│   └── git.ts                  # isRemoteUrl(), cloneRepository()
│
└── fixers/
    └── fix.ts                  # --fix stub

test/
├── checks.test.ts              # Tests for all V1 check modules
├── scanners.test.ts            # Tests for diff.ts + requirements parsing
├── remote.test.ts              # Tests for URL detection + clone logic
├── format.test.ts              # Tests for JSON renderer
└── fixtures/                   # Minimal project directories used in tests
```

**Key design decisions:**

- **`diff.ts` is a pure function** — no I/O, fully unit-testable without mocking.
- **Check modules are isolated** — each returns `Finding[]`, no shared state.
- **Test directories are excluded** — `test/`, `spec/`, `__tests__/`, `fixtures/` etc. are skipped to prevent test fixtures (which intentionally contain stubs/mocks) from generating false positives.
- **Secrets are always redacted** — RunCheck never prints more than the first 4 characters of any detected secret.
- **Confidence levels prevent noise** — medium-confidence findings (bare literal returns) are downgraded to warnings, not errors.
- **Non-TTY auto-switches to JSON** — safe to pipe `npx runcheck` in CI without `--json`.

---

## Development

### Prerequisites

- Node ≥ 20
- pnpm ≥ 8

### Setup

```bash
git clone https://github.com/RohitIndurke/RunCheck.git
cd RunCheck
pnpm install
```

### Common tasks

```bash
# Run tests (Vitest)
pnpm test

# Watch mode
pnpm test:watch

# Run locally without building (scans the current directory)
pnpm dev

# Build production bundle → dist/cli.js
pnpm build

# Scan this repository itself
node dist/cli.js
```

### Adding a new check

1. Create a new file in `src/checks/<category>/my-check.ts`
2. Export a function that returns `Finding[]`
3. Import and call it from `src/cli.ts` inside `runScan()`
4. Add tests in `test/checks.test.ts`

Each finding should have:
- `severity` — `'error'` | `'warn'` | `'info'` | `'ok'`
- `category` — use an existing category or add a new one to `types.ts`
- `rule` — short machine-readable identifier
- `priority` — lower = shown first
- `file` / `line` — where the issue was found
- `confidence` — `'low'` | `'medium'` | `'high'`
- `suggestion` — one-line human-readable fix hint

---

## Contributing

1. **Fork** the repository and create a branch: `git checkout -b feat/my-feature`
2. **Make your changes.** Keep `diff.ts` pure (no I/O).
3. **Add tests.** Every new check needs positive cases (should trigger) and negative cases (should NOT trigger).
4. **Run the full test suite:** `pnpm test`
5. **Open a pull request** against `main`.

---

## Roadmap

### v1.1

- [ ] `--fix` — safe automated fixes (remove unused imports, formatting)
- [ ] Windows-aware fix commands
- [ ] `.runcheck.json` config file (ignore patterns, severity overrides)

### v1.2

- [ ] Monorepo-aware scanning — walk workspace packages
- [ ] Placeholder/mock data detection in API routes
- [ ] Duplicate dependency version detection

### Backlog

- Python, Go, Rust ecosystem support
- `--watch` mode — re-scan on file changes
- VS Code extension

---

## Known Limitations

- **Windows fix commands** — Scanning works on Windows but suggested fix commands (e.g. `lsof`, `nvm`) are Unix-specific. Windows-aware fixes planned for v1.1.
- **Private repos** — Remote scanning requires Git configured with credentials for private repos.
- **Non-Node projects** — Python, Go, Rust etc. are out of scope for now.
- **Monorepo root only** — RunCheck scans the root only in monorepos; per-package scanning coming in v1.2.
- **Unused deps are heuristic** — Dynamic requires, config-only packages, and CLI-invoked binaries may appear "unused" even when they're not. Review before removing.

---

## License

[MIT](LICENSE) © [Rohit Indurke](https://github.com/RohitIndurke)
