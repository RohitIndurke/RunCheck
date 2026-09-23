/**
 * cli.ts — RunCheck entry point
 *
 * Usage:
 *   npx runcheck              # scan current directory
 *   npx runcheck ./path       # scan a given path
 *   npx runcheck https://github.com/user/repo  # scan a GitHub repository
 *   npx runcheck --json       # machine-readable JSON output
 *   npx runcheck --verbose    # include requirement sources in output
 *   npx runcheck --fix        # (stub) not yet implemented
 */

import path from "node:path";
import { program } from "commander";
import pc from "picocolors";
import { scanRequirements } from "./scanners/requirements.js";
import { scanEnvironment } from "./scanners/environment.js";
import { diffRequirementsVsEnvironment } from "./scanners/diff.js";
import { renderTable, renderJson } from "./report/format.js";
import { runFix } from "./fixers/fix.js";
import { isRemoteUrl, cloneRepository } from "./remote/git.js";
import type { ScanResult } from "./types.js";

// ─── Package version ──────────────────────────────────────────────────────────

// Kept in sync with package.json — update both together on releases.
const RC_VERSION = "0.1.1";

// ─── CLI definition ───────────────────────────────────────────────────────────

program
  .name("runcheck")
  .description(
    "CLI doctor for Node.js projects — spot root-cause blockers before you hit them",
  )
  .argument("[path]", "directory to scan", ".")
  .option("--json", "output results as machine-readable JSON")
  .option("--verbose", "include requirement source in each finding message")
  .option("--fix", "attempt to auto-fix issues (stub in v0.1)")
  // Override --version to include runtime info for bug reports
  .option("-V, --version", "print RunCheck version and runtime info")
  .action(
    async (
      targetArg: string,
      opts: {
        json?: boolean;
        verbose?: boolean;
        fix?: boolean;
        version?: boolean;
      },
    ) => {
      // ── --version ──────────────────────────────────────────────────────────────
      if (opts.version) {
        console.log(`RunCheck v${RC_VERSION}`);
        console.log(
          `Node ${process.version}  ${process.platform}  ${process.arch}`,
        );
        process.exit(0);
      }

      // Non-TTY fallback: piped output shouldn't contain ANSI/box-drawing codes
      const useJson = opts.json || !process.stdout.isTTY;

      // ── Remote URL handling ────────────────────────────────────────────────────
      if (isRemoteUrl(targetArg)) {
        if (!useJson) {
          process.stdout.write(pc.dim("Scanning repository…\n"));
        }

        let cleanup: (() => void) | undefined;
        try {
          const cloneResult = await cloneRepository(targetArg);
          cleanup = cloneResult.cleanup;
          const targetDir = cloneResult.cloneDir;

          const reqs = scanRequirements(targetDir);
          const env = await scanEnvironment(targetDir, reqs);
          const findings = diffRequirementsVsEnvironment(reqs, env, {
            verbose: opts.verbose,
          });

          // Show the original URL in the banner, not the opaque temp path
          const result: ScanResult = {
            targetDir: targetArg,
            findings,
            scannedAt: new Date().toISOString(),
          };

          if (useJson) {
            console.log(renderJson(result));
          } else {
            process.stdout.write(renderTable(result));
            if (opts.fix) runFix();
          }

          cleanup();

          const hasErrors = findings.some((f) => f.severity === "error");
          if (hasErrors) process.exit(1);
        } catch (err) {
          cleanup?.();
          // Clone errors already have a user-friendly message from git.ts
          console.error(pc.red(err instanceof Error ? err.message : String(err)));
          process.exit(2);
        }
        return;
      }

      // ── Local path handling (unchanged) ───────────────────────────────────────
      const targetDir = path.resolve(process.cwd(), targetArg);

      if (!useJson) {
        process.stdout.write(pc.dim("Scanning…\n"));
      }

      try {
        // 1. Read project requirements
        const reqs = scanRequirements(targetDir);

        // 2. Probe local environment
        const env = await scanEnvironment(targetDir, reqs);

        // 3. Diff → ranked findings
        const findings = diffRequirementsVsEnvironment(reqs, env, {
          verbose: opts.verbose,
        });

        const result: ScanResult = {
          targetDir,
          findings,
          scannedAt: new Date().toISOString(),
        };

        // 4. Render
        if (useJson) {
          console.log(renderJson(result));
          return;
        }

        process.stdout.write(renderTable(result));

        // 5. --fix stub
        if (opts.fix) {
          runFix();
        }

        // Exit with code 1 if any errors found
        const hasErrors = findings.some((f) => f.severity === "error");
        if (hasErrors) process.exit(1);
      } catch (err) {
        console.error(pc.red("RunCheck encountered an unexpected error:"));
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(2);
      }
    },
  );

program.parse();
