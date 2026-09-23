import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRequirements, parseEnvKeys } from '../src/scanners/requirements.js';
import { diffRequirementsVsEnvironment } from '../src/scanners/diff.js';
import type { LocalEnvironment, ProjectRequirements } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

// ─── parseEnvKeys ─────────────────────────────────────────────────────────────

describe('parseEnvKeys', () => {
  it('extracts keys from standard .env format', () => {
    const content = `
DATABASE_URL=postgres://localhost/db
# This is a comment
REDIS_URL=redis://localhost
SECRET_KEY=

# Another comment
PORT=3000
`;
    expect(parseEnvKeys(content)).toEqual([
      'DATABASE_URL',
      'REDIS_URL',
      'SECRET_KEY',
      'PORT',
    ]);
  });

  it('ignores blank lines and pure comment lines', () => {
    const content = `\n# header\n\nFOO=bar\n`;
    expect(parseEnvKeys(content)).toEqual(['FOO']);
  });

  it('handles empty content', () => {
    expect(parseEnvKeys('')).toEqual([]);
  });
});

// ─── scanRequirements ─────────────────────────────────────────────────────────

describe('scanRequirements — happy-path fixture', () => {
  const dir = path.join(FIXTURES, 'happy-path');
  let reqs: ProjectRequirements;

  it('reads engines.node correctly', () => {
    reqs = scanRequirements(dir);
    expect(reqs.nodeRange).toBe('>=20');
  });

  it('detects pnpm from lockfile', () => {
    reqs = reqs ?? scanRequirements(dir);
    expect(reqs.packageManager).toBe('pnpm');
    expect(reqs.lockfilePath).toContain('pnpm-lock.yaml');
  });

  it('reads .env.example keys', () => {
    reqs = reqs ?? scanRequirements(dir);
    expect(reqs.envExampleKeys).toContain('DATABASE_URL');
    expect(reqs.envExampleKeys).toContain('SECRET_KEY');
  });

  it('parses port from scripts', () => {
    reqs = reqs ?? scanRequirements(dir);
    expect(reqs.requiredPorts).toContain(5173);
  });
});

describe('scanRequirements — broken-project fixture', () => {
  const dir = path.join(FIXTURES, 'broken-project');

  it('reads engines.node >=22', () => {
    const reqs = scanRequirements(dir);
    expect(reqs.nodeRange).toBe('>=22');
  });

  it('detects ports 3000 and 8080 from scripts', () => {
    const reqs = scanRequirements(dir);
    expect(reqs.requiredPorts).toContain(3000);
    expect(reqs.requiredPorts).toContain(8080);
  });
});

// ─── diffRequirementsVsEnvironment ───────────────────────────────────────────

describe('diff — node version mismatch', () => {
  it('produces an error finding when node version does not satisfy range', () => {
    const reqs: ProjectRequirements = {
      nodeRange: '>=22',
      packageManager: null,
      lockfilePath: null,
      envExampleKeys: [],
      dockerRequired: false,
      requiredPorts: [],
      packageJsonPath: null,
    };
    const env: LocalEnvironment = {
      nodeVersion: 'v20.14.0',       // does NOT satisfy >=22
      packageManagerVersion: null,
      nodeModulesExists: true,
      lockfileNewerThanModules: false,
      envKeys: [],
      envFileExists: false,
      dockerCliAvailable: false,
      dockerDaemonRunning: false,
      boundPorts: [],
    };

    const findings = diffRequirementsVsEnvironment(reqs, env);
    const nodeFinding = findings.find((f) => f.category === 'node');
    expect(nodeFinding?.severity).toBe('error');
    expect(nodeFinding?.message).toContain('>=22');
    expect(nodeFinding?.fix).toBeDefined();
  });

  it('produces an ok finding when node version satisfies range', () => {
    const reqs: ProjectRequirements = {
      nodeRange: '>=20',
      packageManager: null,
      lockfilePath: null,
      envExampleKeys: [],
      dockerRequired: false,
      requiredPorts: [],
      packageJsonPath: null,
    };
    const env: LocalEnvironment = {
      nodeVersion: 'v20.14.0',
      packageManagerVersion: null,
      nodeModulesExists: true,
      lockfileNewerThanModules: false,
      envKeys: [],
      envFileExists: false,
      dockerCliAvailable: false,
      dockerDaemonRunning: false,
      boundPorts: [],
    };

    const findings = diffRequirementsVsEnvironment(reqs, env);
    const nodeFinding = findings.find((f) => f.category === 'node');
    expect(nodeFinding?.severity).toBe('ok');
  });
});

describe('diff — lockfile newer than node_modules', () => {
  it('produces a warn finding', () => {
    const reqs: ProjectRequirements = {
      nodeRange: '>=20',
      packageManager: 'pnpm',
      lockfilePath: '/fake/pnpm-lock.yaml',
      envExampleKeys: [],
      dockerRequired: false,
      requiredPorts: [],
      packageJsonPath: null,
    };
    const env: LocalEnvironment = {
      nodeVersion: 'v20.14.0',
      packageManagerVersion: '9.2.0',
      nodeModulesExists: true,
      lockfileNewerThanModules: true,   // ← key condition
      envKeys: [],
      envFileExists: false,
      dockerCliAvailable: false,
      dockerDaemonRunning: false,
      boundPorts: [],
    };

    const findings = diffRequirementsVsEnvironment(reqs, env);
    const depFinding = findings.find((f) => f.category === 'deps');
    expect(depFinding?.severity).toBe('warn');
    expect(depFinding?.message).toContain('out of sync');
  });
});

describe('diff — env key mismatches', () => {
  it('reports a grouped error when .env is missing entirely', () => {
    const reqs: ProjectRequirements = {
      nodeRange: null,
      packageManager: null,
      lockfilePath: null,
      envExampleKeys: ['DATABASE_URL', 'SECRET_KEY'],
      dockerRequired: false,
      requiredPorts: [],
      packageJsonPath: null,
    };
    const env: LocalEnvironment = {
      nodeVersion: 'v20.0.0',
      packageManagerVersion: null,
      nodeModulesExists: false,
      lockfileNewerThanModules: false,
      envKeys: [],
      envFileExists: false,          // ← .env absent
      dockerCliAvailable: false,
      dockerDaemonRunning: false,
      boundPorts: [],
    };

    const findings = diffRequirementsVsEnvironment(reqs, env);
    const envFindings = findings.filter((f) => f.category === 'env');
    expect(envFindings).toHaveLength(1);
    expect(envFindings[0]!.severity).toBe('error');
    expect(envFindings[0]!.message).toContain('.env file is missing');
    expect(envFindings[0]!.fix).toBe('cp .env.example .env');
  });

  it('reports per-key errors for missing keys when .env exists', () => {
    const reqs: ProjectRequirements = {
      nodeRange: null,
      packageManager: null,
      lockfilePath: null,
      envExampleKeys: ['DATABASE_URL', 'SECRET_KEY', 'PORT'],
      dockerRequired: false,
      requiredPorts: [],
      packageJsonPath: null,
    };
    const env: LocalEnvironment = {
      nodeVersion: 'v20.0.0',
      packageManagerVersion: null,
      nodeModulesExists: false,
      lockfileNewerThanModules: false,
      envKeys: ['PORT'],             // only PORT present
      envFileExists: true,
      dockerCliAvailable: false,
      dockerDaemonRunning: false,
      boundPorts: [],
    };

    const findings = diffRequirementsVsEnvironment(reqs, env);
    const envErrors = findings.filter((f) => f.category === 'env' && f.severity === 'error');
    expect(envErrors).toHaveLength(2);
    const missingKeys = envErrors.map((f) => f.message);
    expect(missingKeys.some((m) => m.includes('DATABASE_URL'))).toBe(true);
    expect(missingKeys.some((m) => m.includes('SECRET_KEY'))).toBe(true);
  });
});

describe('diff — priority ordering', () => {
  it('node finding always comes before pm/deps/env findings', () => {
    const reqs: ProjectRequirements = {
      nodeRange: '>=22',
      packageManager: 'pnpm',
      lockfilePath: null,
      envExampleKeys: ['FOO'],
      dockerRequired: false,
      requiredPorts: [],
      packageJsonPath: null,
    };
    const env: LocalEnvironment = {
      nodeVersion: 'v20.14.0',
      packageManagerVersion: null,
      nodeModulesExists: false,
      lockfileNewerThanModules: false,
      envKeys: [],
      envFileExists: false,
      dockerCliAvailable: false,
      dockerDaemonRunning: false,
      boundPorts: [],
    };

    const findings = diffRequirementsVsEnvironment(reqs, env);
    const categories = findings.map((f) => f.category);
    const nodeIdx = categories.indexOf('node');
    const pmIdx = categories.indexOf('pm');
    const depsIdx = categories.indexOf('deps');
    const envIdx = categories.indexOf('env');

    expect(nodeIdx).toBeLessThan(pmIdx);
    expect(pmIdx).toBeLessThan(depsIdx);
    expect(depsIdx).toBeLessThan(envIdx);
  });
});
