/**
 * remote.test.ts
 *
 * Tests for GitHub URL detection, clone behaviour, error handling, and cleanup.
 * Uses vi.mock + vitest to avoid real network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ─── isRemoteUrl ──────────────────────────────────────────────────────────────

// Import the module under test. We import after mocking execa below for clone tests.
import { isRemoteUrl } from '../src/remote/git.js';

describe('isRemoteUrl', () => {
  it('recognises https:// GitHub URLs', () => {
    expect(isRemoteUrl('https://github.com/user/repo')).toBe(true);
  });

  it('recognises https:// .git-suffixed URLs', () => {
    expect(isRemoteUrl('https://github.com/user/repo.git')).toBe(true);
  });

  it('recognises git:// URLs', () => {
    expect(isRemoteUrl('git://github.com/user/repo.git')).toBe(true);
  });

  it('returns false for "."', () => {
    expect(isRemoteUrl('.')).toBe(false);
  });

  it('returns false for relative paths', () => {
    expect(isRemoteUrl('./my-project')).toBe(false);
  });

  it('returns false for absolute Windows paths', () => {
    expect(isRemoteUrl('C:\\Projects\\my-project')).toBe(false);
  });

  it('returns false for absolute POSIX paths', () => {
    expect(isRemoteUrl('/home/user/project')).toBe(false);
  });

  it('returns false for bare repo names', () => {
    expect(isRemoteUrl('my-project')).toBe(false);
  });
});

// ─── cloneRepository ──────────────────────────────────────────────────────────

// We mock execa so no real network calls happen.
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import { cloneRepository } from '../src/remote/git.js';

const mockExeca = vi.mocked(execa);

/** Create a tiny fake temp dir that actually exists so rmSync won't error. */
function makeFakeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'runcheck-test-'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('cloneRepository — success', () => {
  it('calls git --version then git clone with the correct args', async () => {
    // git --version succeeds
    mockExeca.mockResolvedValueOnce({ exitCode: 0 } as unknown as Awaited<ReturnType<typeof execa>>);
    // git clone succeeds
    mockExeca.mockResolvedValueOnce({ exitCode: 0 } as unknown as Awaited<ReturnType<typeof execa>>);

    const url = 'https://github.com/user/repo';
    const result = await cloneRepository(url);

    // The clone dir should exist (mkdtempSync creates it before we call execa)
    expect(result.cloneDir).toBeTruthy();
    expect(typeof result.cleanup).toBe('function');

    // Verify git args
    const cloneCall = mockExeca.mock.calls[1]!;
    expect(cloneCall[0]).toBe('git');
    expect(cloneCall[1]).toContain('clone');
    expect(cloneCall[1]).toContain(url);

    // Clean up the actual temp dir created during the test
    result.cleanup();
  });

  it('cleanup removes the temporary directory', async () => {
    mockExeca.mockResolvedValueOnce({ exitCode: 0 } as unknown as Awaited<ReturnType<typeof execa>>);
    mockExeca.mockResolvedValueOnce({ exitCode: 0 } as unknown as Awaited<ReturnType<typeof execa>>);

    const result = await cloneRepository('https://github.com/user/repo');
    const { cloneDir, cleanup } = result;

    // The dir exists before cleanup
    expect(fs.existsSync(cloneDir)).toBe(true);

    cleanup();

    // The dir is gone after cleanup
    expect(fs.existsSync(cloneDir)).toBe(false);
  });

  it('cleanup is idempotent (safe to call twice)', async () => {
    mockExeca.mockResolvedValueOnce({ exitCode: 0 } as unknown as Awaited<ReturnType<typeof execa>>);
    mockExeca.mockResolvedValueOnce({ exitCode: 0 } as unknown as Awaited<ReturnType<typeof execa>>);

    const { cleanup } = await cloneRepository('https://github.com/user/repo');
    expect(() => { cleanup(); cleanup(); }).not.toThrow();
  });

  it('returns cloneDir (temp path), not the original URL', async () => {
    mockExeca.mockResolvedValueOnce({ exitCode: 0 } as unknown as Awaited<ReturnType<typeof execa>>);
    mockExeca.mockResolvedValueOnce({ exitCode: 0 } as unknown as Awaited<ReturnType<typeof execa>>);

    const url = 'https://github.com/user/repo';
    const { cloneDir, cleanup } = await cloneRepository(url);

    expect(cloneDir).not.toBe(url);
    // cloneDir should be under the OS temp dir
    expect(cloneDir.startsWith(os.tmpdir())).toBe(true);

    cleanup();
  });
});

describe('cloneRepository — git not installed', () => {
  it('throws a user-friendly error when git is not on PATH', async () => {
    // git --version fails
    mockExeca.mockRejectedValueOnce(new Error('spawn git ENOENT'));

    await expect(cloneRepository('https://github.com/user/repo')).rejects.toThrow(
      /git is not installed/i,
    );
  });

  it('error message includes a fix hint pointing to git-scm.com', async () => {
    mockExeca.mockRejectedValueOnce(new Error('spawn git ENOENT'));

    let message = '';
    try {
      await cloneRepository('https://github.com/user/repo');
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toContain('git-scm.com');
  });
});

describe('cloneRepository — clone failure', () => {
  it('throws a user-friendly error when clone fails (e.g. private repo)', async () => {
    // git --version succeeds
    mockExeca.mockResolvedValueOnce({ exitCode: 0 } as unknown as Awaited<ReturnType<typeof execa>>);
    // git clone fails
    mockExeca.mockRejectedValueOnce(
      Object.assign(new Error('Repository not found.'), { all: 'fatal: repository not found' }),
    );

    await expect(
      cloneRepository('https://github.com/user/private-repo'),
    ).rejects.toThrow(/Unable to clone repository/i);
  });

  it('error message includes a fix hint about authentication', async () => {
    mockExeca.mockResolvedValueOnce({ exitCode: 0 } as unknown as Awaited<ReturnType<typeof execa>>);
    mockExeca.mockRejectedValueOnce(
      Object.assign(new Error('auth fail'), { all: 'fatal: Authentication failed' }),
    );

    let message = '';
    try {
      await cloneRepository('https://github.com/user/private-repo');
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toMatch(/public|authentication/i);
  });

  it('cleans up the temp directory even when clone fails', async () => {
    mockExeca.mockResolvedValueOnce({ exitCode: 0 } as unknown as Awaited<ReturnType<typeof execa>>);

    // Capture the cloneDir that was created before the clone failed
    let capturedDir: string | undefined;
    mockExeca.mockImplementationOnce(((async (_cmd: string, args: string[]) => {
      // The last arg to 'git clone ... url cloneDir' is the cloneDir
      capturedDir = args.at(-1);
      throw Object.assign(new Error('clone error'), { all: 'fatal: not found' });
    }) as unknown) as Parameters<typeof mockExeca.mockImplementationOnce>[0]);

    try {
      await cloneRepository('https://github.com/user/repo');
    } catch {
      // Expected
    }

    // The temp dir should have been cleaned up
    if (capturedDir) {
      expect(fs.existsSync(capturedDir)).toBe(false);
    }
  });
});
