/**
 * report/ship-report.ts
 *
 * The V1 Ship Report renderer.
 *
 * Design: GitHub CLI / Vercel CLI aesthetic — clean, minimal, scannable.
 *  - No ASCII art
 *  - No excessive emojis
 *  - Restrained color: green=pass, yellow=warn, red=critical, cyan=info, dim=meta
 *  - Separator lines for structure
 *  - Single final verdict: READY TO SHIP / NOT READY TO SHIP
 */

import pc from 'picocolors';
import path from 'node:path';
import type { Finding, ScanResult, BuildResult } from '../types.js';

// ─── Symbols ──────────────────────────────────────────────────────────────────

const S = {
  pass:    '✓',
  warn:    '⚠',
  fail:    '✗',
  info:    'ℹ',
  bullet:  '·',
  diamond: '◈',
  sep:     '─'.repeat(56),
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sev(f: Finding): 'critical' | 'warning' | 'suggestion' {
  if (f.severity === 'error') return 'critical';
  if (f.severity === 'warn')  return 'warning';
  return 'suggestion';
}

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

/** Left-pad to align columns */
function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

// ─── Section renderers ────────────────────────────────────────────────────────

function renderBuildSection(build: BuildResult | undefined, lines: string[]): void {
  lines.push(pc.bold('BUILD'));
  lines.push('');

  if (!build) {
    lines.push(`  ${pc.dim(S.info)}  ${pc.dim('No build script found — skipped')}`);
    lines.push('');
    return;
  }

  if (build.passed) {
    const dur = build.durationMs > 0 ? pc.dim(`  ${fmt(build.durationMs)}`) : '';
    lines.push(`  ${pc.green(S.pass)}  ${pc.green('Build passed')}${dur}`);
  } else {
    lines.push(`  ${pc.red(S.fail)}  ${pc.red('Build failed')}`);
    if (build.errorSummary) {
      lines.push('');
      for (const l of build.errorSummary.split('\n').slice(0, 6)) {
        lines.push(`     ${pc.dim(l.trimEnd())}`);
      }
    }
  }
  lines.push('');
}

function renderSecuritySection(findings: Finding[], lines: string[]): void {
  const secrets = findings.filter((f) => f.category === 'security');
  lines.push(pc.bold('SECURITY'));
  lines.push('');

  if (secrets.length === 0) {
    lines.push(`  ${pc.green(S.pass)}  ${pc.green('No secrets detected')}`);
    lines.push('');
    return;
  }

  for (const f of secrets) {
    const icon = f.severity === 'error' ? pc.red(S.fail) : pc.yellow(S.warn);
    lines.push(`  ${icon}  ${f.severity === 'error' ? pc.red(f.message) : pc.yellow(f.message)}`);
    if (f.file) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`     ${pc.dim(loc)}`);
    }
    if (f.value) {
      lines.push(`     ${pc.dim('Value:')} ${pc.dim(f.value)}`);
    }
    if (f.suggestion) {
      lines.push(`     ${pc.dim('→ ')}${pc.dim(f.suggestion)}`);
    }
  }
  lines.push('');
}

function renderCodeQualitySection(findings: Finding[], lines: string[]): void {
  const cq = findings.filter((f) => f.category === 'code-quality');
  lines.push(pc.bold('CODE QUALITY'));
  lines.push('');

  if (cq.length === 0) {
    lines.push(`  ${pc.green(S.pass)}  ${pc.green('No code quality issues detected')}`);
    lines.push('');
    return;
  }

  // Group by rule for a compact summary
  const byRule = new Map<string, Finding[]>();
  for (const f of cq) {
    const rule = f.rule ?? 'other';
    if (!byRule.has(rule)) byRule.set(rule, []);
    byRule.get(rule)!.push(f);
  }

  const ruleLabels: Record<string, string> = {
    'TODO':           'TODO/FIXME comments',
    'FIXME':          'TODO/FIXME comments',
    'HACK':           'HACK/XXX comments',
    'XXX':            'HACK/XXX comments',
    'stub':           'Possible stub implementations',
    'swallowed-error':'Swallowed errors',
    'console-log':    'Excessive console logging',
    'hardcoded-value':'Hardcoded values',
  };

  // Merge TODO and FIXME into one line
  const todoFindings = [
    ...(byRule.get('TODO') ?? []),
    ...(byRule.get('FIXME') ?? []),
    ...(byRule.get('HACK') ?? []),
    ...(byRule.get('XXX') ?? []),
  ];
  const mergedRules = new Map<string, Finding[]>();
  if (todoFindings.length > 0) mergedRules.set('TODO', todoFindings);
  for (const [rule, rFindings] of byRule) {
    if (!['TODO', 'FIXME', 'HACK', 'XXX'].includes(rule)) {
      mergedRules.set(rule, rFindings);
    }
  }

  for (const [rule, rFindings] of mergedRules) {
    const hasError = rFindings.some((f) => f.severity === 'error');
    const icon = hasError ? pc.red(S.fail) : pc.yellow(S.warn);
    const label = ruleLabels[rule] ?? rule;
    const count = rFindings.length;
    const colorFn = hasError ? pc.red : pc.yellow;
    lines.push(`  ${icon}  ${colorFn(`${count} ${label}`)}`);

    // For stubs + swallowed errors: show first few locations
    if (rule === 'stub' || rule === 'swallowed-error') {
      for (const f of rFindings.slice(0, 3)) {
        if (f.file) {
          const loc = f.line ? `${f.file}:${f.line}` : f.file;
          lines.push(`     ${pc.dim(loc)}`);
        }
      }
      if (rFindings.length > 3) {
        lines.push(`     ${pc.dim(`… and ${rFindings.length - 3} more`)}`);
      }
    }

    // For console-log: show the file breakdown
    if (rule === 'console-log' && rFindings[0]?.value) {
      lines.push('');
      for (const l of rFindings[0].value.split('\n').slice(0, 6)) {
        lines.push(`     ${pc.dim(l)}`);
      }
    }
  }

  lines.push('');
}

function renderDependenciesSection(findings: Finding[], lines: string[]): void {
  const depFindings = findings.filter(
    (f) => f.category === 'deps' || f.category === 'unused-deps',
  );

  lines.push(pc.bold('DEPENDENCIES'));
  lines.push('');

  if (depFindings.length === 0) {
    lines.push(`  ${pc.green(S.pass)}  ${pc.green('No dependency issues detected')}`);
    lines.push('');
    return;
  }

  for (const f of depFindings) {
    const icon =
      f.severity === 'error' ? pc.red(S.fail)
      : f.severity === 'warn' ? pc.yellow(S.warn)
      : f.severity === 'ok'   ? pc.green(S.pass)
      : pc.cyan(S.info);

    const colorFn =
      f.severity === 'error' ? pc.red
      : f.severity === 'warn' ? pc.yellow
      : f.severity === 'ok'   ? pc.green
      : pc.cyan;

    lines.push(`  ${icon}  ${colorFn(f.message)}`);

    // Show unused package list
    if (f.category === 'unused-deps' && f.value) {
      for (const l of f.value.split('\n')) {
        lines.push(`     ${pc.dim(l)}`);
      }
    }

    if (f.fix) {
      lines.push(`     ${pc.dim('→ ')}${pc.dim(f.fix)}`);
    }
  }

  lines.push('');
}

function renderEnvironmentSection(findings: Finding[], lines: string[]): void {
  const envFindings = findings.filter(
    (f) =>
      f.category === 'node' ||
      f.category === 'pm' ||
      f.category === 'ambiguous-pm' ||
      f.category === 'env' ||
      f.category === 'docker' ||
      f.category === 'ports',
  );

  if (envFindings.length === 0) return;

  lines.push(pc.bold('ENVIRONMENT'));
  lines.push('');

  for (const f of envFindings) {
    const icon =
      f.severity === 'error' ? pc.red(S.fail)
      : f.severity === 'warn' ? pc.yellow(S.warn)
      : f.severity === 'ok'   ? pc.green(S.pass)
      : pc.cyan(S.info);

    const colorFn =
      f.severity === 'error' ? pc.red
      : f.severity === 'warn' ? pc.yellow
      : f.severity === 'ok'   ? pc.green
      : pc.cyan;

    lines.push(`  ${icon}  ${colorFn(f.message)}`);
    if (f.fix) {
      lines.push(`     ${pc.dim('→ ')}${pc.dim(f.fix)}`);
    }
  }

  lines.push('');
}

function renderCriticalDetails(findings: Finding[], lines: string[]): void {
  const criticals = findings.filter((f) => f.severity === 'error');
  if (criticals.length === 0) return;

  lines.push(pc.dim(S.sep));
  lines.push('');
  lines.push(pc.bold(pc.red('CRITICAL FINDINGS')));
  lines.push('');

  criticals.forEach((f, idx) => {
    const n = String(idx + 1).padStart(2, ' ');
    lines.push(`  ${pc.dim(n + '.')}  ${pc.red(f.message)}`);
    if (f.file) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`       ${pc.dim(loc)}`);
    }
    if (f.value) {
      lines.push(`       ${pc.dim('Value: ')}${pc.dim(f.value)}`);
    }
    if (f.suggestion) {
      lines.push(`       ${pc.dim('→ ')}${pc.dim(f.suggestion)}`);
    }
    if (f.confidence) {
      lines.push(`       ${pc.dim(`Confidence: ${f.confidence}`)}`);
    }
    lines.push('');
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function renderShipReport(result: ScanResult): string {
  const { findings, targetDir, durationMs, buildResult, projectName } = result;
  const lines: string[] = [];

  // Classify
  const critical    = findings.filter((f) => f.severity === 'error').length;
  const warnings    = findings.filter((f) => f.severity === 'warn').length;
  const suggestions = findings.filter((f) => f.severity === 'info').length;

  const buildFailed = buildResult && !buildResult.passed;
  const notReady    = critical > 0 || buildFailed;

  const name = projectName ?? path.basename(targetDir);

  // ── Banner ──────────────────────────────────────────────────────────────────
  lines.push('');
  lines.push(pc.bold(`${S.diamond} RunCheck`));
  lines.push(pc.dim('Pre-ship sanity check'));
  lines.push('');
  lines.push(pc.dim(S.sep));
  lines.push('');

  // ── Meta ────────────────────────────────────────────────────────────────────
  lines.push(`${pc.dim('Project:')}  ${name}`);
  if (durationMs) {
    lines.push(`${pc.dim('Duration:')} ${fmt(durationMs)}`);
  }
  lines.push('');
  lines.push(pc.dim(S.sep));
  lines.push('');

  // ── Verdict ─────────────────────────────────────────────────────────────────
  lines.push(pc.bold('RESULT'));
  lines.push('');
  if (notReady) {
    lines.push(`  ${pc.red(pc.bold(`${S.fail} NOT READY TO SHIP`))}`);
  } else {
    lines.push(`  ${pc.green(pc.bold(`${S.pass} READY TO SHIP`))}`);
  }
  lines.push('');

  const parts: string[] = [];
  if (critical)    parts.push(pc.red(`${critical} critical`));
  if (warnings)    parts.push(pc.yellow(`${warnings} warning${warnings > 1 ? 's' : ''}`));
  if (suggestions) parts.push(pc.cyan(`${suggestions} suggestion${suggestions > 1 ? 's' : ''}`));
  if (parts.length > 0) {
    lines.push(`  ${parts.join(pc.dim(' · '))}`);
    lines.push('');
  }

  lines.push(pc.dim(S.sep));
  lines.push('');

  // ── Sections ────────────────────────────────────────────────────────────────
  renderBuildSection(buildResult, lines);
  renderSecuritySection(findings, lines);
  renderCodeQualitySection(findings, lines);
  renderDependenciesSection(findings, lines);
  renderEnvironmentSection(findings, lines);

  // ── Critical details ────────────────────────────────────────────────────────
  renderCriticalDetails(findings, lines);

  // ── Footer ──────────────────────────────────────────────────────────────────
  lines.push(pc.dim(S.sep));
  lines.push('');
  lines.push(pc.dim(`Run ${pc.reset('runcheck --verbose')} for full details.`));
  lines.push(pc.dim(`Run ${pc.reset('runcheck --json')} for machine-readable output.`));
  lines.push('');

  return lines.join('\n');
}

// ─── JSON output ──────────────────────────────────────────────────────────────

export function renderJson(result: ScanResult): string {
  const critical    = result.findings.filter((f) => f.severity === 'error').length;
  const warnings    = result.findings.filter((f) => f.severity === 'warn').length;
  const suggestions = result.findings.filter((f) => f.severity === 'info').length;

  const buildFailed = result.buildResult && !result.buildResult.passed;
  const status      = critical > 0 || buildFailed ? 'failed' : 'passed';

  const out = {
    status,
    summary: { critical, warnings, suggestions },
    projectName: result.projectName,
    targetDir: result.targetDir,
    scannedAt: result.scannedAt,
    durationMs: result.durationMs,
    build: result.buildResult ?? null,
    findings: result.findings,
  };

  return JSON.stringify(out, null, 2);
}
