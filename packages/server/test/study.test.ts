import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { harness, type Harness, type Json } from './helpers.ts';

let h: Harness;
let ls: Json;
let cp: Json;
let tree: Json;
beforeAll(async () => {
  h = await harness();
  ls = (
    await h.req('POST', '/commands', {
      name: 'ls',
      category: 'File System',
      explanation: 'list entries',
      options: [{ flag: '-a', meaning: 'include dotfiles' }],
      examples: [{ command: 'ls -al ~', description: 'long list of home' }],
    })
  ).json;
  cp = (
    await h.req('POST', '/commands', {
      name: 'cp',
      category: 'File System',
      explanation: 'copy files',
      examples: [{ command: 'cp a b', description: 'copy a to b' }],
    })
  ).json;
  tree = (
    await h.req('POST', '/concepts', {
      title: 'Directory Tree',
      category: 'Linux',
      sections: [
        { key: 'what-is-it', title: 'What is it?', markdown: 'Nested folders' },
        {
          key: 'questions-i-still-have',
          title: 'Questions',
          markdown: '- Who can read /etc?\n- [x] Where are logs?\n-\n',
        },
      ],
    })
  ).json;
  await h.req('POST', '/commands', { name: 'bare', category: 'General' }); // nothing to build a card from
});
afterAll(() => h.stop());

const queue = (q = '') => h.req('GET', `/study/queue${q}`);

describe('study queue and answers', () => {
  it('offers new cards (never reviewed) and skips entities that cannot form a card', async () => {
    const r = (await queue()).json;
    expect(r.items.map((i: Json) => i.card.title).sort()).toEqual(['Directory Tree', 'cp', 'ls']);
    expect(r.items.every((i: Json) => i.isNew)).toBe(true);
    expect(r.due).toBe(0);
    expect(r.newAvailable).toBe(3);
    const only = (await queue(`?collection=concepts`)).json.items;
    expect(only).toHaveLength(1);
    expect(only[0].card).toMatchObject({ collection: 'concepts', type: 'what', kind: 'reveal' });
  });

  it('applies SM-2, updates command mastery/practice fields, and persists state', async () => {
    const r = (
      await h.req('POST', '/study/answer', { id: ls.id, rating: 'good', cardType: 'name' })
    ).json;
    expect(r.srs).toMatchObject({ intervalDays: 1, reps: 1, ease: 2.5 });
    expect(r.mastery).toBe(1);
    const cmd = (await h.req('GET', `/commands/${ls.id}`)).json;
    expect(cmd).toMatchObject({ mastery: 1, practiceCount: 1 });
    expect(cmd.srs.intervalDays).toBe(1);
    expect(Date.parse(cmd.lastPracticedAt)).toBeGreaterThan(Date.now() - 5000);
    const state = JSON.parse(await readFile(path.join(h.dir, 'study/srs-state.json'), 'utf8'));
    expect(state.data.items[ls.id]).toMatchObject({ reps: 1, intervalDays: 1 });
    expect(state.data.items[ls.id].firstAt).toBeTruthy();
    const log = await readFile(
      path.join(h.dir, 'study/sessions', `${new Date().toISOString().slice(0, 7)}.jsonl`),
      'utf8',
    );
    expect(JSON.parse(log.trim().split('\n')[0]!)).toMatchObject({
      id: ls.id,
      rating: 'good',
      isNew: true,
    });
  });

  it('a lapse schedules the card again within minutes and shows it as due later', async () => {
    const r = (await h.req('POST', '/study/answer', { id: cp.id, rating: 'again' })).json;
    expect(r.srs).toMatchObject({ reps: 0, lapses: 1, intervalDays: 0 });
    expect(r.mastery).toBe(1);
    expect((await queue()).json.due).toBe(0); // not due for 10 minutes
    // simulate time passing by rewinding the stored due date
    const f = path.join(h.dir, 'study/srs-state.json');
    const doc = JSON.parse(await readFile(f, 'utf8'));
    doc.data.items[cp.id].dueAt = new Date(Date.now() - 60_000).toISOString();
    doc.data.items[ls.id].dueAt = new Date(Date.now() - 4 * 86_400_000).toISOString();
    await writeFile(f, JSON.stringify(doc));
    await h.s.ctx.store.get('study/srs-state.json')!.reloadExternal();
    const q = (await queue()).json;
    expect(q.due).toBe(2);
    expect(q.items[0].card.title).toBe('ls'); // most overdue first
    expect(q.items.slice(0, 2).every((i: Json) => !i.isNew)).toBe(true);
    expect(q.items.find((i: Json) => i.card.title === 'Directory Tree').isNew).toBe(true);
  });

  it('updates concept confidence and rejects bad input', async () => {
    const r = (
      await h.req('POST', '/study/answer', { id: tree.id, rating: 'easy', collection: 'concepts' })
    ).json;
    expect(r.srs.intervalDays).toBe(3);
    expect((await h.req('GET', `/concepts/${tree.id}`)).json.confidence).toBe(1);
    expect((await h.req('POST', '/study/answer', { id: 'nope', rating: 'good' })).status).toBe(404);
    expect((await h.req('POST', '/study/answer', { id: ls.id, rating: 'perfect' })).status).toBe(
      400,
    );
    expect((await h.req('GET', '/study/queue?limit=0')).status).toBe(400);
  });

  it('practises one entity on demand even when it is not due', async () => {
    const r = (await queue(`?onlyId=${ls.id}`)).json;
    expect(r.items).toHaveLength(1);
    expect(r.items[0].card.entityId).toBe(ls.id);
  });

  it('reports stats and honours the daily new-card limit', async () => {
    const s = (await h.req('GET', '/study/stats')).json;
    expect(s).toMatchObject({ reviewedToday: 3, newToday: 3, newPerDay: 10 });
    expect(s.retention30d).toBe(67); // good + easy of (good, again, easy)
    await h.req('PUT', '/settings', {
      ...(await h.req('GET', '/settings')).json,
      studyNewPerDay: 3,
    });
    const fresh = (
      await h.req('POST', '/commands', {
        name: 'mkdir',
        category: 'File System',
        explanation: 'make dirs',
      })
    ).json;
    const q = (await queue()).json;
    expect(q.newAvailable).toBe(1);
    expect(q.items.some((i: Json) => i.card.entityId === fresh.id)).toBe(false); // quota used up
    await h.req('PUT', '/settings', {
      ...(await h.req('GET', '/settings')).json,
      studyNewPerDay: 5,
    });
    expect((await queue()).json.items.some((i: Json) => i.card.entityId === fresh.id)).toBe(true);
  });
});

describe('questions list', () => {
  it('collects unanswered questions across concepts and can include answered ones', async () => {
    const open = (await h.req('GET', '/questions')).json as Json[];
    expect(open.map((q) => q.text)).toEqual(['Who can read /etc?']);
    expect(open[0]).toMatchObject({ concept: 'Directory Tree', conceptId: tree.id, done: false });
    expect(
      ((await h.req('GET', '/questions?includeDone=true')).json as Json[]).map((q) => q.text),
    ).toEqual(['Who can read /etc?', 'Where are logs?']);
  });
});

describe('overview (dashboard data)', () => {
  it('computes KPIs, mastery, streak, heatmap, skills, threat level and recommendations', async () => {
    await h.req('POST', '/labs', {
      title: 'Bandit 0',
      platform: 'Bandit',
      status: 'Completed',
      difficulty: 'Easy',
      domain: 'linux',
      conceptIds: [tree.id],
      timeSpentMin: 40,
    });
    await h.req('POST', '/projects', { title: 'Tool', status: 'In progress' });
    await h.req('POST', '/log', {
      title: 'Today',
      date: new Date().toISOString().slice(0, 10),
      timeSpentMin: 30,
    });
    const o = (await h.req('GET', '/stats/overview')).json;
    expect(o.kpis).toMatchObject({
      commandsTotal: 4,
      conceptsStudied: 1,
      labsCompleted: 1,
      activeProjects: 1,
    });
    expect(o.mastery).toEqual([2, 2, 0, 0]);
    expect(o.streak.current).toBe(1);
    expect(o.banner.threat.level).toBe('LOW');
    expect(o.banner.threat.explanation).toContain('Score =');
    expect(
      Object.values(o.heatmap.days).reduce((a: number, b) => a + (b as number), 0),
    ).toBeGreaterThan(5);
    expect(o.labs.byPlatform.Bandit).toEqual({ total: 1, completed: 1 });
    expect(o.timePerWeek).toHaveLength(12);
    expect(o.timePerWeek.at(-1).minutes).toBe(70);
    const linux = o.skillMap.find((s: Json) => s.name === 'Linux');
    expect(linux.score).toBeGreaterThan(0);
    expect(linux.counts).toMatchObject({ concepts: 1, labs: 1 });
    expect(o.skillMap.find((s: Json) => s.name === 'Cryptography').score).toBe(0);
    expect(o.skillMap).toHaveLength(13);
    expect(o.recommendations.every((r: Json) => r.why && r.route)).toBe(true);
    expect(o.recommendations.map((r: Json) => r.kind)).toContain('open-question');
    expect(o.recent.length).toBeGreaterThan(0);
    expect(o.study).toMatchObject({ due: 2 });
  });

  it('keeps a skill history snapshot per day for trends', async () => {
    const doc = JSON.parse(await readFile(path.join(h.dir, 'study/skill-history.json'), 'utf8'));
    const today = new Date().toISOString().slice(0, 10);
    expect(Object.keys(doc.data.days)).toContain(today);
    expect(doc.data.days[today].Linux).toBeGreaterThan(0);
  });

  it('rises to a higher threat level when activity is stale', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ck-threat-'));
    try {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(path.join(dir, 'activity'), { recursive: true });
      await mkdir(path.join(dir, 'data/commands'), { recursive: true });
      const stamp = '2026-01-01T00:00:00.000Z';
      await writeFile(
        path.join(dir, 'data/commands/general.json'),
        JSON.stringify({
          schemaVersion: 1,
          data: {
            items: [
              {
                id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
                title: 'x',
                slug: 'x',
                name: 'x',
                category: 'General',
                createdAt: stamp,
                updatedAt: stamp,
              },
            ],
          },
        }),
      ); // content exists, so the profile is not "empty"

      const old = new Date(Date.now() - 6 * 86_400_000).toISOString();
      await writeFile(
        path.join(dir, 'activity', `${old.slice(0, 7)}.jsonl`),
        JSON.stringify({ ts: old, type: 'update' }) + '\n',
      );
      const h2 = await harness(false, dir);
      const o = (await h2.req('GET', '/stats/overview')).json;
      expect(o.banner.threat.daysSinceActivity).toBeGreaterThanOrEqual(5);
      expect(['ELEVATED', 'HIGH']).toContain(o.banner.threat.level);
      expect(o.streak.current).toBe(0);
      await h2.stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('requires auth and migrates old skills files', async () => {
    expect((await h.req('GET', '/stats/overview', undefined, null)).status).toBe(401);
    expect((await h.req('GET', '/study/queue', undefined, null)).status).toBe(401);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ck-skills-'));
    try {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(path.join(dir, 'config'), { recursive: true });
      await writeFile(
        path.join(dir, 'config/skills.json'),
        JSON.stringify({
          schemaVersion: 1,
          data: [
            { name: 'Linux', weight: 2 },
            { name: 'Custom', weight: 1 },
          ],
        }),
      );
      const h2 = await harness(false, dir);
      const skills = (await h2.req('GET', '/skills')).json as Json[];
      expect(skills[0]).toMatchObject({ name: 'Linux', weight: 2 });
      expect(skills[0].aliases).toContain('file system');
      expect(skills[1].aliases).toEqual([]);
      await h2.stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
