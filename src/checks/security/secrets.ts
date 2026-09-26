/**
 * checks/security/secrets.ts
 *
 * Detects secrets / API keys / credentials accidentally left in source code.
 *
 * Design principles:
 *  - Never print the full secret value — always redact
 *  - Prefer precision over recall (high-confidence patterns only)
 *  - Each pattern has a name, regex, and redaction strategy
 *  - Skip .env files (they are expected to have secrets and are
 *    covered by a separate .gitignore check)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from '../../types.js';
import { walkSourceFiles } from '../utils.js';

// ─── Secret patterns ──────────────────────────────────────────────────────────

interface SecretPattern {
  name: string;
  // Regex that captures the secret value in group 1
  re: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: 'OpenAI API key',
    re: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})/,
  },
  {
    name: 'AWS Access Key ID',
    re: /\b(AKIA[0-9A-Z]{16})\b/,
  },
  {
    name: 'AWS Secret Access Key',
    re: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*['"`]?([A-Za-z0-9/+=]{40})['"`]?/i,
  },
  {
    name: 'GitHub Personal Access Token',
    re: /\b(gh[pousr]_[A-Za-z0-9_]{36,})/,
  },
  {
    name: 'Stripe secret key',
    re: /\b(sk_(?:live|test)_[A-Za-z0-9]{24,})/,
  },
  {
    name: 'Stripe publishable key',
    re: /\b(pk_(?:live|test)_[A-Za-z0-9]{24,})/,
  },
  {
    name: 'Slack bot/app token',
    re: /\b(xox[baprs]-[A-Za-z0-9-]{10,})/,
  },
  {
    name: 'Google API key',
    re: /\b(AIza[0-9A-Za-z_-]{35})\b/,
  },
  {
    name: 'Private key (PEM)',
    re: /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/,
  },
  {
    name: 'Generic high-entropy token',
    // Long base64/hex secrets assigned to key-like variable names
    re: /(?:api_?key|secret|token|password|passwd|auth)\s*[:=]\s*['"`]([A-Za-z0-9_/+=]{32,})['"`]/i,
  },
  {
    name: 'JWT token',
    re: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/,
  },
];

const MAX_FINDINGS = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Redact the secret: show first 4 chars, then bullets.
 * Never expose more than 4 characters.
 */
function redact(value: string): string {
  if (value.length <= 8) return '••••••••';
  return value.slice(0, 4) + '•'.repeat(Math.min(16, value.length - 4));
}

/** Files where secrets are expected and should not be flagged */
function isExpectedSecretFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return (
    base === '.env' ||
    base.startsWith('.env.') ||
    base === '.envrc' ||
    base === 'secrets.ts.example' ||
    base.endsWith('.example') ||
    base.endsWith('.sample') ||
    base.includes('test') ||
    base.includes('spec') ||
    base.includes('fixture') ||
    base.includes('mock')
  );
}

/** Lines that are clearly test/example values */
function isExampleValue(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes('your-') ||
    lower.includes('your_') ||
    lower.includes('example') ||
    lower.includes('placeholder') ||
    lower.includes('replace_me') ||
    lower.includes('changeme') ||
    lower === 'xxxxxxxxxxxxxxxxxxxx' ||
    /^[*x]+$/i.test(value) ||
    /^[A-Z_]+$/.test(value) // looks like a variable name
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function scanSecrets(targetDir: string): Finding[] {
  const findings: Finding[] = [];

  for (const filePath of walkSourceFiles(targetDir)) {
    if (findings.length >= MAX_FINDINGS) break;
    if (isExpectedSecretFile(filePath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const rel = path.relative(targetDir, filePath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (findings.length >= MAX_FINDINGS) break;
      const line = lines[i]!;

      // Skip comment-only lines (they often contain examples)
      if (/^\s*(\/\/|#|\/\*|\*)/.test(line)) continue;

      for (const pattern of SECRET_PATTERNS) {
        pattern.re.lastIndex = 0;
        const match = pattern.re.exec(line);
        if (!match) continue;

        const rawValue = match[1] ?? '';
        if (!rawValue || isExampleValue(rawValue)) continue;

        findings.push({
          severity: 'error',
          category: 'security',
          rule: 'secret',
          priority: 10, // Always highest priority
          message: `Possible ${pattern.name} detected`,
          file: rel,
          line: i + 1,
          confidence: 'high',
          value: redact(rawValue),
          suggestion: 'Move to an environment variable and rotate the key',
        });

        break; // one finding per line per file
      }
    }
  }

  // Also check for .env files that might be committed (not in .gitignore)
  const envPath = path.join(targetDir, '.env');
  if (fs.existsSync(envPath)) {
    const gitignorePath = path.join(targetDir, '.gitignore');
    const gitignore = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, 'utf8')
      : '';

    // Basic check: is .env in gitignore?
    const envIgnored =
      /^\.env$/m.test(gitignore) || /^\.env\b/m.test(gitignore);

    if (!envIgnored) {
      findings.unshift({
        severity: 'error',
        category: 'security',
        rule: 'env-exposed',
        priority: 9,
        message: '.env file is not in .gitignore — secrets may be committed',
        file: '.env',
        confidence: 'high',
        suggestion: 'Add .env to .gitignore immediately',
      });
    }
  }

  return findings;
}
