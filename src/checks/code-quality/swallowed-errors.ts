/**
 * checks/code-quality/swallowed-errors.ts
 *
 * Detects swallowed / ignored errors:
 *  - Empty catch blocks:        catch (e) {}  or  catch {}
 *  - Console-only catch blocks: catch { console.log(e) }
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from '../../types.js';
import { walkSourceFiles } from '../utils.js';

const MAX_FINDINGS = 25;

// ─── Scanner ──────────────────────────────────────────────────────────────────

/**
 * Find the index of the matching closing brace in the full source string.
 * `start` should be the index of the opening `{`.
 */
function findClosingBrace(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface SwallowedCatch {
  line: number;
  kind: 'empty' | 'console-only';
}

/**
 * Works on the full file source as a string for simpler brace matching.
 */
function findSwallowedCatches(src: string): SwallowedCatch[] {
  const results: SwallowedCatch[] = [];

  // Strip block comments (/** ... */ and /* ... */) before scanning
  // to prevent matching `catch` inside doc-comment examples
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    // Preserve newlines so line numbers stay accurate
    m.replace(/[^\n]/g, ' '),
  );

  // Find all catch keyword positions
  const CATCH_RE = /\bcatch\s*(?:\([^)]*\))?\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = CATCH_RE.exec(stripped)) !== null) {
    // Position of the opening brace of the catch block
    const openBrace = stripped.indexOf('{', match.index + 5);
    if (openBrace === -1) continue;

    const closeBrace = findClosingBrace(stripped, openBrace);
    if (closeBrace === -1) continue;

    // Extract inner content (from original src to preserve exact code)
    const inner = src
      .slice(openBrace + 1, closeBrace)
      .replace(/\/\/[^\n]*/g, '')   // strip // comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // strip /* */ comments
      .trim();

    // Line number of the catch keyword (1-indexed)
    const beforeCatch = src.slice(0, match.index);
    const lineNum = (beforeCatch.match(/\n/g) ?? []).length + 1;

    if (inner === '') {
      results.push({ line: lineNum, kind: 'empty' });
    } else if (/^console\.(log|warn|error|info|debug)\s*\(/.test(inner)) {
      results.push({ line: lineNum, kind: 'console-only' });
    }
  }

  return results;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function scanSwallowedErrors(targetDir: string): Finding[] {
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
    const catches = findSwallowedCatches(content);

    for (const { line, kind } of catches) {
      if (findings.length >= MAX_FINDINGS) break;

      if (kind === 'empty') {
        findings.push({
          severity: 'warn',
          category: 'code-quality',
          rule: 'swallowed-error',
          priority: 24,
          message: 'Empty catch block — error is silently swallowed',
          file: rel,
          line,
          confidence: 'high',
          suggestion: 'Handle or re-throw the error',
        });
      } else {
        findings.push({
          severity: 'warn',
          category: 'code-quality',
          rule: 'swallowed-error',
          priority: 24,
          message: 'Catch block only logs the error — not handled or propagated',
          file: rel,
          line,
          confidence: 'high',
          suggestion: 'Handle the error or re-throw after logging',
        });
      }
    }
  }

  return findings;
}
