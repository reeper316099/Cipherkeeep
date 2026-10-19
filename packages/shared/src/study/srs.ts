export type Rating = 'again' | 'hard' | 'good' | 'easy';
export const RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];

export interface SrsState {
  ease: number;
  intervalDays: number;
  dueAt?: string;
  reps: number;
  lapses: number;
  lastAt?: string;
}

export const newSrs = (): SrsState => ({ ease: 2.5, intervalDays: 0, reps: 0, lapses: 0 });

const QUALITY: Record<Rating, number> = { again: 1, hard: 3, good: 4, easy: 5 };
const DAY = 86_400_000;
const AGAIN_DELAY = 10 * 60_000;
/** Safety cap (10 years) so repeated "easy" can never overflow dates. */
export const MAX_INTERVAL_DAYS = 3650;

/**
 * SM-2 with Anki-style tweaks.
 * - ease changes by the SM-2 formula for hard/good/easy; "again" costs 0.2; clamped to [1.3, 3.0]
 * - "again" resets repetitions and brings the card back in 10 minutes
 * - first successful review: 1 day (easy: 3); second: 6 days (hard: 4, easy: 8); then interval × ease
 *   (hard uses ×1.2, easy adds a ×1.3 bonus). The interval never shrinks on a pass.
 */
export function schedule(prev: SrsState, rating: Rating, now: Date = new Date()): SrsState {
  const q = QUALITY[rating];
  const t = now.getTime();
  if (rating === 'again') {
    return {
      ease: Math.max(1.3, +(prev.ease - 0.2).toFixed(4)),
      intervalDays: 0,
      reps: 0,
      lapses: prev.lapses + 1,
      lastAt: now.toISOString(),
      dueAt: new Date(t + AGAIN_DELAY).toISOString(),
    };
  }
  const ease = Math.min(
    3,
    Math.max(1.3, +(prev.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))).toFixed(4)),
  );
  let interval: number;
  if (prev.reps === 0) interval = rating === 'easy' ? 3 : 1;
  else if (prev.reps === 1) interval = rating === 'hard' ? 4 : rating === 'easy' ? 8 : 6;
  else {
    const factor = rating === 'hard' ? 1.2 : rating === 'easy' ? ease * 1.3 : ease;
    interval = Math.max(prev.intervalDays + 1, Math.round(prev.intervalDays * factor));
  }
  interval = Math.min(interval, MAX_INTERVAL_DAYS);
  return {
    ease,
    intervalDays: interval,
    reps: prev.reps + 1,
    lapses: prev.lapses,
    lastAt: now.toISOString(),
    dueAt: new Date(t + interval * DAY).toISOString(),
  };
}

/** 0 unseen · 1 learning · 2 comfortable (interval ≥ 6 d) · 3 mastered (interval ≥ 21 d). */
export function masteryFromSrs(s: SrsState): 0 | 1 | 2 | 3 {
  if (!s.lastAt) return 0;
  if (s.intervalDays >= 21) return 3;
  if (s.intervalDays >= 6) return 2;
  return 1;
}

export const isDue = (s: SrsState | undefined, now: Date = new Date()): boolean =>
  !!s?.dueAt && Date.parse(s.dueAt) <= now.getTime();
