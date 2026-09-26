/**
 * checks/utils.ts
 *
 * Shared utilities for check modules:
 *  - walkSourceFiles(): recursive file walker that skips build artifacts,
 *    node_modules, .git, generated dirs, and binary files.
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── Directories to always skip ───────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'coverage',
  '.nyc_output',
  '__pycache__',
  '.turbo',
  '.cache',
  'tmp',
  'temp',
  '.vite',
  // Test directories — intentionally contain stub/mock code
  'test',
  'tests',
  '__tests__',
  'spec',
  'specs',
  'e2e',
  'fixtures',
  '__fixtures__',
  '__mocks__',
]);

// ─── File extensions to scan ──────────────────────────────────────────────────

const SOURCE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
]);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Yields absolute paths to all scannable source files under `dir`.
 * Skips binary files, build artifacts, and dependency directories.
 */
export function* walkSourceFiles(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      yield* walkSourceFiles(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXTS.has(ext)) continue;
      yield fullPath;
    }
  }
}

/**
 * Returns `true` if the file is likely auto-generated
 * (common header comment markers, or located in a generated path).
 */
export function isGeneratedFile(filePath: string, content: string): boolean {
  // Common generated file headers
  if (
    content.startsWith('// Code generated') ||
    content.startsWith('/* eslint-disable */') ||
    content.includes('DO NOT EDIT') ||
    content.includes('AUTO-GENERATED')
  ) {
    return true;
  }

  // Paths that commonly contain generated files
  const lower = filePath.toLowerCase();
  return (
    lower.includes('/generated/') ||
    lower.includes('/__generated__/') ||
    lower.includes('.generated.') ||
    lower.endsWith('.d.ts')
  );
}
