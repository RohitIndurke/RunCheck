/**
 * environment.ts
 *
 * Probes the local machine to discover what's actually available:
 * Node version, package manager presence, node_modules state,
 * .env keys, Docker availability, and port binding.
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execa } from 'execa';
import type { LocalEnvironment, ProjectRequirements } from '../types.js';
import { parseEnvKeys } from './requirements.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function getCommandVersion(cmd: string): Promise<string | null> {
  try {
    const result = await execa(cmd, ['-v'], { reject: false });
    if (result.exitCode === 0) {
      return (result.stdout || result.stderr).trim();
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Port probe ───────────────────────────────────────────────────────────────

/**
 * Returns true if the port is already bound (i.e. something is listening on it).
 * Uses a raw net.createServer probe — no external dependency needed.
 */
function isPortBound(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));   // EADDRINUSE → port is taken
    server.once('listening', () => {
      server.close(() => resolve(false));         // bound successfully → port is free
    });
    server.listen(port, '127.0.0.1');
  });
}

// ─── node_modules staleness ───────────────────────────────────────────────────

function checkNodeModules(
  targetDir: string,
  lockfilePath: string | null,
): { exists: boolean; lockfileNewer: boolean } {
  const nmPath = path.join(targetDir, 'node_modules');
  if (!fs.existsSync(nmPath)) return { exists: false, lockfileNewer: false };

  if (!lockfilePath || !fs.existsSync(lockfilePath)) {
    return { exists: true, lockfileNewer: false };
  }

  try {
    const nmStat = fs.statSync(nmPath);
    const lockStat = fs.statSync(lockfilePath);
    return {
      exists: true,
      lockfileNewer: lockStat.mtimeMs > nmStat.mtimeMs,
    };
  } catch {
    return { exists: true, lockfileNewer: false };
  }
}

// ─── Docker ───────────────────────────────────────────────────────────────────

async function probeDocker(): Promise<{ cli: boolean; daemon: boolean }> {
  const cliVersion = await getCommandVersion('docker');
  if (!cliVersion) return { cli: false, daemon: false };

  try {
    const info = await execa('docker', ['info'], { reject: false, timeout: 5000 });
    return { cli: true, daemon: info.exitCode === 0 };
  } catch {
    return { cli: true, daemon: false };
  }
}

// ─── PM version ───────────────────────────────────────────────────────────────

async function getPmVersion(
  pm: ProjectRequirements['packageManager'],
): Promise<string | null> {
  if (!pm) return null;
  return getCommandVersion(pm);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function scanEnvironment(
  targetDir: string,
  reqs: ProjectRequirements,
): Promise<LocalEnvironment> {
  // Run independent probes concurrently
  const [pmVersion, dockerProbe, ...portResults] = await Promise.all([
    getPmVersion(reqs.packageManager),
    probeDocker(),
    ...reqs.requiredPorts.map(isPortBound),
  ]);

  // node_modules staleness (sync — fast)
  const { exists: nodeModulesExists, lockfileNewer: lockfileNewerThanModules } =
    checkNodeModules(targetDir, reqs.lockfilePath);

  // .env keys (sync)
  const envPath = path.join(targetDir, '.env');
  const envRaw = readFile(envPath);
  const envFileExists = envRaw !== null;
  const envKeys = envRaw ? parseEnvKeys(envRaw) : [];

  // Bound ports
  const boundPorts = reqs.requiredPorts.filter((_, i) => portResults[i] === true);

  return {
    nodeVersion: process.version,
    packageManagerVersion: pmVersion ?? null,
    nodeModulesExists,
    lockfileNewerThanModules,
    envKeys,
    envFileExists,
    dockerCliAvailable: dockerProbe.cli,
    dockerDaemonRunning: dockerProbe.daemon,
    boundPorts,
  };
}
