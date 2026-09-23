import { describe, it, expect } from 'vitest';
import { renderJson } from '../src/report/format.js';
import type { ScanResult, Finding } from '../src/types.js';

// ─── renderJson ───────────────────────────────────────────────────────────────

describe('renderJson', () => {
  const makeFinding = (overrides: Partial<Finding> = {}): Finding => ({
    severity: 'ok',
    category: 'node',
    priority: 1,
    message: 'Node v20 satisfies >=20',
    ...overrides,
  });

  const makeResult = (findings: Finding[] = []): ScanResult => ({
    targetDir: '/fake/project',
    findings,
    scannedAt: '2026-01-01T00:00:00.000Z',
  });

  it('produces valid JSON', () => {
    const result = makeResult([makeFinding()]);
    expect(() => JSON.parse(renderJson(result))).not.toThrow();
  });

  it('output contains targetDir, findings, and scannedAt', () => {
    const result = makeResult([makeFinding()]);
    const parsed = JSON.parse(renderJson(result)) as ScanResult;
    expect(parsed.targetDir).toBe('/fake/project');
    expect(parsed.scannedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(Array.isArray(parsed.findings)).toBe(true);
  });

  it('preserves all finding fields', () => {
    const finding = makeFinding({
      severity: 'error',
      category: 'env',
      priority: 4,
      message: 'DATABASE_URL missing',
      fix: '# Add DATABASE_URL=<value>',
    });
    const parsed = JSON.parse(renderJson(makeResult([finding]))) as ScanResult;
    const f = parsed.findings[0]!;
    expect(f.severity).toBe('error');
    expect(f.category).toBe('env');
    expect(f.fix).toBe('# Add DATABASE_URL=<value>');
  });

  it('serialises multiple findings in order', () => {
    const findings: Finding[] = [
      makeFinding({ priority: 1, category: 'node', message: 'node ok' }),
      makeFinding({ priority: 2, category: 'pm', message: 'pm ok' }),
      makeFinding({ priority: 3, category: 'deps', message: 'deps ok' }),
    ];
    const parsed = JSON.parse(renderJson(makeResult(findings))) as ScanResult;
    expect(parsed.findings.map((f) => f.category)).toEqual(['node', 'pm', 'deps']);
  });
});
