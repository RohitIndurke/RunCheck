/**
 * checks/code-quality/console-logs.ts
 *
 * Detects excessive console.log / console.error / console.warn usage in
 * production source code. Reports a single grouped finding with a per-file
 * breakdown rather than one finding per statement (avoids noise).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from '../../types.js';
import { walkSourceFiles } from '../utils.js';

const CONSOLE_RE = /\bconsole\.(log|warn|error|info|debug)\s*\(/g;

/** Only flag when there are at least this many console calls total. */
const MIN_THRESHOLD = 5;

/** Only include files in the breakdown with at least this many calls. */
const FILE_MIN = 2;

// ─── Public API ───────────────────────────────────────────────────────────────

export function scanConsoleLogs(targetDir: string): Finding[] {
  const fileCounts = new Map<string, number>();
  let total = 0;

  for (const filePath of walkSourceFiles(targetDir)) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const matches = content.match(CONSOLE_RE);
    if (!matches || matches.length === 0) continue;

    const rel = path.relative(targetDir, filePath);
    fileCounts.set(rel, matches.length);
    total += matches.length;
  }

  if (total < MIN_THRESHOLD) return [];

  // Build a compact breakdown (top files, sorted desc)
  const topFiles = [...fileCounts.entries()]
    .filter(([, n]) => n >= FILE_MIN)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const breakdown = topFiles
    .map(([f, n]) => `  ${f.padEnd(40)} ${n}`)
    .join('\n');

  return [
    {
      severity: 'warn',
      category: 'code-quality',
      rule: 'console-log',
      priority: 26,
      message: `${total} console statements found across ${fileCounts.size} file${fileCounts.size > 1 ? 's' : ''}`,
      suggestion:
        'Replace with a proper logger (e.g. pino, winston) or remove before shipping',
      // Embed breakdown as the "value" field for the reporter to display
      value: breakdown || undefined,
    },
  ];
}
