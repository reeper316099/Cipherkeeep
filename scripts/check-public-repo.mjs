#!/usr/bin/env node
// Public-repo guard: fail if files that look like a personal Notion export are tracked/staged.
// Usage: node scripts/check-public-repo.mjs [--staged]   (default: all tracked files)
import { execFileSync } from 'node:child_process';

const ALLOWED_PREFIXES = ['fixtures/synthetic/', 'starter-pack/'];
const NOTION_ID = /[0-9a-f]{32}(_all)?\.(md|csv)$/i;

/** Returns a list of human-readable violations for the given repo-relative paths. */
export function findViolations(paths) {
  const out = [];
  for (const p of paths) {
    const norm = p.replace(/\\/g, '/');
    if (ALLOWED_PREFIXES.some((a) => norm.startsWith(a))) continue;
    if (norm.startsWith('private-fixtures/'))
      out.push(`${norm}: private-fixtures must never be committed`);
    else if (/\.(zip|csv)$/i.test(norm))
      out.push(`${norm}: .zip/.csv only allowed in fixtures/synthetic or starter-pack`);
    else if (NOTION_ID.test(norm))
      out.push(`${norm}: looks like a Notion export page (32-hex id suffix)`);
  }
  return out;
}

function main() {
  const staged = process.argv.includes('--staged');
  const args = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files'];
  const files = execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
  const violations = findViolations(files);
  if (violations.length) {
    console.error('Public-repo guard failed:\n' + violations.map((v) => '  - ' + v).join('\n'));
    process.exit(1);
  }
  console.log(`Public-repo guard OK (${files.length} files checked).`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
