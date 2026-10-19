export interface SanitizeResult {
  text: string;
  redactions: number;
  invalidPatterns: string[];
}

interface Rule {
  re: RegExp;
  replace: string | ((...m: string[]) => string);
}

/** Built-in redactions for sharing a writeup: flags, addresses, credentials, keys. */
const DEFAULT_RULES: Rule[] = [
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: '[PRIVATE KEY REDACTED]',
  },
  { re: /\b[A-Za-z][A-Za-z0-9_]{1,24}\{[^}\s]{4,}\}/g, replace: '[FLAG REDACTED]' },
  {
    re: /\b(password|passwd|pwd|secret|token|api[_-]?key)(\s*[:=]\s*)(\S+)/gi,
    replace: (_m, k = '', sep = '') => `${k}${sep}[REDACTED]`,
  },
  { re: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/g, replace: 'Bearer [REDACTED]' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replace: '[AWS KEY REDACTED]' },
  { re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, replace: '[EMAIL]' },
  { re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, replace: '[IP]' },
];

/** Rejects patterns with an obviously catastrophic shape (nested quantifiers) or excessive length. */
export function isSafePattern(p: string): boolean {
  return p.length > 0 && p.length <= 200 && !/(\+|\*|\{\d+,?\d*\})\s*\)\s*(\+|\*|\{)/.test(p);
}

export function sanitizeWriteup(input: string, extraPatterns: string[] = []): SanitizeResult {
  let text = input;
  let redactions = 0;
  const apply = (rule: Rule) => {
    text = text.replace(rule.re, (...args: unknown[]) => {
      redactions++;
      const m = args.slice(0, -2).map(String);
      return typeof rule.replace === 'function' ? rule.replace(...m) : rule.replace;
    });
  };
  DEFAULT_RULES.forEach(apply);
  const invalidPatterns: string[] = [];
  for (const p of extraPatterns) {
    if (!isSafePattern(p)) {
      invalidPatterns.push(p);
      continue;
    }
    try {
      apply({ re: new RegExp(p, 'gi'), replace: '[REDACTED]' });
    } catch {
      invalidPatterns.push(p);
    }
  }
  return { text, redactions, invalidPatterns };
}
