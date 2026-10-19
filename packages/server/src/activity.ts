import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { JsonStore } from '@cipherkeep/jsonstore';

export interface ActivityEvent {
  ts: string;
  type: 'create' | 'update' | 'delete' | 'study' | 'lab' | 'import';
  collection?: string;
  id?: string;
}

/** Append-only monthly JSONL. Never records note contents, only what happened to which id. */
export class ActivityLog {
  constructor(private readonly store: JsonStore) {}

  private rel(ts: string) {
    return `activity/${ts.slice(0, 7)}.jsonl`;
  }

  async record(ev: Omit<ActivityEvent, 'ts'>): Promise<void> {
    const ts = new Date().toISOString();
    const rel = this.rel(ts);
    await this.store.mutex.run(rel, async () => {
      const file = this.store.abs(rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, JSON.stringify({ ts, ...ev }) + '\n');
    });
  }

  /** Events whose UTC month falls between the two `YYYY-MM-DD` days (inclusive); callers bucket by their own timezone. */
  async range(fromDay: string, toDay: string): Promise<ActivityEvent[]> {
    const out: ActivityEvent[] = [];
    let [y, m] = fromDay.split('-').map(Number) as [number, number];
    const [ty, tm] = toDay.split('-').map(Number) as [number, number];
    while (y < ty || (y === ty && m <= tm)) {
      out.push(...(await this.month(`${y}-${String(m).padStart(2, '0')}`)));
      if (++m > 12) {
        m = 1;
        y++;
      }
    }
    return out;
  }

  async month(yyyyMm: string): Promise<ActivityEvent[]> {
    if (!/^\d{4}-\d{2}$/.test(yyyyMm)) return [];
    try {
      const text = await fs.readFile(this.store.abs(`activity/${yyyyMm}.jsonl`), 'utf8');
      return text
        .split('\n')
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l) as ActivityEvent];
          } catch {
            return []; // tolerate a torn last line
          }
        });
    } catch {
      return [];
    }
  }
}
