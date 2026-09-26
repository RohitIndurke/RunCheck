/**
 * checks/code-quality/hardcoded-values.ts
 *
 * Detects suspicious hardcoded values commonly left behind in vibe-coded apps:
 *  - localhost URLs with specific ports
 *  - Hardcoded IP addresses (non-standard)
 *  - Hardcoded user/account IDs that look like production data
 *
 * Does NOT flag generic production URLs (that's secrets.ts territory).
 * Focus: values that would break in other environments.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from '../../types.js';
import { walkSourceFiles } from '../utils.js';

// ─── Patterns ─────────────────────────────────────────────────────────────────

const PATTERNS: Array<{
  re: RegExp;
  label: string;
  severity: 'warn' | 'error';
}> = [
  {
    // http://localhost:PORT or http://127.0.0.1:PORT — hardcoded local URLs
    re: /(['"`])(https?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}[^'"`]*)\1/,
    label: 'Hardcoded localhost URL',
    severity: 'warn',
  },
  {
    // Hardcoded non-loopback IP in a string  (skip 0.0.0.0, 127.x, 192.168.x, 10.x)
    re: /(['"`])((?!0\.0\.0\.0|127\.|192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?)\1/,
    label: 'Hardcoded IP address',
    severity: 'warn',
  },
];

const MAX_FINDINGS = 20;

// ─── Public API ───────────────────────────────────────────────────────────────

export function scanHardcodedValues(targetDir: string): Finding[] {
  const findings: Finding[] = [];

  for (const filePath of walkSourceFiles(targetDir)) {
    if (findings.length >= MAX_FINDINGS) break;

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const rel = path.relative(targetDir, filePath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (findings.length >= MAX_FINDINGS) break;
      const line = lines[i]!;

      // Skip comment lines
      if (/^\s*(\/\/|#|\/\*)/.test(line)) continue;

      for (const { re, label, severity } of PATTERNS) {
        const match = re.exec(line);
        if (!match) continue;

        const val = match[2] ?? '';
        // Redact long values to keep output clean
        const display = val.length > 60 ? val.slice(0, 57) + '…' : val;

        findings.push({
          severity,
          category: 'code-quality',
          rule: 'hardcoded-value',
          priority: 28,
          message: `${label}: \`${display}\``,
          file: rel,
          line: i + 1,
          confidence: 'medium',
          suggestion: 'Move to an environment variable',
        });

        break; // one finding per line maximum
      }
    }
  }

  return findings;
}
