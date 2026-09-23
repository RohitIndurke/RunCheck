// ─── Core domain types ────────────────────────────────────────────────────────

export type Severity = 'error' | 'warn' | 'ok';

export type Category = 'node' | 'pm' | 'ambiguous-pm' | 'deps' | 'env' | 'docker' | 'ports';

/** A single diagnostic finding produced by the diff scanner. */
export interface Finding {
  /** Visual severity: error (❌), warn (⚠), ok (✓) */
  severity: Severity;
  /** Logical group — drives root-cause ranking */
  category: Category;
  /** Human-readable description of the issue */
  message: string;
  /** Optional shell command to fix this (printed, never executed in v0.1) */
  fix?: string;
  /** Lower number = shown first in output */
  priority: number;
}

/** Everything the requirements scanner extracts from a target project directory. */
export interface ProjectRequirements {
  /** Raw semver range string from engines.node or .nvmrc (e.g. ">=20") */
  nodeRange: string | null;
  /** Where nodeRange was sourced from, for --verbose output */
  nodeRangeSource: string | null;
  /** Which package manager the lockfile implies */
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | null;
  /** Absolute path to the lockfile, or null */
  lockfilePath: string | null;
  /**
   * All lockfile paths found (> 1 means ambiguous PM situation).
   * First entry is the one used for the rest of the scan.
   */
  ambiguousLockfiles: string[];
  /** Keys present in .env.example (values are intentionally ignored) */
  envExampleKeys: string[];
  /** True if a Dockerfile or docker-compose file was detected */
  dockerRequired: boolean;
  /** Port numbers parsed from package.json scripts */
  requiredPorts: number[];
  /** Absolute path to package.json, or null if not found */
  packageJsonPath: string | null;
  /** True if monorepo markers were detected (workspaces, pnpm-workspace.yaml, turbo.json, nx.json) */
  isMonorepo: boolean;
  /** semver range from engines.pnpm / engines.npm / engines.yarn if present */
  pmEngineRange: string | null;
}

/** Everything the environment scanner probes from the local machine. */
export interface LocalEnvironment {
  /** Installed Node version string, e.g. "v20.14.0" */
  nodeVersion: string;
  /** Installed package manager version, or null if not found */
  packageManagerVersion: string | null;
  /** Whether node_modules directory exists in the target dir */
  nodeModulesExists: boolean;
  /**
   * True if the lockfile mtime is newer than node_modules mtime
   * (suggesting `install` hasn't been run since the lockfile changed).
   */
  lockfileNewerThanModules: boolean;
  /** Keys present in .env file (values are intentionally ignored) */
  envKeys: string[];
  /** True if `.env` file exists at all */
  envFileExists: boolean;
  /** True if `docker -v` succeeded */
  dockerCliAvailable: boolean;
  /** True if `docker info` succeeded (daemon running) */
  dockerDaemonRunning: boolean;
  /** Port numbers that are currently bound on the local machine */
  boundPorts: number[];
}

/** Top-level result passed to the formatter. */
export interface ScanResult {
  targetDir: string;
  findings: Finding[];
  scannedAt: string;
}
