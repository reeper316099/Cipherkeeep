import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { JsonFile, JsonStore } from '@cipherkeep/jsonstore';
import {
  QUESTIONS_KEY,
  buildCommandCard,
  buildConceptCard,
  dayKey,
  isDue,
  masteryFromSrs,
  newSrs,
  parseQuestions,
  pickCommandCardType,
  schedule,
  type Card,
  type Rating,
  type SrsState,
} from '@cipherkeep/shared';
import type { ActivityLog } from './activity.ts';
import type { Settings } from './config-files.ts';
import type { Entity, Repo } from './repo.ts';
import { AppError, notFound } from './util.ts';
import type { CollectionName } from '@cipherkeep/shared';

const StateSchema = z.object({
  items: z.record(
    z.object({
      ease: z.number(),
      intervalDays: z.number(),
      dueAt: z.string().optional(),
      reps: z.number(),
      lapses: z.number(),
      lastAt: z.string().optional(),
      /** When the card was first reviewed (drives the daily new-card limit). */
      firstAt: z.string().optional(),
    }),
  ),
});
type StateFile = z.infer<typeof StateSchema>;
type Stored = StateFile['items'][string];

export interface QueueItem {
  card: Card;
  isNew: boolean;
  dueAt?: string;
  srs: SrsState;
}

export interface StudyDeps {
  store: JsonStore;
  repos: Record<CollectionName, Repo>;
  activity: ActivityLog;
  settings: JsonFile<Settings>;
}

export interface OpenQuestion {
  conceptId: string;
  concept: string;
  text: string;
  line: number;
  done: boolean;
}

const DAY = 86_400_000;

export class StudyService {
  private file?: JsonFile<StateFile>;

  constructor(private readonly d: StudyDeps) {}

  private async state(): Promise<JsonFile<StateFile>> {
    this.file ??= await this.d.store.open<StateFile>('study/srs-state.json', {
      version: 1,
      defaults: () => ({ items: {} }),
      validator: StateSchema,
    });
    return this.file;
  }

  private entity(collection: 'commands' | 'concepts', id: string): Entity | undefined {
    return this.d.repos[collection].get(id);
  }

  private cardFor(collection: 'commands' | 'concepts', e: Entity, st?: Stored): Card | undefined {
    const seed = (st?.reps ?? 0) + (st?.lapses ?? 0);
    if (collection === 'concepts') return buildConceptCard(e as never, seed);
    const type = pickCommandCardType(e as never, seed);
    return type ? buildCommandCard(e as never, type, seed) : undefined;
  }

  /** Cards due now (oldest first), then new cards up to the daily limit. `onlyId` practises one entity on demand. */
  async queue(opts: {
    collection?: 'commands' | 'concepts';
    limit?: number;
    onlyId?: string;
    now?: Date;
    tzOffset?: number;
  }): Promise<{ items: QueueItem[]; due: number; newAvailable: number; newToday: number }> {
    const now = opts.now ?? new Date();
    const limit = opts.limit ?? 20;
    const items = (await this.state()).data.items;
    const cols: ('commands' | 'concepts')[] = opts.collection
      ? [opts.collection]
      : ['commands', 'concepts'];
    const today = dayKey(now, opts.tzOffset ?? 0);
    const newToday = Object.values(items).filter(
      (s) => s.firstAt && dayKey(s.firstAt, opts.tzOffset ?? 0) === today,
    ).length;
    const quota = Math.max(0, this.d.settings.data.studyNewPerDay - newToday);

    const due: QueueItem[] = [];
    const fresh: QueueItem[] = [];
    for (const collection of cols) {
      for (const e of this.d.repos[collection].all()) {
        if (e.archived || (opts.onlyId && e.id !== opts.onlyId)) continue;
        const st = items[e.id];
        const card = this.cardFor(collection, e, st);
        if (!card) continue;
        if (opts.onlyId) {
          due.push({ card, isNew: !st?.lastAt, dueAt: st?.dueAt, srs: st ?? newSrs() });
        } else if (st?.lastAt) {
          if (isDue(st, now)) due.push({ card, isNew: false, dueAt: st.dueAt, srs: st });
        } else fresh.push({ card, isNew: true, srs: newSrs() });
      }
    }
    due.sort((a, b) => Date.parse(a.dueAt ?? '0') - Date.parse(b.dueAt ?? '0'));
    fresh.sort((a, b) => a.card.title.localeCompare(b.card.title));
    const picked = opts.onlyId ? due : [...due, ...fresh.slice(0, quota)].slice(0, limit);
    return { items: picked, due: due.length, newAvailable: fresh.length, newToday };
  }

  async answer(input: {
    id: string;
    rating: Rating;
    collection?: 'commands' | 'concepts';
    ms?: number;
    cardType?: string;
    now?: Date;
  }): Promise<{ srs: SrsState; mastery: number }> {
    const now = input.now ?? new Date();
    const collection =
      input.collection ?? (this.entity('commands', input.id) ? 'commands' : 'concepts');
    const e = this.entity(collection, input.id);
    if (!e) throw notFound(collection, input.id);
    const file = await this.state();
    const prev = file.data.items[input.id] ?? { ...newSrs() };
    const next = schedule(prev, input.rating, now);
    const stored: Stored = { ...next, firstAt: prev.firstAt ?? now.toISOString() };
    await file.update((d) => void (d.items[input.id] = stored));
    const mastery = masteryFromSrs(next);
    if (collection === 'commands') {
      await this.d.repos.commands.patch(input.id, {
        srs: { ease: next.ease, intervalDays: next.intervalDays, dueAt: next.dueAt },
        mastery,
        lastPracticedAt: now.toISOString(),
        practiceCount: Number(e.practiceCount ?? 0) + 1,
      });
    } else {
      await this.d.repos.concepts.patch(input.id, { confidence: mastery });
    }
    await this.log({
      ts: now.toISOString(),
      id: input.id,
      collection,
      rating: input.rating,
      type: input.cardType,
      ms: input.ms,
      isNew: !prev.lastAt,
    });
    await this.d.activity
      .record({ type: 'study', collection, id: input.id })
      .catch(() => undefined);
    return { srs: next, mastery };
  }

  private async log(row: Record<string, unknown>): Promise<void> {
    const rel = `study/sessions/${String(row.ts).slice(0, 7)}.jsonl`;
    await this.d.store.mutex.run(rel, async () => {
      const f = this.d.store.abs(rel);
      await fs.mkdir(path.dirname(f), { recursive: true });
      await fs.appendFile(f, this.d.store.codec.encodeLine(JSON.stringify(row)) + '\n');
    });
  }

  async sessions(
    fromDay: string,
    toDay: string,
  ): Promise<{ ts: string; rating: Rating; isNew?: boolean }[]> {
    const out: { ts: string; rating: Rating; isNew?: boolean }[] = [];
    let [y, m] = fromDay.split('-').map(Number) as [number, number];
    const [ty, tm] = toDay.split('-').map(Number) as [number, number];
    while (y < ty || (y === ty && m <= tm)) {
      try {
        const text = await fs.readFile(
          this.d.store.abs(`study/sessions/${y}-${String(m).padStart(2, '0')}.jsonl`),
          'utf8',
        );
        for (const l of text.split('\n').filter(Boolean)) {
          try {
            out.push(JSON.parse(this.d.store.codec.decodeLine(l)));
          } catch {
            /* torn last line */
          }
        }
      } catch {
        /* no sessions that month */
      }
      if (++m > 12) {
        m = 1;
        y++;
      }
    }
    return out;
  }

  /** How many studiable entities are due now, and how many are overdue by more than `graceDays`. */
  async dueCounts(
    now: Date = new Date(),
    graceDays = 3,
  ): Promise<{ due: number; overdue: number }> {
    const items = (await this.state()).data.items;
    let due = 0;
    let overdue = 0;
    for (const collection of ['commands', 'concepts'] as const) {
      for (const e of this.d.repos[collection].all()) {
        const st = items[e.id];
        if (e.archived || !st?.lastAt || !isDue(st, now)) continue;
        due++;
        if (now.getTime() - Date.parse(st.dueAt!) > graceDays * DAY) overdue++;
      }
    }
    return { due, overdue };
  }

  async stats(opts: { now?: Date; tzOffset?: number } = {}) {
    const now = opts.now ?? new Date();
    const off = opts.tzOffset ?? 0;
    const today = dayKey(now, off);
    const q = await this.queue({ now, tzOffset: off, limit: 1 });
    const from = dayKey(now.getTime() - 30 * DAY, off);
    const rows = await this.sessions(from, today);
    const recent = rows.filter((r) => Date.parse(r.ts) >= now.getTime() - 30 * DAY);
    const todayRows = rows.filter((r) => dayKey(r.ts, off) === today);
    const passed = recent.filter((r) => r.rating === 'good' || r.rating === 'easy').length;
    return {
      due: q.due,
      newAvailable: Math.min(
        q.newAvailable,
        Math.max(0, this.d.settings.data.studyNewPerDay - q.newToday),
      ),
      newToday: q.newToday,
      reviewedToday: todayRows.length,
      reviews30d: recent.length,
      retention30d: recent.length ? Math.round((passed / recent.length) * 100) : null,
      newPerDay: this.d.settings.data.studyNewPerDay,
    };
  }

  /** Every unanswered “Questions I still have” bullet, across concepts. */
  questions(includeDone = false): OpenQuestion[] {
    const out: OpenQuestion[] = [];
    for (const c of this.d.repos.concepts.all()) {
      if (c.archived) continue;
      const sec = (c.sections as { key: string; markdown: string }[] | undefined)?.find(
        (s) => s.key === QUESTIONS_KEY,
      );
      if (!sec) continue;
      for (const q of parseQuestions(sec.markdown))
        if (includeDone || !q.done)
          out.push({ conceptId: c.id, concept: c.title, text: q.text, line: q.line, done: q.done });
    }
    return out;
  }
}

export { AppError };
