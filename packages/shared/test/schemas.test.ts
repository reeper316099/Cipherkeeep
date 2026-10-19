import { describe, expect, it } from 'vitest';
import { APP_NAME, COLLECTIONS, SCHEMAS, CommandSchema } from '../src/index.ts';

const base = {
  id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
  title: 'ls',
  slug: 'ls',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('shared', () => {
  it('exposes a single APP_NAME', () => {
    expect(APP_NAME).toBe('Cipherkeep');
  });

  it('has a schema for every collection', () => {
    for (const c of COLLECTIONS) expect(SCHEMAS[c]).toBeDefined();
  });

  it('applies defaults for a minimal command', () => {
    const cmd = CommandSchema.parse({ ...base, name: 'ls' });
    expect(cmd.risk).toBe('safe');
    expect(cmd.mastery).toBe(0);
    expect(cmd.options).toEqual([]);
    expect(cmd.srs.ease).toBe(2.5);
  });

  it('rejects an invalid mastery value', () => {
    expect(CommandSchema.safeParse({ ...base, name: 'ls', mastery: 7 }).success).toBe(false);
  });
});
