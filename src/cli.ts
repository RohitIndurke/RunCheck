/**
 * cli.ts — RunCheck V1 entry point
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

// ── Legacy environment health scanners (preserved) ────────────────────────────
import { scanRequirements } from "./scanners/requirements.js";
import { scanEnvironment } from "./scanners/environment.js";
import { diffRequirementsVsEnvironment } from "./scanners/diff.js";

// ── V1 ship-readiness checks ──────────────────────────────────────────────────
import { scanTodos } from "./checks/code-quality/todo.js";
import { scanStubs } from "./checks/code-quality/stubs.js";
import { scanSwallowedErrors } from "./checks/code-quality/swallowed-errors.js";
import { scanConsoleLogs } from "./checks/code-quality/console-logs.js";
import { scanHardcodedValues } from "./checks/code-quality/hardcoded-values.js";
import { scanSecrets } from "./checks/security/secrets.js";
import { scanUnusedDeps } from "./checks/dependencies/unused-deps.js";
import { runBuildCheck } from "./checks/build/build-check.js";

// ── Reporting ─────────────────────────────────────────────────────────────────
import { renderShipReport, renderJson } from "./report/ship-report.js";
import { runFix } from "./fixers/fix.js";
import { isRemoteUrl, cloneRepository } from "./remote/git.js";
import type { ScanResult, Finding } from "./types.js";

// ─── Package version ──────────────────────────────────────────────────────────

const RC_VERSION = "1.0.0";

// ─── Progress display ─────────────────────────────────────────────────────────

function status(label: string): void {
  process.stdout.write(`  ${pc.dim("·")} ${pc.dim(label)}\n`);
}

function statusDone(label: string): void {
  // Overwrite the previous line using ANSI escape (no-op on non-TTY)
  process.stdout.write(`  ${pc.green("✓")} ${label}\n`);
}

function statusFail(label: string): void {
  process.stdout.write(`  ${pc.red("✗")} ${label}\n`);
}

// ─── Core scan orchestration ──────────────────────────────────────────────────

async function runScan(
  targetDir: string,
  opts: { verbose?: boolean; json?: boolean },
): Promise<ScanResult> {
  const startMs = Date.now();
  const allFindings: Finding[] = [];

  const quiet = !!opts.json;

  // ── 1. Environment health (legacy checks) ─────────────────────────────────
  if (!quiet) status("Checking environment");
  const reqs = scanRequirements(targetDir);
  const env = await scanEnvironment(targetDir, reqs);
  const envFindings = diffRequirementsVsEnvironment(reqs, env, {
    verbose: opts.verbose,
  });
  allFindings.push(...envFindings);
  if (!quiet) statusDone("Environment checked");

  // ── 2. Secret detection ───────────────────────────────────────────────────
  if (!quiet) status("Detecting secrets");
  const secretFindings = scanSecrets(targetDir);
  allFindings.push(...secretFindings);
  if (!quiet) {
    if (secretFindings.some((f) => f.severity === "error")) {
      statusFail("Secrets detected");
    } else {
      statusDone("Secrets scan complete");
    }
  }

  // ── 3. Code quality checks (run in parallel) ──────────────────────────────
  if (!quiet) status("Analyzing code quality");
  const [todos, stubs, swallowed, consoleLogs, hardcoded] = await Promise.all([
    Promise.resolve(scanTodos(targetDir)),
    Promise.resolve(scanStubs(targetDir)),
    Promise.resolve(scanSwallowedErrors(targetDir)),
    Promise.resolve(scanConsoleLogs(targetDir)),
    Promise.resolve(scanHardcodedValues(targetDir)),
  ]);
  allFindings.push(
    ...todos,
    ...stubs,
    ...swallowed,
    ...consoleLogs,
    ...hardcoded,
  );
  if (!quiet) statusDone("Code quality analyzed");

  // ── 4. Dependency analysis ────────────────────────────────────────────────
  if (!quiet) status("Checking dependencies");
  const depFindings = scanUnusedDeps(targetDir);
  allFindings.push(...depFindings);
  if (!quiet) statusDone("Dependencies checked");

  // ── 5. Build verification ─────────────────────────────────────────────────
  if (!quiet) status("Verifying build");
  const buildResult = await runBuildCheck(targetDir);
  if (!quiet) {
    if (!buildResult.passed) {
      statusFail("Build failed");
    } else {
      statusDone("Build verified");
    }
  }

  const durationMs = Date.now() - startMs;
  const projectName = path.basename(targetDir);

  return {
    targetDir,
    projectName,
    findings: allFindings,
    scannedAt: new Date().toISOString(),
    durationMs,
    buildResult,
  };
}

// ─── CLI definition ───────────────────────────────────────────────────────────

program
  .name("runcheck")
  .description("Pre-ship sanity check for your codebase")
  .argument("[path]", "directory to scan", ".")
  .option("--json", "output results as machine-readable JSON")
  .option("--verbose", "include requirement source in each finding message")
  .option("--fix", "attempt to auto-fix issues (stub in v1.0)")
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
      // ── --version ────────────────────────────────────────────────────────────
      if (opts.version) {
        console.log(`RunCheck v${RC_VERSION}`);
        console.log(
          `Node ${process.version}  ${process.platform}  ${process.arch}`,
        );
        process.exit(0);
      }

      // Non-TTY fallback: piped output shouldn't contain ANSI codes
      const useJson = opts.json || !process.stdout.isTTY;

      // ── Remote URL handling ──────────────────────────────────────────────────
      if (isRemoteUrl(targetArg)) {
        if (!useJson) {
          console.log("");
          console.log(`${pc.bold("◈ RunCheck")}`);
          console.log(pc.dim("Pre-ship sanity check"));
          console.log("");
          console.log(pc.dim(`Cloning ${targetArg}…`));
        }

        let cleanup: (() => void) | undefined;
        try {
          const cloneResult = await cloneRepository(targetArg);
          cleanup = cloneResult.cleanup;
          const targetDir = cloneResult.cloneDir;

          if (!useJson) {
            console.log("");
            console.log(pc.dim(`Scanning ${targetArg}`));
            console.log("");
          }

          const result = await runScan(targetDir, {
            verbose: opts.verbose,
            json: useJson,
          });
          // Use the original URL as the display name for remote scans
          result.projectName = targetArg.replace(/^https?:\/\//, "");
          result.targetDir = targetArg;

          if (!useJson) console.log("");
          if (useJson) {
            console.log(renderJson(result));
          } else {
            process.stdout.write(renderShipReport(result));
            if (opts.fix) runFix();
          }

          cleanup();

          const hasErrors =
            result.findings.some((f) => f.severity === "error") ||
            (result.buildResult && !result.buildResult.passed);
          if (hasErrors) process.exit(1);
        } catch (err) {
          cleanup?.();
          console.error(
            pc.red(err instanceof Error ? err.message : String(err)),
          );
          process.exit(2);
        }
        return;
      }

      // ── Local path handling ──────────────────────────────────────────────────
      const targetDir = path.resolve(process.cwd(), targetArg);

      if (!useJson) {
        console.log("");
        console.log(`${pc.bold("◈ RunCheck")}`);
        console.log(pc.dim("Pre-ship sanity check"));
        console.log("");
        console.log(pc.dim(`Scanning ${targetDir}`));
        console.log("");
      }

      try {
        const result = await runScan(targetDir, {
          verbose: opts.verbose,
          json: useJson,
        });

        if (!useJson) console.log("");
        if (useJson) {
          console.log(renderJson(result));
          // Bug fix: exit 1 on critical issues even in JSON mode
          const hasJsonErrors =
            result.findings.some((f) => f.severity === "error") ||
            (result.buildResult && !result.buildResult.passed);
          if (hasJsonErrors) process.exit(1);
          return;
        }

        process.stdout.write(renderShipReport(result));

        if (opts.fix) runFix();

        const hasErrors =
          result.findings.some((f) => f.severity === "error") ||
          (result.buildResult && !result.buildResult.passed);
        if (hasErrors) process.exit(1);
      } catch (err) {
        console.error(pc.red("RunCheck encountered an unexpected error:"));
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(2);
      }
    },
  );

program.parse();
