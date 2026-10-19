import { describe, expect, it } from 'vitest';
import { countByDate, isoDate, longDate, monthGrid } from '../src/lib/calendar';
import {
  countOpen,
  isBlank,
  missingSections,
  parseQuestions,
  toggleQuestion,
} from '../src/lib/concepts';
import { buildFolderTree, inFolder } from '../src/lib/folders';
import { layoutGraph } from '../src/lib/graphLayout';
import { filterLabs, formatMinutes, groupByStatus, statusPatch } from '../src/lib/labs';
import { parseWikiHref, wikiHref } from '../src/lib/markdown';
import type { Lab } from '@cipherkeep/shared';

const lab = (o: Partial<Lab>) =>
  ({
    id: o.title ?? 'x',
    title: 'x',
    platform: 'Bandit',
    status: 'Not Started',
    difficulty: 'Easy',
    tags: [],
    archived: false,
    ...o,
  }) as Lab;

describe('concept questions checklist', () => {
  const md = '- How secure is it?\n- [x] Where are logs?\n-\n- [ ] Why?';
  it('ignores empty bullets and tracks answered ones', () => {
    expect(parseQuestions(md).map((q) => [q.text, q.done])).toEqual([
      ['How secure is it?', false],
      ['Where are logs?', true],
      ['Why?', false],
    ]);
    expect(countOpen(md)).toBe(2);
  });
  it('toggles a question in place', () => {
    const next = toggleQuestion(md, 0);
    expect(next.split('\n')[0]).toBe('- [x] How secure is it?');
    expect(toggleQuestion(next, 0)).toBe(md.replace('- How', '- [ ] How'));
    expect(toggleQuestion(md, 2)).toBe(md); // empty bullet is not a question
  });
  it('treats empty template bullets as blank', () => {
    expect(isBlank('- \n-\n')).toBe(true);
    expect(isBlank('')).toBe(true);
    expect(isBlank('- real\n-')).toBe(false);
  });
  it('lists template sections a concept lacks', () => {
    expect(
      missingSections(
        [{ key: 'a' }],
        [
          { key: 'a', title: 'A' },
          { key: 'b', title: 'B' },
        ],
      ).map((s) => s.key),
    ).toEqual(['b']);
  });
});

describe('notes folders', () => {
  it('builds a counted tree and matches nested folders', () => {
    const t = buildFolderTree(['guides/net', 'guides/os', 'guides/net', '', 'ctf']);
    expect(t.children.map((c) => [c.name, c.count])).toEqual([
      ['ctf', 1],
      ['guides', 3],
    ]);
    expect(t.children[1]!.children.map((c) => [c.name, c.count])).toEqual([
      ['net', 2],
      ['os', 1],
    ]);
    expect(inFolder('guides/net', 'guides')).toBe(true);
    expect(inFolder('guidesx', 'guides')).toBe(false);
    expect(inFolder('anything', '')).toBe(true);
  });
});

describe('labs', () => {
  const labs = [
    lab({ title: 'a', status: 'In Progress', platform: 'picoCTF', domain: 'web' }),
    lab({ title: 'b', status: 'Completed' }),
    lab({ title: 'c', archived: true }),
  ];
  it('filters and groups by status', () => {
    expect(
      filterLabs(labs, { q: '', platform: '', difficulty: '', domain: '' }).map((l) => l.title),
    ).toEqual(['a', 'b']);
    expect(
      filterLabs(labs, { q: '', platform: 'picoCTF', difficulty: '', domain: 'web' }).map(
        (l) => l.title,
      ),
    ).toEqual(['a']);
    const g = groupByStatus(labs.filter((l) => !l.archived));
    expect([g['Not Started'].length, g['In Progress'].length, g.Completed.length]).toEqual([
      0, 1, 1,
    ]);
  });
  it('stamps the solve date once when completing', () => {
    expect(statusPatch(lab({}), 'Completed', '2026-05-01')).toEqual({
      status: 'Completed',
      solvedAt: '2026-05-01',
    });
    expect(statusPatch(lab({ solvedAt: '2026-01-01' }), 'Completed', '2026-05-01')).toEqual({
      status: 'Completed',
    });
    expect(formatMinutes(95)).toBe('1h 35m');
    expect(formatMinutes(undefined)).toBe('—');
  });
});

describe('calendar', () => {
  it('builds a Monday-first 6×7 grid without timezone drift', () => {
    const g = monthGrid(2026, 2); // March 2026 starts on a Sunday
    expect(g).toHaveLength(42);
    expect(g[6]).toMatchObject({ date: '2026-03-01', inMonth: true });
    expect(g[0]).toMatchObject({ date: '2026-02-23', inMonth: false });
    expect(g.filter((c) => c.inMonth)).toHaveLength(31);
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(longDate('2026-03-24')).toBe('March 24, 2026');
    expect(countByDate([{ date: 'a' }, { date: 'a' }, { date: 'b' }]).get('a')).toBe(2);
  });
});

describe('graph layout', () => {
  it('is deterministic, finite, in bounds, and pulls linked nodes together', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `n${i}`);
    const edges = Array.from({ length: 20 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` }));
    const a = layoutGraph(ids, edges, { width: 1000, height: 700 });
    const b = layoutGraph(ids, edges, { width: 1000, height: 700 });
    expect(a.get('n3')).toEqual(b.get('n3'));
    for (const p of a.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1000);
    }
    const d = (x: string, y: string) =>
      Math.hypot(a.get(x)!.x - a.get(y)!.x, a.get(x)!.y - a.get(y)!.y);
    expect(d('n0', 'n1')).toBeLessThan(d('n0', 'n39') + 400);
  });
  it('handles empty and single-node graphs', () => {
    expect(layoutGraph([], []).size).toBe(0);
    expect(layoutGraph(['a'], []).get('a')).toBeDefined();
  });
});

describe('wiki href encoding', () => {
  it('round-trips and rejects other schemes', () => {
    expect(parseWikiHref(wikiHref({ target: 'A | B', kind: 'cmd' }))).toEqual({
      target: 'A | B',
      kind: 'cmd',
    });
    expect(parseWikiHref('https://x.test')).toBeNull();
    expect(parseWikiHref('ck-wiki:%E0%A4%A')).toBeNull();
  });
});
