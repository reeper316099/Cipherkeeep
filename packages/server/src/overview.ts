import { z } from 'zod';
import type { JsonFile } from '@cipherkeep/jsonstore';
import {
  COLLECTIONS,
  DEFAULT_SKILL_DOMAINS,
  addDays,
  buildRecommendations,
  computeStreak,
  dayKey,
  daysBetween,
  scoreDomains,
  threatLevel,
  weeklyMinutes,
  type CollectionName,
  type SkillDomain,
} from '@cipherkeep/shared';
import type { Context } from './context.ts';
import type { Entity } from './repo.ts';

const HistorySchema = z.object({ days: z.record(z.record(z.number())) });
type History = z.infer<typeof HistorySchema>;
/** Activity that counts as practice: creating/editing/studying/lab work. Imports do not. */
const PRACTICE = new Set(['create', 'update', 'delete', 'study', 'lab']);
const HEAT_DAYS = 371; // 53 weeks

const num = (v: unknown) => (typeof v === 'number' ? v : 0);

export async function buildOverview(ctx: Context, opts: { now?: Date; tzOffset?: number } = {}) {
  const now = opts.now ?? new Date();
  const off = opts.tzOffset ?? 0;
  const today = dayKey(now, off);
  const all = (c: CollectionName) => ctx.repos[c].all().filter((e) => !e.archived);
  const commands = all('commands');
  const concepts = all('concepts');
  const labs = all('labs');
  const projects = all('projects');
  const logs = all('log');

  // ---- activity: heatmap, streak, staleness ----
  const from = addDays(today, -(HEAT_DAYS - 1));
  const events = (await ctx.activity.range(addDays(from, -1), addDays(today, 1))).filter((e) =>
    PRACTICE.has(e.type),
  );
  const heat = new Map<string, number>();
  for (const e of events) {
    const d = dayKey(e.ts, off);
    if (d >= from && d <= today) heat.set(d, (heat.get(d) ?? 0) + 1);
  }
  const active = new Set(heat.keys());
  const streak = computeStreak(active, today);
  const lastDay = [...active].sort().pop();
  const daysSince = lastDay ? Math.max(0, daysBetween(lastDay, today)) : null;

  // ---- study ----
  const { due, overdue } = await ctx.study.dueCounts(now);
  const study = await ctx.study.stats({ now, tzOffset: off });

  // ---- skill map (+ trend from daily snapshots) ----
  const domains: SkillDomain[] = ctx.skills.data.length
    ? ctx.skills.data.map((s) => ({ name: s.name, weight: s.weight, aliases: s.aliases }))
    : DEFAULT_SKILL_DOMAINS;
  const skillData = {
    concepts: concepts.map((c) => ({
      id: c.id,
      category: c.category,
      tags: c.tags,
      archived: false,
      updatedAt: c.updatedAt,
      difficulty: String(c.difficulty),
      confidence: num(c.confidence),
    })),
    commands: commands.map((c) => ({
      id: c.id,
      category: c.category,
      tags: c.tags,
      archived: false,
      updatedAt: c.updatedAt,
      mastery: num(c.mastery),
      lastPracticedAt: c.lastPracticedAt as string | undefined,
    })),
    labs: labs.map((l) => ({
      id: l.id,
      category: l.category,
      tags: l.tags,
      archived: false,
      updatedAt: l.updatedAt,
      status: String(l.status),
      difficulty: String(l.difficulty),
      domain: l.domain as string | undefined,
      solvedAt: l.solvedAt as string | undefined,
      conceptIds: (l.conceptIds as string[]) ?? [],
    })),
  };
  const skills = scoreDomains(domains, skillData, now);
  const history = await ctx.store.open<History>('study/skill-history.json', {
    version: 1,
    defaults: () => ({ days: {} }),
    validator: HistorySchema,
  });
  const snapshot = Object.fromEntries(skills.map((s) => [s.name, s.score]));
  if (JSON.stringify(history.data.days[today]) !== JSON.stringify(snapshot)) {
    await history.update((h) => {
      h.days[today] = snapshot;
      for (const d of Object.keys(h.days)) if (daysBetween(d, today) > 400) delete h.days[d];
    });
  }
  const pastDays = Object.keys(history.data.days)
    .filter((d) => daysBetween(d, today) >= 7)
    .sort();
  const base = pastDays.length ? history.data.days[pastDays[pastDays.length - 1]!] : undefined;
  const skillMap = skills.map((s) => ({
    ...s,
    trend: base ? s.score - (base[s.name] ?? 0) : null,
  }));
  const trendSeries = Object.entries(history.data.days)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-90)
    .map(([day, scores]) => ({ day, scores }));

  // ---- time per week: log entries + lab time (on solve/update date) ----
  const minutes: { day: string; minutes: number }[] = [
    ...logs.map((l) => ({ day: String(l.date), minutes: num(l.timeSpentMin) })),
    ...labs
      .filter((l) => num(l.timeSpentMin) > 0)
      .map((l) => ({
        day: String(l.solvedAt ?? dayKey(l.updatedAt, off)).slice(0, 10),
        minutes: num(l.timeSpentMin),
      })),
  ];

  const by = <T extends Entity>(xs: T[], key: string) => {
    const m: Record<string, number> = {};
    for (const x of xs) m[String(x[key] || '—')] = (m[String(x[key] || '—')] ?? 0) + 1;
    return m;
  };
  const platformStatus: Record<string, { total: number; completed: number }> = {};
  for (const l of labs) {
    const p = (platformStatus[String(l.platform || '—')] ??= { total: 0, completed: 0 });
    p.total++;
    if (l.status === 'Completed') p.completed++;
  }

  const openByConcept = new Map<string, number>();
  for (const q of ctx.study.questions())
    openByConcept.set(q.conceptId, (openByConcept.get(q.conceptId) ?? 0) + 1);
  const recommendations = buildRecommendations({
    domains: skills,
    due,
    now,
    concepts: concepts.map((c) => ({
      id: c.id,
      title: c.title,
      archived: false,
      questionsOpen: openByConcept.get(c.id) ?? 0, // from the text itself, so hand edits count
    })),
    commands: commands.map((c) => ({
      id: c.id,
      name: String(c.name),
      archived: false,
      mastery: num(c.mastery),
      lastPracticedAt: c.lastPracticedAt as string | undefined,
      createdAt: c.createdAt,
    })),
    labs: labs.map((l) => ({
      id: l.id,
      title: l.title,
      archived: false,
      status: String(l.status),
      conceptIds: (l.conceptIds as string[]) ?? [],
      updatedAt: l.updatedAt,
    })),
  });

  const titleOf = (c: string, id?: string) =>
    id ? ctx.repos[c as CollectionName]?.get(id)?.title : undefined;
  const recent = [...events]
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .slice(0, 12)
    .map((e) => ({
      ts: e.ts,
      type: e.type,
      collection: e.collection,
      id: e.id,
      title: titleOf(e.collection ?? '', e.id),
    }));

  return {
    generatedAt: now.toISOString(),
    banner: {
      name: 'HQ',
      status: 'ACTIVE',
      mode: 'LEARNING',
      threat: threatLevel({
        daysSinceActivity: daysSince,
        streak: streak.current,
        overdue,
        empty: COLLECTIONS.every((c) => ctx.repos[c].all().length === 0),
      }),
    },
    counts: Object.fromEntries(
      COLLECTIONS.map((c) => [c, ctx.repos[c].all().filter((e) => !e.archived).length]),
    ),
    kpis: {
      commandsMastered: commands.filter((c) => num(c.mastery) === 3).length,
      commandsTotal: commands.length,
      conceptsStudied: concepts.length,
      conceptsConfident: concepts.filter((c) => num(c.confidence) >= 2).length,
      labsCompleted: labs.filter((l) => l.status === 'Completed').length,
      labsTotal: labs.length,
      activeProjects: projects.filter((p) => p.status === 'In progress').length,
    },
    mastery: [0, 1, 2, 3].map((n) => commands.filter((c) => num(c.mastery) === n).length),
    labs: {
      byPlatform: platformStatus,
      byStatus: by(labs, 'status'),
      byDifficulty: by(labs, 'difficulty'),
    },
    timePerWeek: weeklyMinutes(minutes, today, 12),
    streak,
    heatmap: { from, to: today, days: Object.fromEntries(heat) },
    study: { ...study, due, overdue },
    skillMap,
    skillTrend: trendSeries,
    recommendations,
    recent,
  };
}
export type Overview = Awaited<ReturnType<typeof buildOverview>>;
export type { JsonFile };
