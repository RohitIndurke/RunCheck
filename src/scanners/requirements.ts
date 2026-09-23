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

function resolveNodeRange(dir: string, pkg: Record<string, unknown> | null): string | null {
  // 1. engines.node in package.json
  if (pkg && typeof pkg.engines === 'object' && pkg.engines !== null) {
    const engines = pkg.engines as Record<string, unknown>;
    if (typeof engines.node === 'string' && engines.node.trim()) {
      return engines.node.trim();
    }
  }

  // 2. .nvmrc
  const nvmrc = readFile(path.join(dir, '.nvmrc'));
  if (nvmrc) {
    const v = nvmrc.trim();
    // .nvmrc may contain bare "20" or "20.14.0" — normalise to ">=X" form
    if (/^\d/.test(v)) return `>=${v}`;
    return v;
  }

  // 3. .node-version
  const nodeVersion = readFile(path.join(dir, '.node-version'));
  if (nodeVersion) {
    const v = nodeVersion.trim();
    if (/^\d/.test(v)) return `>=${v}`;
    return v;
  }

  return null;
}

// ─── Package manager ──────────────────────────────────────────────────────────

type PM = ProjectRequirements['packageManager'];

function detectPackageManager(
  dir: string,
  pkg: Record<string, unknown> | null,
): { pm: PM; lockfilePath: string | null } {
  // Check lockfiles in preference order
  const candidates: Array<[string, PM]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
  ];

  for (const [filename, pm] of candidates) {
    const full = path.join(dir, filename);
    if (fileExists(full)) return { pm, lockfilePath: full };
  }

  // Fallback: packageManager field in package.json (corepack convention)
  if (pkg && typeof pkg.packageManager === 'string') {
    const raw = pkg.packageManager as string;
    for (const pm of ['pnpm', 'yarn', 'bun', 'npm'] as const) {
      if (raw.startsWith(pm)) return { pm, lockfilePath: null };
    }
  }

  return { pm: null, lockfilePath: null };
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

  const nodeRange = resolveNodeRange(targetDir, pkg);
  const { pm: packageManager, lockfilePath } = detectPackageManager(targetDir, pkg);

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
    packageManager,
    lockfilePath,
    envExampleKeys,
    dockerRequired,
    requiredPorts,
    packageJsonPath: pkgRaw ? pkgPath : null,
  };
}
