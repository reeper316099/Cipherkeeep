export type ThreatLevel = 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH';

export interface Threat {
  level: ThreatLevel;
  score: number;
  daysSinceActivity: number | null;
  streak: number;
  overdue: number;
  explanation: string;
}

/**
 * THREAT LEVEL = how stale your practice is (a playful but real nudge).
 *   score = 10 × days since last activity (3 if you have content but no activity yet; an empty profile is simply LOW) + 2 × cards overdue by > 3 days (max 20) − 3 × streak days (max 14)
 *   LOW < 20 · MODERATE 20–49 · ELEVATED 50–89 · HIGH ≥ 90
 */
export function threatLevel(input: {
  daysSinceActivity: number | null;
  streak: number;
  overdue: number;
  /** A brand-new profile with no content: nothing can be stale. */
  empty?: boolean;
}): Threat {
  if (input.empty) {
    return {
      level: 'LOW',
      score: 0,
      daysSinceActivity: null,
      streak: 0,
      overdue: 0,
      explanation:
        'LOW (score 0): nothing to practise yet. Add or import some content and this starts tracking your practice.',
    };
  }
  const days = input.daysSinceActivity ?? 3; // content but no activity yet: a nudge (MODERATE), not an alarm
  const raw = days * 10 + Math.min(input.overdue, 20) * 2 - Math.min(input.streak, 14) * 3;
  const score = Math.max(0, Math.round(raw));
  const level: ThreatLevel =
    score >= 90 ? 'HIGH' : score >= 50 ? 'ELEVATED' : score >= 20 ? 'MODERATE' : 'LOW';
  const when =
    input.daysSinceActivity === null
      ? 'no activity yet'
      : input.daysSinceActivity === 0
        ? 'active today'
        : `${input.daysSinceActivity} day(s) since last activity`;
  return {
    level,
    score,
    daysSinceActivity: input.daysSinceActivity,
    streak: input.streak,
    overdue: input.overdue,
    explanation: `${level} (score ${score}): ${when}, ${input.overdue} card(s) overdue by more than 3 days, ${input.streak}-day streak. Score = 10×days idle + 2×overdue (max 20) − 3×streak (max 14). LOW < 20, MODERATE < 50, ELEVATED < 90, HIGH above.`,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD of a timestamp in the learner's timezone (`offsetMin` = Date.getTimezoneOffset()). */
export function dayKey(ts: string | number | Date, offsetMin = 0): string {
  const d = new Date(new Date(ts).getTime() - offsetMin * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Current streak counts consecutive active days ending today, or ending yesterday when today has no
 * activity yet (so the streak is not wiped before you have had a chance to practise).
 */
export function computeStreak(
  active: Set<string>,
  today: string,
): { current: number; longest: number } {
  let current = 0;
  let d = active.has(today) ? today : addDays(today, -1);
  while (active.has(d)) {
    current++;
    d = addDays(d, -1);
  }
  const days = [...active].sort();
  let longest = 0;
  let run = 0;
  let prev = '';
  for (const day of days) {
    run = prev && daysBetween(prev, day) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }
  return { current, longest };
}

/** Monday-based week start (YYYY-MM-DD) for a day string. */
export function weekStart(day: string): string {
  const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -dow);
}

/** Sums `minutes` into the last `weeks` Monday-based weeks ending at `today` (oldest first, zeros included). */
export function weeklyMinutes(
  entries: { day: string; minutes: number }[],
  today: string,
  weeks = 12,
): { week: string; minutes: number }[] {
  const start = addDays(weekStart(today), -7 * (weeks - 1));
  const out = Array.from({ length: weeks }, (_, i) => ({
    week: addDays(start, 7 * i),
    minutes: 0,
  }));
  for (const e of entries) {
    const w = weekStart(e.day);
    const slot = out.find((o) => o.week === w);
    if (slot) slot.minutes += e.minutes;
  }
  return out;
}
