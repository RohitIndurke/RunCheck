/**
 * report/format.ts
 *
 * Preserved for backwards compatibility (test/format.test.ts imports from here).
 * The V1 human-readable renderer is in ship-report.ts.
 *
 * renderJson now delegates to the V1 renderer which includes a proper status wrapper.
 * renderTable is kept as a minimal fallback (not used by the V1 CLI).
 */

import pc from 'picocolors';
import type { Finding, ScanResult, Severity } from '../types.js';
export { renderJson } from './ship-report.js';

// ─── Icons & colors ───────────────────────────────────────────────────────────

const ICON: Record<Severity, string> = {
  error: '✗ ',
  warn:  '⚠ ',
  ok:    '✓ ',
  info:  'ℹ ',
};

const CATEGORY_LABEL: Partial<Record<Finding['category'], string>> = {
  node:           'Node      ',
  pm:             'Package Mgr',
  'ambiguous-pm': 'Lockfiles  ',
  deps:           'Deps       ',
  env:            'Env Vars   ',
  docker:         'Docker     ',
  ports:          'Ports      ',
};

// ─── Human-readable renderer (legacy — V1 uses renderShipReport) ──────────────

export function renderTable(result: ScanResult): string {
  const { findings, targetDir } = result;

  const errors   = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warn');
  const info     = findings.filter((f) => f.severity === 'info');
  const passed   = findings.filter((f) => f.severity === 'ok');

  const lines: string[] = [];

  lines.push('');
  lines.push(
    pc.bold('RunCheck') +
    pc.dim(`  v1.0.0`) +
    pc.dim('  ·  ') +
    pc.dim(targetDir),
  );
  lines.push(pc.dim('─'.repeat(60)));
  lines.push('');

  function renderSection(
    sectionFindings: Finding[],
    label: string,
    colorFn: (s: string) => string,
    dimItems: boolean,
  ): void {
    if (sectionFindings.length === 0) return;
    lines.push(pc.bold(label));
    for (const f of sectionFindings) {
      const icon = ICON[f.severity];
      const cat = pc.dim((CATEGORY_LABEL[f.category] ?? f.category).padEnd(11));
      const msg  = dimItems ? pc.dim(f.message) : colorFn(f.message);
      lines.push(`  ${icon}  ${cat}  ${msg}`);
      if (f.fix) {
        lines.push(`           ${pc.dim('→ fix: ')}${pc.dim(f.fix)}`);
      }
    }
    lines.push('');
  }

  renderSection(errors,   'Errors',   pc.red,    false);
  renderSection(info,     'Setup',    pc.cyan,   false);
  renderSection(warnings, 'Warnings', pc.yellow, false);
  renderSection(passed,   'Passed',   pc.green,  true);

  const errCount  = errors.length;
  const warnCount = warnings.length;
  const infoCount = info.length;
  const okCount   = passed.length;

  if (errCount === 0 && warnCount === 0 && infoCount === 0) {
    lines.push(pc.green(pc.bold(`✓ All ${okCount} checks passed.`)));
  } else {
    const parts: string[] = [];
    if (errCount)  parts.push(pc.red(`${errCount} error${errCount > 1 ? 's' : ''}`));
    if (infoCount) parts.push(pc.cyan(`${infoCount} setup action${infoCount > 1 ? 's' : ''}`));
    if (warnCount) parts.push(pc.yellow(`${warnCount} warning${warnCount > 1 ? 's' : ''}`));
    if (okCount)   parts.push(pc.green(`${okCount} passed`));
    const summary = parts.join(pc.dim(' · '));
    lines.push(errCount > 0 ? pc.bold(summary) : summary);
  }

  lines.push('');
  return lines.join('\n');
}
