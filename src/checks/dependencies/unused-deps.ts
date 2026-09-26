/**
 * checks/dependencies/unused-deps.ts
 *
 * Detects potentially unused npm dependencies by:
 *  1. Reading package.json dependencies
 *  2. Scanning source files for import/require statements
 *  3. Reporting packages that appear in package.json but not in source
 *
 * Known limitations:
 *  - Dynamic requires: require(`${name}`) won't be detected
 *  - Config-only deps (e.g. tailwind, eslint plugins) may be false positives
 *  - Peer deps are skipped
 *
 * We use confidence "medium" and note these are "potentially unused" to avoid
 * false-positive frustration.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from '../../types.js';
import { walkSourceFiles } from '../utils.js';

// ─── Packages that are commonly "config-only" and shouldn't be flagged ────────

const CONFIG_ONLY_PACKAGES = new Set([
  // Build tools
  'typescript', 'tsup', 'esbuild', 'rollup', 'webpack', 'parcel', 'vite',
  'babel', '@babel/core', 'swc', '@swc/core',
  // Linters
  'eslint', 'prettier', 'tslint', 'biome',
  // Type definitions
  '@types/node', '@types/react', '@types/jest',
  // Test runners
  'vitest', 'jest', 'mocha', 'chai', 'jasmine',
  // CSS tools (referenced in config, not in JS imports)
  'tailwindcss', 'postcss', 'autoprefixer', 'sass', 'less',
  // Runtimes / platforms
  'tsx', 'ts-node', 'nodemon', 'concurrently',
  // Bundler plugins (referenced in config)
  '@vitejs/plugin-react', '@vitejs/plugin-vue',
]);

// ─── Extract imported package names from source ───────────────────────────────

const IMPORT_RE =
  /(?:import\s+.*\s+from\s+|import\s*\(|require\s*\()\s*['"`]([^'"`./][^'"`]*?)['"`]/g;

function extractImportedPackages(content: string): Set<string> {
  const packages = new Set<string>();
  let match: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(content)) !== null) {
    const raw = match[1]!;
    // Normalize scoped packages: @org/pkg/sub → @org/pkg
    const name = raw.startsWith('@')
      ? raw.split('/').slice(0, 2).join('/')
      : raw.split('/')[0]!;
    packages.add(name);
  }
  return packages;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function scanUnusedDeps(targetDir: string): Finding[] {
  // 1. Read package.json
  const pkgPath = path.join(targetDir, 'package.json');
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return []; // No package.json — skip
  }

  const deps = Object.keys(
    (pkg.dependencies as Record<string, string> | undefined) ?? {},
  );

  if (deps.length === 0) return [];

  // 2. Collect all imported packages from source
  const imported = new Set<string>();
  for (const filePath of walkSourceFiles(targetDir)) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    for (const p of extractImportedPackages(content)) {
      imported.add(p);
    }
  }

  // Also check config files that may import deps
  const configFiles = [
    'vite.config.ts', 'vite.config.js',
    'tailwind.config.ts', 'tailwind.config.js',
    'postcss.config.js', 'postcss.config.ts',
    'next.config.js', 'next.config.ts',
    'nuxt.config.ts',
  ];
  for (const cfg of configFiles) {
    const cfgPath = path.join(targetDir, cfg);
    if (!fs.existsSync(cfgPath)) continue;
    try {
      const content = fs.readFileSync(cfgPath, 'utf8');
      for (const p of extractImportedPackages(content)) imported.add(p);
    } catch {
      // ignore
    }
  }

  // 3. Find unused deps
  const unused = deps.filter(
    (dep) =>
      !imported.has(dep) &&
      !CONFIG_ONLY_PACKAGES.has(dep) &&
      // Skip scoped packages where the org is imported (e.g. @org/pkg when @org is used)
      !dep.startsWith('@types/'),
  );

  if (unused.length === 0) return [];

  // Report as a single grouped finding (less noise than one per package)
  return [
    {
      severity: 'warn',
      category: 'unused-deps',
      rule: 'unused-dependency',
      priority: 30,
      message: `${unused.length} potentially unused dependenc${unused.length === 1 ? 'y' : 'ies'} in package.json`,
      confidence: 'medium',
      suggestion: 'Verify and remove unused packages to reduce bundle size',
      // Embed the list in value for the reporter to display
      value: unused.slice(0, 15).map((d) => `  ${d}`).join('\n'),
    },
  ];
}
