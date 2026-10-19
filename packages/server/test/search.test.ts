import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { SearchIndex, parseQuery, tokenize } from '../src/search.ts';
import type { Entity, Repo, RepoEvents } from '../src/repo.ts';

describe('tokenize', () => {
  it('keeps leading dashes and emits useful sub-tokens', () => {
    expect(tokenize('-la')).toEqual(expect.arrayContaining(['-la', 'la']));
    expect(tokenize('--color=auto')).toEqual(
      expect.arrayContaining(['--color=auto', '--color', 'color', 'auto']),
    );
    expect(tokenize('/etc/passwd')).toEqual(expect.arrayContaining(['etc', 'passwd']));
    expect(tokenize('[[:upper:]]*')).toContain('upper');
  });
});

describe('parseQuery', () => {
  it('extracts operators, quoted values and free text', () => {
    const { text, filters } = parseQuery('cmd:ls tag:Linux cat:"File System" status:done find me');
    expect(text).toBe('ls find me');
    expect(filters).toMatchObject({
      types: ['commands'],
      tags: ['linux'],
      cats: ['file system'],
      statuses: ['done'],
    });
  });
});

function stubRepo(entities: Entity[]): Repo {
  const r = new EventEmitter<RepoEvents>() as unknown as Repo & { name: 'commands' };
  Object.assign(r, {
    name: 'commands',
    all: () => entities,
    get: (id: string) => entities.find((e) => e.id === id),
  });
  return r;
}

describe('SearchIndex performance', () => {
  it('answers prefix queries over 5k commands in well under 50ms', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const ents = Array.from({ length: 5000 }, (_, i) => ({
      id: `id${i}`,
      title: `cmd${i}`,
      name: `cmd${i}`,
      slug: `cmd${i}`,
      category: 'General',
      tags: ['t'],
      createdAt: now,
      updatedAt: now,
      favorite: false,
      archived: false,
      links: [],
      extras: {},
      whatItDoes: `does thing number ${i}`,
      options: [{ flag: '-x', meaning: 'x' }],
      examples: [],
    })) as unknown as Entity[];
    const idx = new SearchIndex();
    idx.attach(stubRepo(ents));
    idx.search('cmd4'); // warm
    const t0 = performance.now();
    const hits = idx.search('cmd49');
    const ms = performance.now() - t0;
    expect(hits.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(50);
  });
});
