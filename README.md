# RunCheck v0.1

> CLI doctor for Node.js projects — spot root-cause blockers before you hit them.

```
npx runcheck
```

RunCheck scans a Node.js project directory, compares what it **requires** against what's **installed** on your machine, and reports the root-cause blockers in priority order — no AI, no magic, just static analysis of config files.

---

## Install / Usage

```bash
# Scan the current directory
npx runcheck

# Scan a specific path
npx runcheck ./path/to/project

# Machine-readable JSON output
npx runcheck --json

# (Stub) auto-fix — coming in v0.2
npx runcheck --fix
```

## Example Output

```
RunCheck v0.1 — scanning /Users/you/my-app

┌────────┬──────────────┬──────────────────────────────────────────────────────┬────────────────────────────────────────────┐
│ Status │ Category     │ Details                                              │ Suggested Fix                              │
├────────┼──────────────┼──────────────────────────────────────────────────────┼────────────────────────────────────────────┤
│ ❌     │ Node         │ Node v20.14.0 detected — project requires >=22       │ nvm install 22 && nvm use 22               │
│ ❌     │ Env Vars     │ DATABASE_URL missing from .env                       │ # Add DATABASE_URL=<value> to your .env    │
│ ⚠      │ Ports        │ Port 3000 is already in use                         │ lsof -ti:3000 | xargs kill -9              │
│ ✓      │ Package Mgr  │ pnpm 9.2.0 available                                │                                            │
└────────┴──────────────┴──────────────────────────────────────────────────────┴────────────────────────────────────────────┘

Summary: 2 errors, 1 warning, 1 ok

Fix suggestions:
  1. nvm install 22 && nvm use 22
  2. lsof -ti:3000 | xargs kill -9
```

---

## Checks (v0.1)

| Check | Source | Priority |
|-------|--------|----------|
| **Node version** | `engines.node` in `package.json` or `.nvmrc` | 1 (highest) |
| **Package manager** | lockfile type (`pnpm-lock.yaml`, `package-lock.json`, etc.) | 2 |
| **Dependencies installed** | `node_modules` existence + lockfile vs mtime | 3 |
| **Env vars** | `.env.example` keys vs `.env` keys (values never read) | 4 |
| **Docker** | Dockerfile / `docker-compose.yml` present → checks `docker -v` + `docker info` | 5 |
| **Ports** | `--port` / `PORT=` in `package.json` scripts → checks if already bound | 6 (lowest) |

### Root-cause ranking rationale

Node version mismatch ranks first because it breaks everything downstream — wrong Node means wrong native addons, wrong API support, wrong behaviour. Package manager comes second because you can't install deps without it. Missing deps block the app from starting. Env vars and Docker/ports are usually optional or easily fixed.

---

## Development

```bash
# Prerequisites
node >= 20
pnpm >= 8

# Install
pnpm install

# Run tests
pnpm test

# Build (produces dist/index.js)
pnpm build

# Run locally without building
pnpm dev [path]
```

---

## Known Gaps

- **Windows path handling** — RunCheck targets macOS/Linux first. Basic scanning works on Windows but suggested fix commands (e.g. `lsof`, `nvm`) are Unix-specific. A Windows-aware fix layer is planned for v0.2.
- **No remote scanning** — v0.1 only scans local directories. GitHub repo scanning is planned for v0.2.
- **No auto-fix execution** — `--fix` is a stub. Auto-fix is planned for v0.2.
- **Non-Node ecosystems** — Python, Go, Rust etc. are out of scope.

---

## Roadmap

### v0.2
- `--fix` executes suggested commands (with confirmation prompt)
- Remote GitHub repo scanning (`npx runcheck github:user/repo`)
- Windows fix commands
- `engines.pnpm` / `engines.yarn` version range checking

---

## License

MIT
