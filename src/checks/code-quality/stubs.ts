/**
 * checks/code-quality/stubs.ts
 *
 * Detects possible stub/unimplemented functions:
 *  - throw new Error("Not implemented") / throw new Error("TODO")
 *  - Functions whose entire body is a single bare return true/false/null/undefined
 *  - Functions named processX/handleX/getX that return a literal
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from '../../types.js';
import { walkSourceFiles } from '../utils.js';

// ─── Patterns ─────────────────────────────────────────────────────────────────

/** throw new Error("Not implemented") / "TODO" / "todo" */
const NOT_IMPLEMENTED_RE =
  /throw\s+new\s+Error\s*\(\s*['"`](not\s+implemented|todo|stub|fixme|placeholder)['"`]\s*\)/i;

/** Single-line function bodies: `return true;` / `return null;` etc. */
const BARE_RETURN_RE = /\breturn\s+(true|false|null|undefined)\s*;/;

/** Function / method declaration context hint */
const FUNCTION_DECL_RE =
  /(?:async\s+)?(?:function\s+\w+|\w+\s*(?:=|:)\s*(?:async\s+)?\(|(?:get|set|post|put|delete|patch|handle|process|create|update|save|fetch|load|send)\w*\s*\()/i;

const MAX_FINDINGS = 20;

// ─── Public API ───────────────────────────────────────────────────────────────

export function scanStubs(targetDir: string): Finding[] {
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
    const rel = path.relative(targetDir, filePath);

    for (let i = 0; i < lines.length; i++) {
      if (findings.length >= MAX_FINDINGS) break;
      const line = lines[i]!;

      // Pattern 1: explicit "not implemented" throw
      if (NOT_IMPLEMENTED_RE.test(line)) {
        findings.push({
          severity: 'error',
          category: 'code-quality',
          rule: 'stub',
          priority: 22,
          message: 'Unimplemented stub — throws "Not implemented"',
          file: rel,
          line: i + 1,
          confidence: 'high',
          suggestion: 'Implement the function body before shipping',
        });
        continue;
      }

      // Pattern 2: bare literal return inside a named function (low confidence)
      // Only flag if we also see a function declaration in the nearby context (±5 lines)
      if (BARE_RETURN_RE.test(line)) {
        const contextStart = Math.max(0, i - 5);
        const contextEnd = Math.min(lines.length - 1, i + 2);
        const context = lines.slice(contextStart, contextEnd).join('\n');

        if (FUNCTION_DECL_RE.test(context)) {
          const returnVal = BARE_RETURN_RE.exec(line)?.[1] ?? '';
          findings.push({
            severity: 'warn',
            category: 'code-quality',
            rule: 'stub',
            priority: 22,
            message: `Possible stub — function always returns \`${returnVal}\` without performing work`,
            file: rel,
            line: i + 1,
            confidence: 'medium',
            suggestion: 'Verify this is not a placeholder return value',
          });
        }
      }
    }
  }

  return findings;
}
