import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  buildTitleIndex,
  extractWikiLinks,
  resolveWikiLink,
  tokenizeCommand,
  type CollectionName,
} from '@cipherkeep/shared';
import { inputSchemas } from '../src/repo.ts';
import { planStarter, starterCounts } from '../src/starter.ts';
import { harness, type Harness, type Json } from './helpers.ts';

const plan = planStarter();
const by = (c: CollectionName) => plan.items.filter((i) => i.collection === c);

describe('starter pack content', () => {
  it('has the promised amount of content', () => {
    expect(starterCounts()).toEqual({ commands: 45, concepts: 10, notes: 4, labs: 3 });
    expect(plan.items).toHaveLength(62);
  });

  it('every entry is valid for the app’s own schemas and has a stable import reference', () => {
    const refs = new Set<string>();
    for (const it of plan.items) {
      expect(
        () => inputSchemas(it.collection).create.parse(it.input),
        `${it.collection}:${it.title}`,
      ).not.toThrow();
      expect(it.ref.startsWith('starter:')).toBe(true);
      expect(refs.has(it.ref), `duplicate ref ${it.ref}`).toBe(false);
      refs.add(it.ref);
      expect((it.input.tags as string[]).includes('starter')).toBe(true);
    }
  });

  describe('commands', () => {
    const cmds = by('commands').map((i) => i.input as Json);
    it('are unique, complete, and only rm is flagged destructive', () => {
      expect(new Set(cmds.map((c) => c.name)).size).toBe(cmds.length);
      for (const c of cmds) {
        expect(c.syntax.trim(), c.name).not.toBe('');
        expect(c.explanation.trim().length, c.name).toBeGreaterThan(5);
        expect(c.whatItDoes.trim().length, c.name).toBeGreaterThan(20);
        expect(c.examples.length, c.name).toBeGreaterThanOrEqual(2);
        expect(
          c.examples.every((e: Json) => e.description.trim().length > 4),
          `${c.name} example descriptions`,
        ).toBe(true);
        expect(c.options.length, c.name).toBeGreaterThanOrEqual(2);
        expect(['safe', 'caution', 'destructive']).toContain(c.risk);
      }
      expect(cmds.filter((c) => c.risk === 'destructive').map((c) => c.name)).toEqual(['rm']);
      for (const name of ['chmod', 'chown', 'nmap', 'sudo', 'find', 'kill', 'tcpdump'])
        expect(cmds.find((c) => c.name === name)!.risk, name).toBe('caution');
    });

    it('cover the promised categories, each example mentions its command, and risky tools carry a warning note', () => {
      const cats = new Set(cmds.map((c) => c.category));
      for (const c of ['File System', 'Text Processing', 'Permissions', 'Networking', 'General'])
        expect(cats.has(c), c).toBe(true);
      for (const c of cmds)
        for (const e of c.examples)
          expect(
            new RegExp(`(^|[\\s|;(])${c.name}(\\s|$)`).test(e.command),
            `${c.name}: ${e.command}`,
          ).toBe(true);
      for (const name of ['rm', 'nmap', 'tcpdump'])
        expect(cmds.find((c) => c.name === name)!.notes.length, name).toBeGreaterThan(30);
      expect(cmds.find((c) => c.name === 'nmap')!.notes).toMatch(/permission|authori[sz]ed|own/i);
    });

    it('uses documentation-reserved or private addresses and no real hosts in examples', () => {
      const ok =
        /^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|1\.1\.1\.1$|8\.8\.8\.8$|0\.0\.0\.0$)/;
      for (const c of cmds) {
        for (const e of c.examples) {
          for (const ip of e.command.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [])
            expect(ok.test(ip), `${c.name}: ${e.command}`).toBe(true);
          for (const host of e.command.match(/https?:\/\/([a-z0-9.-]+)/gi) ?? [])
            expect(/(example\.(com|test)|\.test|localhost)/i.test(host), `${c.name}: ${host}`).toBe(
              true,
            );
        }
      }
    });

    it.skipIf(process.platform === 'win32')(
      'every example is valid shell syntax (checked with bash -n, nothing is executed)',
      () => {
        for (const c of cmds) {
          for (const e of c.examples) {
            const runnable = (e.command as string).replace(
              /<[^>]+>|\[[A-Za-z][\w -]*\]|\{[A-Za-z_][\w-]*\}/g,
              'x',
            );
            const r = spawnSync('bash', ['-n', '-c', runnable], { encoding: 'utf8' });
            expect(r.status, `${c.name}: ${e.command}\n${r.stderr}`).toBe(0);
          }
        }
      },
    );

    it('flag rows that look like flags start with a dash and have a meaning', () => {
      for (const c of cmds) {
        for (const o of c.options) {
          expect(o.flag.trim(), c.name).not.toBe('');
          expect(o.meaning.trim().length, `${c.name} ${o.flag}`).toBeGreaterThan(3);
        }
        expect(tokenizeCommand(c.syntax)[0], c.name).toBe(c.name);
      }
    });
  });

  describe('concepts, notes, labs', () => {
    const titles = buildTitleIndex(
      plan.items.map((i) => ({
        type: i.collection,
        id: i.ref,
        title: i.title,
        name: i.collection === 'commands' ? i.title : undefined,
      })),
    );
    it('concepts follow the 13-section template in order, all filled in', () => {
      const keys = [
        'what-is-it',
        'how-it-works-step-by-step',
        'key-components',
        'example-walkthrough',
        'why-it-matters',
        'security-relevance',
        'tools-commands-related',
        'related-concepts',
        'common-mistakes-misconceptions',
        'intuition-very-important',
        'source-where-i-learned-this',
        'difficulty-level',
        'questions-i-still-have',
      ];
      for (const it of by('concepts')) {
        const secs = it.input.sections as { key: string; markdown: string }[];
        expect(
          secs.map((s) => s.key),
          it.title,
        ).toEqual(keys);
        for (const s of secs)
          expect(
            s.markdown.replace(/^\s*[-*+]\s*$/gm, '').trim().length,
            `${it.title}/${s.key}`,
          ).toBeGreaterThan(3);
        expect(['Easy', 'Medium', 'Hard']).toContain(it.input.difficulty);
        expect(it.input.questionsOpen, it.title).toBeGreaterThanOrEqual(1);
      }
    });
    it('every relation points at something in the pack', () => {
      for (const it of plan.items) {
        for (const r of it.relations)
          expect(r.targets.length, `${it.title} ${r.field}`).toBeGreaterThan(0);
      }
      const k = by('concepts').find((c) => c.title === 'File Permissions')!;
      expect(k.relations.find((r) => r.field === 'relatedCommandIds')!.targets).toHaveLength(5);
    });
    it('notes contain no raw HTML and all their [[wiki links]] resolve', () => {
      for (const n of by('notes')) {
        const md = n.input.markdown as string;
        expect(md, n.title).not.toMatch(/<\s*(script|iframe|img|a)\b/i);
        for (const w of extractWikiLinks(md))
          expect(resolveWikiLink(titles, w), `${n.title}: ${w.raw}`).toBeDefined();
      }
    });
    it('labs are practice exercises (not started, private by default) that reference real commands', () => {
      expect(by('labs')).toHaveLength(3);
      for (const l of by('labs')) {
        expect(l.input.status).toBe('Not Started');
        expect(l.relations.find((r) => r.field === 'commandIds')!.targets.length).toBeGreaterThan(
          0,
        );
        expect(l.input.writeup as string).toContain('## 🎯 Goal');
      }
    });
  });
});

describe('loading the starter pack', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(() => h.stop());

  it('reports what it contains before loading', async () => {
    expect((await h.req('GET', '/starter-pack')).json).toEqual({
      license: 'MIT',
      counts: { commands: 45, concepts: 10, notes: 4, labs: 3 },
      loaded: 0,
    });
  });

  it('loads everything with relations, makes it searchable, and is idempotent', async () => {
    const r = (await h.req('POST', '/starter-pack/load', {})).json;
    expect(r.created).toEqual({ commands: 45, concepts: 10, notes: 4, labs: 3 });
    expect((await h.req('GET', '/starter-pack')).json.loaded).toBe(62);
    const perms = ((await h.req('GET', '/concepts?limit=50')).json.items as Json[]).find(
      (c) => c.title === 'File Permissions',
    )!;
    const names = await Promise.all(
      (perms.relatedCommandIds as string[]).map(
        async (id) => (await h.req('GET', `/commands/${id}`)).json.name,
      ),
    );
    expect(names.sort()).toEqual(['chmod', 'chown', 'id', 'ls', 'sudo']);
    expect((await h.req('GET', '/search?q=grep&type=commands')).json.hits[0].title).toBe('grep');
    expect(
      (await h.req('GET', '/search?q=' + encodeURIComponent('-la'))).json.hits.some(
        (x: Json) => x.title === 'ls',
      ),
    ).toBe(true);
    const ln = ((await h.req('GET', '/notes?limit=50')).json.items as Json[])
      .map((n) => n.folder)
      .sort();
    expect(ln).toEqual([
      'starter-pack/cheat-sheets',
      'starter-pack/cheat-sheets',
      'starter-pack/guides',
      'starter-pack/guides',
    ]);
    const again = (await h.req('POST', '/starter-pack/load', {})).json;
    expect(again.created).toEqual({});
    expect(again.updated).toEqual({});
    expect((await h.req('GET', '/meta')).json.counts).toMatchObject({
      commands: 45,
      concepts: 10,
      notes: 4,
      labs: 3,
    });
  });

  it('never overwrites your edits, can be undone, and merges with commands you already have', async () => {
    const ls = ((await h.req('GET', '/commands?limit=100')).json.items as Json[]).find(
      (c) => c.name === 'ls',
    )!;
    await h.req('PATCH', `/commands/${ls.id}`, { explanation: 'my own words' });
    await h.req('POST', '/starter-pack/load', {});
    expect((await h.req('GET', `/commands/${ls.id}`)).json.explanation).toBe('my own words');
    const rep = (await h.req('GET', '/imports')).json as Json[];
    for (const r of rep) await h.req('POST', `/import/undo/${r.id}`);
    expect((await h.req('GET', '/meta')).json.counts).toMatchObject({
      concepts: 0,
      notes: 0,
      labs: 0,
    });

    // user already has their own `ls` with an empty example list: starter fills empty fields only
    const mine = (
      await h.req('POST', '/commands', { name: 'ls', category: 'File System', explanation: 'mine' })
    ).json;
    const r2 = (await h.req('POST', '/starter-pack/load', {})).json;
    expect(r2.created.commands).toBe(44);
    expect(r2.updated.commands).toBe(1);
    const merged = (await h.req('GET', `/commands/${mine.id}`)).json;
    expect(merged.explanation).toBe('mine');
    expect(merged.examples.length).toBeGreaterThan(0);
  });

  it('requires the token', async () => {
    expect((await h.req('GET', '/starter-pack', undefined, null)).status).toBe(401);
    expect((await h.req('POST', '/starter-pack/load', {}, null)).status).toBe(401);
  });
});
