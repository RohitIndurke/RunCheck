/**
 * test/checks.test.ts
 *
 * Tests for all V1 check modules:
 *  - TODO scanner
 *  - Stub detector
 *  - Swallowed errors detector
 *  - Console-log detector
 *  - Hardcoded values detector
 *  - Secret detector
 *  - Unused dependency detector
 *
 * Each test uses a temporary in-memory directory written to disk,
 * runs the scanner, then cleans up.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { scanTodos } from '../src/checks/code-quality/todo.js';
import { scanStubs } from '../src/checks/code-quality/stubs.js';
import { scanSwallowedErrors } from '../src/checks/code-quality/swallowed-errors.js';
import { scanConsoleLogs } from '../src/checks/code-quality/console-logs.js';
import { scanHardcodedValues } from '../src/checks/code-quality/hardcoded-values.js';
import { scanSecrets } from '../src/checks/security/secrets.js';
import { scanUnusedDeps } from '../src/checks/dependencies/unused-deps.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'runcheck-test-'));
}

function writeFile(dir: string, name: string, content: string): string {
  const fullPath = path.join(dir, name);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── TODO scanner ─────────────────────────────────────────────────────────────

describe('scanTodos', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => removeTmpDir(dir));

  it('detects // TODO: comments', () => {
    writeFile(dir, 'src/index.ts', `
const x = 1;
// TODO: implement this
function foo() {}
`);
    const findings = scanTodos(dir);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.rule).toBe('TODO');
    expect(findings[0]!.severity).toBe('warn');
    expect(findings[0]!.file).toContain('index.ts');
    expect(findings[0]!.line).toBe(3);
  });

  it('detects FIXME comments', () => {
    writeFile(dir, 'src/app.ts', `// FIXME: temporary hack`);
    const findings = scanTodos(dir);
    expect(findings.some((f) => f.rule === 'FIXME')).toBe(true);
  });

  it('detects HACK and XXX comments', () => {
    writeFile(dir, 'src/util.ts', `
// HACK: remove before launch
// XXX: this will break
`);
    const findings = scanTodos(dir);
    expect(findings.length).toBe(2);
  });

  it('does NOT flag normal code without TODO/FIXME', () => {
    writeFile(dir, 'src/clean.ts', `
const greeting = 'hello world';
function add(a: number, b: number) { return a + b; }
`);
    expect(scanTodos(dir)).toHaveLength(0);
  });

  it('skips node_modules', () => {
    writeFile(dir, 'node_modules/pkg/index.js', `// TODO: upstream issue`);
    expect(scanTodos(dir)).toHaveLength(0);
  });
});

// ─── Stub detector ────────────────────────────────────────────────────────────

describe('scanStubs', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => removeTmpDir(dir));

  it('detects throw new Error("Not implemented")', () => {
    writeFile(dir, 'src/service.ts', `
function processPayment() {
  throw new Error('Not implemented');
}
`);
    const findings = scanStubs(dir);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.severity).toBe('error');
    expect(findings[0]!.confidence).toBe('high');
  });

  it('detects throw new Error("TODO")', () => {
    writeFile(dir, 'src/handler.ts', `
export function handleRequest() {
  throw new Error('TODO');
}
`);
    const findings = scanStubs(dir);
    expect(findings.some((f) => f.severity === 'error')).toBe(true);
  });

  it('does NOT flag legitimate throw new Error with real messages', () => {
    writeFile(dir, 'src/valid.ts', `
function parseUser(data: unknown) {
  if (!data) throw new Error('User data is required');
  return data;
}
`);
    // No stub pattern matches a real business error
    const findings = scanStubs(dir);
    expect(findings.filter((f) => f.severity === 'error')).toHaveLength(0);
  });

  it('detects bare return null inside a handler function', () => {
    writeFile(dir, 'src/auth.ts', `
function handleAuth(token: string) {
  return null;
}
`);
    const findings = scanStubs(dir);
    // Medium confidence stub finding
    expect(findings.some((f) => f.rule === 'stub')).toBe(true);
  });
});

// ─── Swallowed errors ─────────────────────────────────────────────────────────

describe('scanSwallowedErrors', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => removeTmpDir(dir));

  it('detects empty catch blocks', () => {
    writeFile(dir, 'src/api.ts', `
try {
  fetchData();
} catch (e) {
}
`);
    const findings = scanSwallowedErrors(dir);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.rule).toBe('swallowed-error');
    expect(findings[0]!.severity).toBe('warn');
  });

  it('detects console-only catch blocks', () => {
    writeFile(dir, 'src/db.ts', `
try {
  db.connect();
} catch (err) {
  console.log(err);
}
`);
    const findings = scanSwallowedErrors(dir);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.rule).toBe('swallowed-error');
  });

  it('does NOT flag catch blocks that re-throw', () => {
    writeFile(dir, 'src/safe.ts', `
try {
  riskyOperation();
} catch (err) {
  logger.error('Operation failed', err);
  throw err;
}
`);
    const findings = scanSwallowedErrors(dir);
    expect(findings).toHaveLength(0);
  });

  it('does NOT flag catch blocks with real error handling', () => {
    writeFile(dir, 'src/handled.ts', `
try {
  processFile(path);
} catch (err) {
  if (err instanceof NotFoundError) {
    return defaultValue;
  }
  throw err;
}
`);
    expect(scanSwallowedErrors(dir)).toHaveLength(0);
  });
});

// ─── Console log detector ─────────────────────────────────────────────────────

describe('scanConsoleLogs', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => removeTmpDir(dir));

  it('returns no finding below the threshold', () => {
    writeFile(dir, 'src/index.ts', `
console.log('starting');
console.log('done');
`);
    // 2 calls < MIN_THRESHOLD (5)
    expect(scanConsoleLogs(dir)).toHaveLength(0);
  });

  it('returns a grouped finding above the threshold', () => {
    writeFile(dir, 'src/dashboard.ts', `
console.log('a'); console.log('b'); console.log('c');
console.log('d'); console.log('e'); console.log('f');
console.log('g');
`);
    const findings = scanConsoleLogs(dir);
    expect(findings.length).toBe(1);
    expect(findings[0]!.rule).toBe('console-log');
    expect(findings[0]!.severity).toBe('warn');
    expect(findings[0]!.message).toContain('console statements');
  });

  it('skips node_modules', () => {
    writeFile(dir, 'node_modules/lib/index.js', `
console.log('a'); console.log('b'); console.log('c');
console.log('d'); console.log('e'); console.log('f');
`);
    expect(scanConsoleLogs(dir)).toHaveLength(0);
  });
});

// ─── Hardcoded values detector ────────────────────────────────────────────────

describe('scanHardcodedValues', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => removeTmpDir(dir));

  it('detects hardcoded localhost URLs', () => {
    writeFile(dir, 'src/client.ts', `
const API = 'http://localhost:3000/api';
`);
    const findings = scanHardcodedValues(dir);
    expect(findings.some((f) => f.rule === 'hardcoded-value')).toBe(true);
    expect(findings[0]!.message).toContain('localhost');
  });

  it('detects hardcoded 127.0.0.1 URLs', () => {
    writeFile(dir, 'src/config.ts', `
const BASE = 'http://127.0.0.1:8080';
`);
    const findings = scanHardcodedValues(dir);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT flag comment lines', () => {
    writeFile(dir, 'src/readme.ts', `
// Example: http://localhost:3000/api
/* docs: http://localhost:8080 */
`);
    expect(scanHardcodedValues(dir)).toHaveLength(0);
  });
});

// ─── Secret detector ──────────────────────────────────────────────────────────

describe('scanSecrets', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => removeTmpDir(dir));

  it('detects OpenAI API keys', () => {
    const keyVal = 'sk-proj-' + 'abcdefghijklmnopqrstuvwxyz1234567890ABCDE';
    writeFile(dir, 'src/config.ts', `const key = '${keyVal}';`);
    const findings = scanSecrets(dir);
    expect(findings.some((f) => f.message.includes('OpenAI'))).toBe(true);
    expect(findings[0]!.severity).toBe('error');
  });

  it('redacts the secret value — never shows it fully', () => {
    const keyVal = 'sk-proj-' + 'abcdefghijklmnopqrstuvwxyz1234567890ABCDE';
    writeFile(dir, 'src/config.ts', `const key = '${keyVal}';`);
    const findings = scanSecrets(dir);
    const secretFinding = findings.find((f) => f.category === 'security');
    expect(secretFinding).toBeDefined();
    // Value field should be redacted (contains bullets)
    expect(secretFinding!.value).toBeDefined();
    expect(secretFinding!.value!).toContain('•');
    // Should NOT contain the actual key
    expect(secretFinding!.value).not.toContain('abcdefghijklmno');
  });

  it('detects AWS Access Key IDs', () => {
    writeFile(dir, 'src/aws.ts', `
const accessKey = 'AKIAIOSFODNN7EXAMPLE';
`);
    // EXAMPLE suffix means it might be flagged as example... let's use a realistic one
    const awsKey = 'AKIA' + 'ZR4LDUUXMID12345';
    writeFile(dir, 'src/aws2.ts', `const accessKey = '${awsKey}';`);
    const findings = scanSecrets(dir);
    expect(findings.some((f) => f.message.includes('AWS'))).toBe(true);
  });

  it('detects Stripe secret keys', () => {
    const stripeKey = 'sk_test_' + 'abcdefghijklmnopqrstuvwx';
    writeFile(dir, 'src/payments.ts', `const stripe = '${stripeKey}';`);
    const findings = scanSecrets(dir);
    expect(findings.some((f) => f.message.includes('Stripe'))).toBe(true);
  });

  it('detects JWT tokens', () => {
    const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.' + 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    writeFile(dir, 'src/auth.ts', `const token = '${jwtToken}';`);
    const findings = scanSecrets(dir);
    expect(findings.some((f) => f.message.includes('JWT'))).toBe(true);
  });

  it('does NOT flag placeholder/example values', () => {
    writeFile(dir, 'src/example.ts', `
const key = 'your-api-key-here';
const token = 'replace_me_with_your_token';
`);
    const secretFindings = scanSecrets(dir).filter(
      (f) => f.category === 'security' && f.rule === 'secret',
    );
    expect(secretFindings).toHaveLength(0);
  });

  it('skips test and fixture files', () => {
    const keyVal = 'sk-proj-' + 'abcdefghijklmnopqrstuvwxyz1234567890ABCDE';
    writeFile(dir, 'src/auth.test.ts', `const key = '${keyVal}';`);
    const findings = scanSecrets(dir);
    const secretFindings = findings.filter((f) => f.rule === 'secret');
    expect(secretFindings).toHaveLength(0);
  });

  it('detects .env not in .gitignore', () => {
    writeFile(dir, '.env', 'DATABASE_URL=postgres://localhost/db');
    writeFile(dir, '.gitignore', 'dist/\n*.log\n');
    const findings = scanSecrets(dir);
    expect(findings.some((f) => f.rule === 'env-exposed')).toBe(true);
  });

  it('does NOT flag .env when it is in .gitignore', () => {
    writeFile(dir, '.env', 'DATABASE_URL=postgres://localhost/db');
    writeFile(dir, '.gitignore', '.env\n*.log\n');
    const findings = scanSecrets(dir);
    expect(findings.filter((f) => f.rule === 'env-exposed')).toHaveLength(0);
  });
});

// ─── Unused dependency detector ───────────────────────────────────────────────

describe('scanUnusedDeps', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => removeTmpDir(dir));

  it('returns no finding when all deps are imported', () => {
    writeFile(dir, 'package.json', JSON.stringify({
      dependencies: { commander: '^12.0.0', picocolors: '^1.1.0' },
    }));
    writeFile(dir, 'src/index.ts', `
import { program } from 'commander';
import pc from 'picocolors';
`);
    expect(scanUnusedDeps(dir)).toHaveLength(0);
  });

  it('reports a finding when a dep is unused', () => {
    writeFile(dir, 'package.json', JSON.stringify({
      dependencies: {
        commander: '^12.0.0',
        lodash: '^4.0.0',  // not imported
      },
    }));
    writeFile(dir, 'src/index.ts', `import { program } from 'commander';`);
    const findings = scanUnusedDeps(dir);
    expect(findings.length).toBe(1);
    expect(findings[0]!.value).toContain('lodash');
    expect(findings[0]!.severity).toBe('warn');
  });

  it('does not flag config-only packages as unused', () => {
    writeFile(dir, 'package.json', JSON.stringify({
      dependencies: { typescript: '^5.0.0', vitest: '^2.0.0' },
    }));
    writeFile(dir, 'src/index.ts', `const x = 1;`);
    // Both are in CONFIG_ONLY_PACKAGES — should not be flagged
    expect(scanUnusedDeps(dir)).toHaveLength(0);
  });

  it('handles scoped packages correctly', () => {
    writeFile(dir, 'package.json', JSON.stringify({
      dependencies: { '@org/pkg': '^1.0.0' },
    }));
    writeFile(dir, 'src/index.ts', `import { foo } from '@org/pkg';`);
    expect(scanUnusedDeps(dir)).toHaveLength(0);
  });

  it('skips gracefully when no package.json exists', () => {
    expect(scanUnusedDeps(dir)).toHaveLength(0);
  });
});
