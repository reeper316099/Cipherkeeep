import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs without types
import { findViolations } from './check-public-repo.mjs';

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
