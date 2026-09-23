/**
 * format.ts
 *
 * Renders a ScanResult to the terminal (modern line-based renderer)
 * or as machine-readable JSON.
 *
 * The human-readable renderer is styled like Bun/Vite/pnpm output:
 *   - No outer borders
 *   - Status glyph + colored category label + message, one per line
 *   - Grouped by severity: Errors → Warnings → Passed
 *   - Indented "→ fix:" line directly under each actionable finding
 *   - Compact summary line at the end
 */

import pc from 'picocolors';
import type { Finding, ScanResult, Severity } from '../types.js';

// ─── Icons & colors ───────────────────────────────────────────────────────────

const ICON: Record<Severity, string> = {
  error: '❌',
  warn:  '⚠ ',
  ok:    '✓ ',
};

const CATEGORY_LABEL: Record<Finding['category'], string> = {
  node:           'Node      ',
  pm:             'Package Mgr',
  'ambiguous-pm': 'Lockfiles  ',
  deps:           'Deps       ',
  env:            'Env Vars   ',
  docker:         'Docker     ',
  ports:          'Ports      ',
};

// ─── Human-readable renderer ──────────────────────────────────────────────────

export function renderTable(result: ScanResult): string {
  const { findings, targetDir } = result;

  const errors   = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warn');
  const passed   = findings.filter((f) => f.severity === 'ok');

  const lines: string[] = [];

  // ── Banner ──────────────────────────────────────────────────────────────────
  lines.push('');
  lines.push(
    pc.bold('RunCheck') +
    pc.dim('  v0.1.1') +
    pc.dim('  ·  ') +
    pc.dim(targetDir),
  );
  lines.push(pc.dim('─'.repeat(60)));
  lines.push('');

  // ── Section renderer ────────────────────────────────────────────────────────
  function renderSection(
    sectionFindings: Finding[],
    label: string,
    colorFn: (s: string) => string,
    dimItems: boolean,
  ): void {
    if (sectionFindings.length === 0) return;

    lines.push(pc.bold(label));

    for (const f of sectionFindings) {
      const icon     = ICON[f.severity];
      const cat      = pc.dim(CATEGORY_LABEL[f.category] ?? f.category.padEnd(11));
      const msg      = dimItems ? pc.dim(f.message) : colorFn(f.message);
      lines.push(`  ${icon}  ${cat}  ${msg}`);

      if (f.fix) {
        lines.push(`           ${pc.dim('→ fix: ')}${pc.dim(f.fix)}`);
      }
    }

    lines.push('');
  }

  renderSection(errors,   'Errors',   pc.red,    false);
  renderSection(warnings, 'Warnings', pc.yellow, false);
  renderSection(passed,   'Passed',   pc.green,  true);

  // ── Summary ──────────────────────────────────────────────────────────────────
  const errCount  = errors.length;
  const warnCount = warnings.length;
  const okCount   = passed.length;

  if (errCount === 0 && warnCount === 0) {
    lines.push(pc.green(pc.bold(`✓ All ${okCount} checks passed.`)));
  } else {
    const parts: string[] = [];
    if (errCount)  parts.push(pc.red(`${errCount} error${errCount > 1 ? 's' : ''}`));
    if (warnCount) parts.push(pc.yellow(`${warnCount} warning${warnCount > 1 ? 's' : ''}`));
    if (okCount)   parts.push(pc.green(`${okCount} passed`));

    const summary = parts.join(pc.dim(' · '));
    lines.push(errCount > 0 ? pc.bold(summary) : summary);
  }

  lines.push('');
  return lines.join('\n');
}

// ─── JSON output ──────────────────────────────────────────────────────────────

export function renderJson(result: ScanResult): string {
  return JSON.stringify(result, null, 2);
}
