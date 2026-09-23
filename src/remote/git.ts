/**
 * remote/git.ts
 *
 * Utilities for handling remote Git repository URLs.
 *
 * Responsibilities:
 *   - Detect whether a CLI argument is a remote Git URL
 *   - Clone a remote repository into a temporary directory
 *   - Provide a cleanup function to remove the temp directory
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';

// ─── URL detection ────────────────────────────────────────────────────────────

/**
 * Returns true if the argument looks like a remote Git repository URL.
 * Matches https:// and git:// URLs, as well as .git suffixes.
 *
 * Examples that return true:
 *   https://github.com/user/repo
 *   https://github.com/user/repo.git
 *   git://github.com/user/repo.git
 *
 * Examples that return false:
 *   .
 *   ./my-project
 *   C:\Projects\my-project
 */
export function isRemoteUrl(arg: string): boolean {
  return /^https?:\/\/|^git:\/\//.test(arg);
}

// ─── Clone ────────────────────────────────────────────────────────────────────

export interface CloneResult {
  /** Absolute path to the cloned repository on disk */
  cloneDir: string;
  /** Remove the temporary directory. Safe to call multiple times. */
  cleanup: () => void;
}

/**
 * Clones a remote repository into a fresh temporary directory.
 *
 * Throws a descriptive Error (not a raw stack trace) on any failure:
 *   - git not installed
 *   - network failure
 *   - repository does not exist / private repo without auth
 *   - any other clone error
 */
export async function cloneRepository(url: string): Promise<CloneResult> {
  // Verify git is available before attempting anything else
  try {
    await execa('git', ['--version'], { reject: true });
  } catch {
    throw new Error(
      'git is not installed or not on PATH.\n→ fix: Install Git from https://git-scm.com/downloads',
    );
  }

  // Create a temp directory under the OS temp root (not inside the RunCheck dir)
  const tmpBase = os.tmpdir();
  const cloneDir = fs.mkdtempSync(path.join(tmpBase, 'runcheck-'));

  const cleanup = (): void => {
    try {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup — do not throw from here
    }
  };

  try {
    await execa('git', ['clone', '--depth', '1', '--', url, cloneDir], {
      reject: true,
      // Capture stderr so we can surface a clean message on failure
      all: true,
    });
  } catch (err) {
    // Always clean up the (possibly partial) clone directory
    cleanup();

    // Surface a clean, user-facing message
    const detail =
      err instanceof Error && (err as NodeJS.ErrnoException & { all?: string }).all
        ? `\n  ${((err as NodeJS.ErrnoException & { all?: string }).all ?? '').split('\n').filter(Boolean).slice(-3).join('\n  ')}`
        : '';

    throw new Error(
      `Unable to clone repository: ${url}${detail}\n→ fix: Make sure the repository is public or configure Git authentication.`,
    );
  }

  return { cloneDir, cleanup };
}
