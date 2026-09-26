/**
 * checks/code-quality/todo.ts
 *
 * Detects TODO / FIXME / HACK / XXX comments left in source files.
 * Returns one finding per occurrence (capped) with file + line context.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from '../../types.js';
import { walkSourceFiles } from '../utils.js';

// ─── Pattern ──────────────────────────────────────────────────────────────────

// Match: // TODO: ..., /* FIXME: ..., # HACK: ..., <!-- XXX:
const TODO_RE = /(?:\/\/|\/\*|#|<!--)\s*(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)/i;

// Cap findings to avoid noise in very large codebases
const MAX_FINDINGS = 30;

// ─── Public API ───────────────────────────────────────────────────────────────

export function scanTodos(targetDir: string): Finding[] {
  const findings: Finding[] = [];

  for (const filePath of walkSourceFiles(targetDir)) {
    if (findings.length >= MAX_FINDINGS) break;

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (findings.length >= MAX_FINDINGS) break;
      const line = lines[i]!;
      const match = TODO_RE.exec(line);
      if (!match) continue;

      const keyword = match[1]!.toUpperCase();
      const comment = match[2]?.trim() ?? '';
      const rel = path.relative(targetDir, filePath);

      findings.push({
        severity: 'warn',
        category: 'code-quality',
        rule: keyword,
        priority: 20,
        message: comment
          ? `${keyword}: ${comment}`
          : `${keyword} comment with no description`,
        file: rel,
        line: i + 1,
        suggestion: 'Resolve or remove before shipping',
      });
    }
  }

  return findings;
}
