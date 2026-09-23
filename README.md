# RunCheck

> **CLI doctor for Node.js projects** — spot root-cause blockers *before* you hit them.

[![npm version](https://img.shields.io/npm/v/runcheck?color=0ea5e9&label=runcheck)](https://www.npmjs.com/package/runcheck)
[![CI](https://github.com/RohitIndurke/RunCheck/actions/workflows/ci.yml/badge.svg)](https://github.com/RohitIndurke/RunCheck/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blueviolet)](CONTRIBUTING.md)

RunCheck statically analyses a Node.js project — local or remote — and surfaces the **root-cause blockers** in priority order. No AI, no magic, just fast static analysis of your config files compared against your local environment.

```
npx runcheck
```

```
RunCheck  v0.1.1  ·  https://github.com/you/your-app
────────────────────────────────────────────────────────────

Errors
  ❌  Node        Node v18.20.0 detected — project requires >=20
           → fix: nvm install 20 && nvm use 20

Setup
  ℹ   Deps        node_modules not installed
           → fix: pnpm install

Warnings
  ⚠   Lockfiles   Multiple lockfiles found: pnpm-lock.yaml, package-lock.json
                  — remove all but one to avoid install inconsistencies

Passed
  ✓   Package Mgr  pnpm 10.16.0 available

1 error · 1 setup action · 1 warning · 1 passed
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

Every Node.js developer has wasted time on *"it works on my machine"* bugs:

- Wrong Node version silently installed
- Someone added a package but forgot to commit the lockfile
- `.env` keys exist in `.env.example` but not in `.env`
- Docker daemon not running before `docker-compose up`
- Port 3000 already bound by another process

RunCheck runs **once**, surfaces **all** of these at once, ordered by root cause — so you fix the real problem first, not a symptom.

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

Or install globally for repeated use:

```bash
# npm
npm install -g runcheck

# pnpm
pnpm add -g runcheck

# bun
bun add -g runcheck
```

---

## Usage

```
runcheck [path] [options]

Arguments:
  path               Local directory or GitHub URL to scan  [default: "."]

Options:
  --json             Machine-readable JSON output (also auto-enabled when
                     stdout is not a TTY, e.g. CI pipelines)
  --verbose          Annotate findings with where each requirement was sourced
                     (e.g. "engines.node", ".nvmrc")
  --fix              Print suggested fix commands  (auto-execution coming in v0.2)
  -V, --version      Print RunCheck version + Node/OS runtime info
  -h, --help         Show this help message
```

### Examples

```bash
# Scan current project with verbose source annotations
npx runcheck --verbose

# Scan a specific path
npx runcheck ~/projects/my-app

# Scan a GitHub repo (shallow clone, no auth required for public repos)
npx runcheck https://github.com/facebook/react

# CI-friendly JSON output piped to a file
npx runcheck --json > runcheck-report.json

# Exit code 1 if any errors are found (useful in pre-commit hooks / CI gates)
npx runcheck || exit 1
```

---

## Checks

RunCheck runs the following checks in root-cause priority order:

| Priority | Check | Source | Description |
|----------|-------|--------|-------------|
| **1** | **Node version** | `engines.node` → `.nvmrc` → `.node-version` | Mismatch breaks native addons, API support, and runtime behaviour. |
| **1.5** | **Ambiguous package manager** | Multiple lockfiles detected | Multiple lockfiles cause non-deterministic installs. |
| **2** | **Package manager** | Lockfile type · `packageManager` field | Wrong or missing PM means you can't install deps. |
| **3** | **Dependencies** | `node_modules` existence + lockfile vs mtime | Detects missing or stale installs. |
| **4** | **Env vars** | `.env.example` keys vs `.env` keys | Values are never read — only key presence is checked. |
| **5** | **Docker** | `Dockerfile` / `docker-compose.yml` present | Verifies `docker` CLI and running daemon. |
| **6** | **Ports** | `--port` / `PORT=` in `package.json` scripts | Checks if the port is already bound on your machine. |

### Severity levels

| Icon | Level | Meaning |
|------|-------|---------|
| ❌ | **error** | Blocker — fix this first |
| ⚠ | **warn** | Non-blocking issue; worth addressing |
| ℹ | **info / setup** | Expected setup step (e.g. fresh clone with no `node_modules`) |
| ✓ | **ok** | Check passed |

### Root-cause ranking rationale

Node version sits at priority 1 because a wrong Node breaks native addons, API availability, and runtime semantics — every other check below it depends on correct Node. Package manager comes second because you can't install deps without it. Missing deps block the app from starting. Env vars and Docker/ports are usually optional or easily fixed and don't cascade.

---

## Output Formats

### Human-readable (default)

Styled like Bun/Vite/pnpm output — no outer borders, grouped by severity, with `→ fix:` hints inline:

```
RunCheck  v0.1.1  ·  ./my-app
────────────────────────────────────────────────────────────

Errors
  ❌  Node        Node v18.20.0 detected — project requires >=20
           → fix: nvm install 20 && nvm use 20

Passed
  ✓   Package Mgr  pnpm 10.16.0 available
  ✓   Node         No Node version requirement declared (engines.node / .nvmrc)

✓ All 2 checks passed.
```

### JSON (`--json`)

Automatically enabled when stdout is not a TTY (CI, pipes). Structure:

```json
{
  "targetDir": "./my-app",
  "scannedAt": "2026-09-23T10:41:00.000Z",
  "findings": [
    {
      "severity": "error",
      "category": "node",
      "priority": 1,
      "message": "Node v18.20.0 detected — project requires >=20",
      "fix": "nvm install 20 && nvm use 20"
    }
  ]
}
```

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | All checks passed (no errors) |
| `1` | One or more **error**-severity findings |
| `2` | RunCheck itself encountered an unexpected error |

---

## Architecture

```
src/
├── cli.ts                  # Entry point — argument parsing, local/remote dispatch
├── types.ts                # Shared TypeScript types (Finding, ScanResult, …)
├── scanners/
│   ├── requirements.ts     # Reads the project: engines.node, lockfiles, .env.example, ports, …
│   ├── environment.ts      # Probes the local machine: node -v, pm -v, docker info, …
│   └── diff.ts             # Pure function: requirements × environment → ordered findings
├── remote/
│   └── git.ts              # isRemoteUrl(), cloneRepository() — shallow clone + cleanup
├── report/
│   └── format.ts           # renderTable() (human) + renderJson() (machine)
└── fixers/
    └── fix.ts              # --fix stub (auto-execution planned for v0.2)

test/
├── scanners.test.ts        # Unit tests for all diff.ts checks + requirements parsing
├── remote.test.ts          # Unit tests for URL detection + clone logic
├── format.test.ts          # Unit tests for the JSON and table renderers
└── fixtures/               # Minimal project directories used in tests
```

**Key design decisions:**

- **`diff.ts` is a pure function** — no I/O, fully unit-testable without mocking.
- **Remote scans use `--depth 1`** — only the latest commit is cloned; temp directory is always cleaned up.
- **Values are never read from `.env`** — only key presence is compared, preventing accidental secret leakage.
- **Non-TTY auto-switches to JSON** — safe to pipe `npx runcheck` in CI without `--json`.

---

## Development

### Prerequisites

- Node ≥ 20
- pnpm ≥ 8
- Git (required for remote URL scanning)

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

# Run locally against a specific path
pnpm dev ./path/to/project

# Run locally against a GitHub URL
pnpm dev https://github.com/user/repo

# Build production bundle → dist/cli.js
pnpm build
```

### Project scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `tsx src/cli.ts` | Run from source, no build step |
| `build` | `tsup` | Bundle to `dist/cli.js` |
| `test` | `vitest run` | Single test run |
| `test:watch` | `vitest` | Watch mode |

### Adding a new check

1. Add the new category name to `Category` in [`src/types.ts`](src/types.ts).
2. Add a `check<Name>()` function in [`src/scanners/diff.ts`](src/scanners/diff.ts) — returns `Finding[]`, no I/O allowed.
3. Call it from `diffRequirementsVsEnvironment()` and assign it a priority.
4. If the check needs new data from the machine, extend `LocalEnvironment` in `types.ts` and probe for it in [`src/scanners/environment.ts`](src/scanners/environment.ts).
5. If the check reads project config, extend `ProjectRequirements` and parse it in [`src/scanners/requirements.ts`](src/scanners/requirements.ts).
6. Add unit tests in [`test/scanners.test.ts`](test/scanners.test.ts).

---

## Contributing

Contributions are welcome! Please follow these steps:

1. **Fork** the repository and create a branch: `git checkout -b feat/my-feature`
2. **Make your changes.** Follow the architecture above — keep `diff.ts` pure (no I/O).
3. **Add tests.** Every new check needs unit tests in `test/scanners.test.ts`.
4. **Run the full test suite:** `pnpm test`
5. **Open a pull request** against `main` with a clear description of the problem and solution.

### Code style

- TypeScript strict mode — no `any`, no `@ts-ignore` without a comment.
- Keep `diff.ts` pure — all I/O lives in `environment.ts`, `requirements.ts`, or `remote/git.ts`.
- Prefer readable code over clever code; this project values maintainability.

### Reporting a bug

Please [open an issue](https://github.com/RohitIndurke/RunCheck/issues) and include:

- RunCheck version (`npx runcheck --version`)
- Node version and OS
- The command you ran
- The full output (or `--json` output)

---

## Roadmap

### v0.2

- [ ] `--fix` — execute suggested fix commands with a confirmation prompt
- [ ] Windows-aware fix commands (PowerShell equivalents for `lsof`, `nvm`, etc.)
- [ ] `engines.pnpm` / `engines.yarn` / `engines.npm` version range checking

### v0.3

- [ ] Monorepo-aware scanning — walk workspace packages and aggregate findings
- [ ] Plugin API — let projects ship their own RunCheck checks in `package.json`

### Backlog / Ideas

- Python, Go, Rust ecosystem support
- `--watch` mode — re-scan on file changes
- VS Code extension

---

## Known Limitations

- **Windows fix commands** — RunCheck targets macOS/Linux first. Scanning works on Windows but suggested fix commands (e.g. `lsof`, `nvm`) are Unix-specific. Windows-aware fixes are planned for v0.2.
- **Private repos** — Remote scanning via `git clone` requires that Git is configured with credentials for private repositories.
- **Non-Node projects** — Python, Go, Rust, etc. are out of scope for now.
- **Monorepo root only** — When a monorepo is detected, RunCheck scans the root only and skips per-package `.env` checks to avoid false positives.

---

## License

[MIT](LICENSE) © [Rohit Indurke](https://github.com/RohitIndurke)
