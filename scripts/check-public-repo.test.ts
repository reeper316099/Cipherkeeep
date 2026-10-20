import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs without types
import { findSecrets, findViolations } from './check-public-repo.mjs';

describe('public-repo guard', () => {
  it('flags private fixtures, stray csv/zip and Notion-id pages', () => {
    const v: string[] = findViolations([
      'private-fixtures/x.txt',
      'data/export.csv',
      'docs/ls 32df3e3018aa80d89e90dddec81b898b.md',
      'backup.zip',
    ]);
    expect(v).toHaveLength(4);
  });

  it('allows synthetic fixtures, starter pack and normal files', () => {
    expect(
      findViolations([
        'fixtures/synthetic/commands.csv',
        'fixtures/synthetic/ls 0123456789abcdef0123456789abcdef.md',
        'starter-pack/commands/ls.md',
        'README.md',
        'packages/shared/src/index.ts',
      ]),
    ).toEqual([]);
  });
});

describe('secret scan', () => {
  // Built at runtime so this file never contains anything that looks like a credential.
  const fakes = {
    aws: 'AKIA' + 'A'.repeat(16),
    github: 'ghp_' + 'a'.repeat(36),
    notion: 'ntn_' + 'B'.repeat(40),
    sk: 'sk-' + 'c'.repeat(32),
    pem:
      '-----BEGIN RSA PRIVATE KEY-----\n' + 'MIIE'.repeat(30) + '\n-----END RSA PRIVATE KEY-----',
  };

  it('flags credentials by shape', () => {
    for (const [name, value] of Object.entries(fakes))
      expect(findSecrets('x.ts', `const k = "${value}"`), name).toHaveLength(1);
  });

  it('ignores placeholders and short fake test strings', () => {
    expect(findSecrets('x.ts', 'token: ntn_FAKE_test_token_0123456789abcdef')).toEqual([]);
    expect(findSecrets('x.ts', '-----BEGIN RSA PRIVATE KEY-----\nabc\n')).toEqual([]);
    expect(findSecrets('x.md', 'Set CIPHERKEEP_TOKEN to any long random string')).toEqual([]);
  });
});
