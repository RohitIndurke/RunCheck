/**
 * diff.ts
 *
 * Pure function: takes requirements + environment, returns an ordered
 * list of findings. No I/O here — makes it easy to unit-test.
 *
 * Root-cause priority order:
 *   1 — Node version  (breaks everything downstream)
 *   2 — Package manager missing
 *   3 — Dependencies not installed / stale
 *   4 — .env key mismatches
 *   5 — Docker unavailable
 *   6 — Ports already bound
 */

import semver from 'semver';
import type { Finding, LocalEnvironment, ProjectRequirements } from '../types.js';

// ─── Individual checks ────────────────────────────────────────────────────────

function checkNode(
  reqs: ProjectRequirements,
  env: LocalEnvironment,
): Finding[] {
  if (!reqs.nodeRange) {
    return [
      {
        severity: 'ok',
        category: 'node',
        priority: 1,
        message: 'No Node version requirement declared (engines.node / .nvmrc)',
      },
    ];
  }

  // strip the leading "v" so semver.satisfies works
  const installed = env.nodeVersion.replace(/^v/, '');
  const range = reqs.nodeRange;

  if (semver.satisfies(installed, range)) {
    return [
      {
        severity: 'ok',
        category: 'node',
        priority: 1,
        message: `Node ${env.nodeVersion} satisfies required ${range}`,
      },
    ];
  }

  // Suggest a version to install (the minimum satisfying version)
  const minVer = semver.minVersion(range);
  const fix = minVer ? `nvm install ${minVer.major} && nvm use ${minVer.major}` : 'nvm use <required-version>';

  return [
    {
      severity: 'error',
      category: 'node',
      priority: 1,
      message: `Node ${env.nodeVersion} detected — project requires ${range}`,
      fix,
    },
  ];
}

function checkPackageManager(
  reqs: ProjectRequirements,
  env: LocalEnvironment,
): Finding[] {
  if (!reqs.packageManager) {
    return [
      {
        severity: 'ok',
        category: 'pm',
        priority: 2,
        message: 'No package manager lockfile detected',
      },
    ];
  }

  const pm = reqs.packageManager;

  if (!env.packageManagerVersion) {
    const installHint: Record<string, string> = {
      pnpm: 'npm install -g pnpm',
      yarn: 'npm install -g yarn',
      bun: 'curl -fsSL https://bun.sh/install | bash',
      npm: 'node ships with npm — try reinstalling Node',
    };
    return [
      {
        severity: 'error',
        category: 'pm',
        priority: 2,
        message: `${pm} required (from lockfile) but not found on PATH`,
        fix: installHint[pm],
      },
    ];
  }

  return [
    {
      severity: 'ok',
      category: 'pm',
      priority: 2,
      message: `${pm} ${env.packageManagerVersion} available`,
    },
  ];
}

function checkDependencies(
  reqs: ProjectRequirements,
  env: LocalEnvironment,
): Finding[] {
  const pm = reqs.packageManager ?? 'npm';
  const installCmd = pm === 'npm' ? 'npm install' : `${pm} install`;

  if (!env.nodeModulesExists) {
    return [
      {
        severity: 'error',
        category: 'deps',
        priority: 3,
        message: 'node_modules not found — dependencies are not installed',
        fix: installCmd,
      },
    ];
  }

  if (env.lockfileNewerThanModules) {
    return [
      {
        severity: 'warn',
        category: 'deps',
        priority: 3,
        message: 'Lockfile is newer than node_modules — dependencies may be out of sync',
        fix: installCmd,
      },
    ];
  }

  return [
    {
      severity: 'ok',
      category: 'deps',
      priority: 3,
      message: 'node_modules present and up-to-date',
    },
  ];
}

function checkEnv(
  reqs: ProjectRequirements,
  env: LocalEnvironment,
): Finding[] {
  if (reqs.envExampleKeys.length === 0) {
    return []; // no .env.example — nothing to check
  }

  // .env missing entirely → single grouped error
  if (!env.envFileExists) {
    return [
      {
        severity: 'error',
        category: 'env',
        priority: 4,
        message: '.env file is missing (found .env.example with variables)',
        fix: 'cp .env.example .env',
      },
    ];
  }

  const findings: Finding[] = [];
  const envSet = new Set(env.envKeys);

  for (const key of reqs.envExampleKeys) {
    if (!envSet.has(key)) {
      findings.push({
        severity: 'error',
        category: 'env',
        priority: 4,
        message: `${key} missing from .env (present in .env.example)`,
        fix: `# Add ${key}=<value> to your .env`,
      });
    }
  }

  // Warn about extra keys in .env not in .env.example (informational only)
  const exampleSet = new Set(reqs.envExampleKeys);
  for (const key of env.envKeys) {
    if (!exampleSet.has(key)) {
      findings.push({
        severity: 'warn',
        category: 'env',
        priority: 4,
        message: `${key} is in .env but not documented in .env.example`,
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      severity: 'ok',
      category: 'env',
      priority: 4,
      message: '.env keys match .env.example',
    });
  }

  return findings;
}

function checkDocker(
  reqs: ProjectRequirements,
  env: LocalEnvironment,
): Finding[] {
  if (!reqs.dockerRequired) return [];

  if (!env.dockerCliAvailable) {
    return [
      {
        severity: 'error',
        category: 'docker',
        priority: 5,
        message: 'Docker CLI not found — project has a Dockerfile/docker-compose',
        fix: 'Install Docker Desktop from https://www.docker.com/products/docker-desktop/',
      },
    ];
  }

  if (!env.dockerDaemonRunning) {
    return [
      {
        severity: 'warn',
        category: 'docker',
        priority: 5,
        message: 'Docker CLI found but daemon is not running (docker info failed)',
        fix: 'Start Docker Desktop or run `sudo systemctl start docker`',
      },
    ];
  }

  return [
    {
      severity: 'ok',
      category: 'docker',
      priority: 5,
      message: 'Docker CLI and daemon available',
    },
  ];
}

function checkPorts(env: LocalEnvironment): Finding[] {
  return env.boundPorts.map((port) => ({
    severity: 'warn' as const,
    category: 'ports' as const,
    priority: 6,
    message: `Port ${port} is already in use`,
    fix: `lsof -ti:${port} | xargs kill -9  # free port ${port}`,
  }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function diffRequirementsVsEnvironment(
  reqs: ProjectRequirements,
  env: LocalEnvironment,
): Finding[] {
  const findings: Finding[] = [
    ...checkNode(reqs, env),
    ...checkPackageManager(reqs, env),
    ...checkDependencies(reqs, env),
    ...checkEnv(reqs, env),
    ...checkDocker(reqs, env),
    ...checkPorts(env),
  ];

  // Stable sort: by priority asc, then severity (errors before warns before ok)
  const severityOrder: Record<string, number> = { error: 0, warn: 1, ok: 2 };
  findings.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3);
  });

  return findings;
}
