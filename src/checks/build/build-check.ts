/**
 * checks/build/build-check.ts
 *
 * Runs the project's build command and captures the result.
 *
 * Detection logic:
 *  1. Read package.json scripts
 *  2. Detect package manager (pnpm/yarn/bun/npm)
 *  3. Run: <pm> run build
 *  4. Capture exit code, duration, first N lines of stderr/stdout on failure
 *
 * Never dumps full build output — just the summary + key error lines.
 */

import { execa } from 'execa';
import fs from 'node:fs';
import path from 'node:path';
import type { BuildResult } from '../../types.js';

// ─── PM detection ─────────────────────────────────────────────────────────────

type PM = 'pnpm' | 'yarn' | 'bun' | 'npm';

function detectPm(targetDir: string): PM {
  if (fs.existsSync(path.join(targetDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(targetDir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(targetDir, 'bun.lockb'))) return 'bun';
  return 'npm';
}

function hasBuildScript(targetDir: string): boolean {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    return typeof pkg.scripts?.build === 'string';
  } catch {
    return false;
  }
}

// ─── Error extraction ─────────────────────────────────────────────────────────

/**
 * Extract the most useful lines from build output.
 * Focus on lines that contain "error" / "Error" / "TS" codes.
 */
function extractErrors(output: string): string {
  const lines = output.split('\n');
  const errorLines = lines.filter(
    (l) =>
      /error\b/i.test(l) ||
      /TS\d{4}/.test(l) ||
      /failed/i.test(l) ||
      /cannot find/i.test(l) ||
      /undefined/i.test(l),
  );

  // Take up to 8 most relevant lines
  const sample = errorLines.slice(0, 8).join('\n').trim();
  return sample || lines.slice(0, 6).join('\n').trim();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runBuildCheck(targetDir: string): Promise<BuildResult> {
  if (!hasBuildScript(targetDir)) {
    // No build script — not a failure, just skip
    return {
      passed: true,
      durationMs: 0,
      errorSummary: undefined,
    };
  }

  const pm = detectPm(targetDir);
  const start = Date.now();

  try {
    await execa(pm, ['run', 'build'], {
      cwd: targetDir,
      reject: true,
      timeout: 120_000, // 2-minute timeout
      all: true,
    });

    return {
      passed: true,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const anyErr = err as { all?: string; stdout?: string; stderr?: string };
    const output =
      anyErr.all ?? anyErr.stderr ?? anyErr.stdout ?? String(err);
    const errorSummary = extractErrors(output);

    return {
      passed: false,
      durationMs,
      errorSummary: errorSummary || 'Build failed — run with --verbose for details',
    };
  }
}
