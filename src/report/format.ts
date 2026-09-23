/**
 * format.ts
 *
 * Renders a ScanResult to the terminal (colored table + fix section)
 * or as machine-readable JSON.
 */

import Table from 'cli-table3';
import pc from 'picocolors';
import type { Finding, ScanResult, Severity } from '../types.js';

// ─── Icons & colors ───────────────────────────────────────────────────────────

const ICON: Record<Severity, string> = {
  error: '❌',
  warn: '⚠ ',
  ok: '✓ ',
};

function colorBySeverity(text: string, severity: Severity): string {
  switch (severity) {
    case 'error': return pc.red(text);
    case 'warn':  return pc.yellow(text);
    case 'ok':    return pc.green(text);
  }
}

function categoryLabel(cat: Finding['category']): string {
  const labels: Record<Finding['category'], string> = {
    node:   'Node',
    pm:     'Package Mgr',
    deps:   'Dependencies',
    env:    'Env Vars',
    docker: 'Docker',
    ports:  'Ports',
  };
  return labels[cat];
}

// ─── Terminal table ───────────────────────────────────────────────────────────

export function renderTable(result: ScanResult): string {
  const { findings, targetDir } = result;

  const lines: string[] = [];

  lines.push('');
  lines.push(pc.bold(pc.cyan('RunCheck v0.1')) + pc.dim(` — scanning ${targetDir}`));
  lines.push('');

  const table = new Table({
    head: [
      pc.bold('Status'),
      pc.bold('Category'),
      pc.bold('Details'),
      pc.bold('Suggested Fix'),
    ],
    colWidths: [8, 14, 52, 42],
    wordWrap: true,
    style: { head: [], border: ['dim'] },
  });

  for (const f of findings) {
    const icon = ICON[f.severity];
    const status = colorBySeverity(`${icon}`, f.severity);
    const cat = pc.dim(categoryLabel(f.category));
    const msg = colorBySeverity(f.message, f.severity);
    const fix = f.fix ? pc.dim(f.fix) : '';
    table.push([status, cat, msg, fix]);
  }

  lines.push(table.toString());

  // ── Summary line ──
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warns  = findings.filter((f) => f.severity === 'warn').length;
  const oks    = findings.filter((f) => f.severity === 'ok').length;

  const parts: string[] = [];
  if (errors) parts.push(pc.red(`${errors} error${errors > 1 ? 's' : ''}`));
  if (warns)  parts.push(pc.yellow(`${warns} warning${warns > 1 ? 's' : ''}`));
  if (oks)    parts.push(pc.green(`${oks} ok`));

  lines.push('');
  if (errors === 0 && warns === 0) {
    lines.push(pc.green(pc.bold('✓ All checks passed.')));
  } else {
    lines.push(pc.bold('Summary: ') + parts.join(', '));
  }

  // ── Fix suggestions ──
  const fixes = findings
    .filter((f) => f.fix && !f.fix.startsWith('#'))  // skip comment-only "fixes"
    .map((f) => f.fix!);

  // Deduplicate while preserving order
  const uniqueFixes = [...new Map(fixes.map((f) => [f, f])).values()];

  if (uniqueFixes.length > 0) {
    lines.push('');
    lines.push(pc.bold('Fix suggestions:'));
    uniqueFixes.forEach((fix, i) => {
      lines.push(`  ${pc.dim(`${i + 1}.`)} ${pc.cyan(fix)}`);
    });
  }

  lines.push('');
  return lines.join('\n');
}

// ─── JSON output ──────────────────────────────────────────────────────────────

export function renderJson(result: ScanResult): string {
  return JSON.stringify(result, null, 2);
}
