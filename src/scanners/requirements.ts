/**
 * requirements.ts
 *
 * Reads the *project under scan* (not runcheck itself) and extracts what
 * it declares it needs: Node version, package manager, env keys, ports, Docker.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ProjectRequirements } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

// ─── Node version ─────────────────────────────────────────────────────────────

/**
 * Normalise a raw version string from .nvmrc / .node-version into a semver range.
 *
 * Rules:
 *  - Strip a leading "v"  (v20.11.0 → 20.11.0)
 *  - "lts" / "lts/*"     → ">=20"  (current LTS major; bump manually when a new
 *                           LTS line becomes active — typically every October)
 *  - Bare major "20"      → ">=20.0.0"
 *  - Full or partial semver like "20.11.0" or "20.11" → ">=20.11.0" / ">=20.11"
 */
function normaliseVersionString(raw: string): string {
  const v = raw.replace(/^v/, '').trim();

  if (v === 'lts' || v === 'lts/*' || v.startsWith('lts/')) {
    return '>=20'; // ponytail: bump when next LTS major stabilises
  }

  // Bare major: all digits, no dots → append .0.0 so semver parses it as a range
  if (/^\d+$/.test(v)) {
    return `>=${v}.0.0`;
  }

  return `>=${v}`;
}

function resolveNodeRange(
  dir: string,
  pkg: Record<string, unknown> | null,
): { range: string | null; source: string | null } {
  // 1. engines.node in package.json (highest precedence)
  if (pkg && typeof pkg.engines === 'object' && pkg.engines !== null) {
    const engines = pkg.engines as Record<string, unknown>;
    if (typeof engines.node === 'string' && engines.node.trim()) {
      return { range: engines.node.trim(), source: 'engines.node' };
    }
  }

  // 2. .nvmrc
  const nvmrc = readFile(path.join(dir, '.nvmrc'));
  if (nvmrc) {
    const raw = nvmrc.trim();
    if (raw) return { range: normaliseVersionString(raw), source: '.nvmrc' };
  }

  // 3. .node-version
  const nodeVersion = readFile(path.join(dir, '.node-version'));
  if (nodeVersion) {
    const raw = nodeVersion.trim();
    if (raw) return { range: normaliseVersionString(raw), source: '.node-version' };
  }

  return { range: null, source: null };
}

// ─── Package manager ──────────────────────────────────────────────────────────

type PM = ProjectRequirements['packageManager'];

const LOCKFILE_CANDIDATES: Array<[string, PM]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

function detectPackageManager(
  dir: string,
  pkg: Record<string, unknown> | null,
): { pm: PM; lockfilePath: string | null; ambiguousLockfiles: string[] } {
  const found: Array<{ path: string; pm: PM }> = [];

  for (const [filename, pm] of LOCKFILE_CANDIDATES) {
    const full = path.join(dir, filename);
    if (fileExists(full)) found.push({ path: full, pm });
  }

  if (found.length > 0) {
    return {
      pm: found[0]!.pm,
      lockfilePath: found[0]!.path,
      ambiguousLockfiles: found.map((f) => f.path),
    };
  }

  // Fallback: packageManager field in package.json (corepack convention)
  if (pkg && typeof pkg.packageManager === 'string') {
    const raw = pkg.packageManager as string;
    for (const pm of ['pnpm', 'yarn', 'bun', 'npm'] as const) {
      if (raw.startsWith(pm)) return { pm, lockfilePath: null, ambiguousLockfiles: [] };
    }
  }

  return { pm: null, lockfilePath: null, ambiguousLockfiles: [] };
}

// ─── PM engine range ──────────────────────────────────────────────────────────

function resolvePmEngineRange(
  pm: PM,
  pkg: Record<string, unknown> | null,
): string | null {
  if (!pm || !pkg || typeof pkg.engines !== 'object' || pkg.engines === null) {
    return null;
  }
  const engines = pkg.engines as Record<string, unknown>;
  const range = engines[pm];
  return typeof range === 'string' && range.trim() ? range.trim() : null;
}

// ─── Monorepo detection ───────────────────────────────────────────────────────

function detectMonorepo(dir: string, pkg: Record<string, unknown> | null): boolean {
  // workspaces field in package.json (npm/yarn/pnpm workspaces)
  if (pkg && pkg.workspaces) return true;

  // Presence of well-known monorepo config files
  const markers = ['pnpm-workspace.yaml', 'turbo.json', 'nx.json'];
  return markers.some((f) => fileExists(path.join(dir, f)));
}

// ─── .env.example keys ────────────────────────────────────────────────────────

export function parseEnvKeys(content: string): string[] {
  const keys: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip blank lines and pure comment lines
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      keys.push(trimmed.slice(0, eqIdx).trim());
    }
  }
  return keys;
}

// ─── Port detection ───────────────────────────────────────────────────────────

/** Regex patterns that appear in package.json scripts to specify a dev port. */
const PORT_PATTERNS = [
  /--port[= ](\d+)/g,
  /PORT=(\d+)/g,
  /-p\s+(\d+)/g,
];

function extractPortsFromScripts(scripts: Record<string, string>): number[] {
  const ports = new Set<number>();
  for (const script of Object.values(scripts)) {
    for (const pattern of PORT_PATTERNS) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(script)) !== null) {
        const port = parseInt(m[1]!, 10);
        if (!isNaN(port)) ports.add(port);
      }
    }
  }
  return [...ports];
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function scanRequirements(targetDir: string): ProjectRequirements {
  const pkgPath = path.join(targetDir, 'package.json');
  let pkg: Record<string, unknown> | null = null;

  const pkgRaw = readFile(pkgPath);
  if (pkgRaw) {
    try {
      pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    } catch {
      // malformed package.json — treat as absent
    }
  }

  const { range: nodeRange, source: nodeRangeSource } = resolveNodeRange(targetDir, pkg);
  const { pm: packageManager, lockfilePath, ambiguousLockfiles } = detectPackageManager(targetDir, pkg);
  const pmEngineRange = resolvePmEngineRange(packageManager, pkg);
  const isMonorepo = detectMonorepo(targetDir, pkg);

  // .env.example keys
  const envExampleRaw = readFile(path.join(targetDir, '.env.example'));
  const envExampleKeys = envExampleRaw ? parseEnvKeys(envExampleRaw) : [];

  // Docker presence
  const dockerRequired = [
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
  ].some((f) => fileExists(path.join(targetDir, f)));

  // Ports from scripts
  let requiredPorts: number[] = [];
  if (pkg && typeof pkg.scripts === 'object' && pkg.scripts !== null) {
    requiredPorts = extractPortsFromScripts(
      pkg.scripts as Record<string, string>,
    );
  }

  return {
    nodeRange,
    nodeRangeSource,
    packageManager,
    lockfilePath,
    ambiguousLockfiles,
    envExampleKeys,
    dockerRequired,
    requiredPorts,
    packageJsonPath: pkgRaw ? pkgPath : null,
    isMonorepo,
    pmEngineRange,
  };
}
