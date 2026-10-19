import { schedule, type Card, type Rating, type SrsState } from '@cipherkeep/shared';

export interface QueueItem {
  card: Card;
  isNew: boolean;
  dueAt?: string;
  srs: SrsState;
}

export const RATING_LABEL: Record<Rating, string> = {
  again: 'Again',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
};
export const RATING_KEYS: Rating[] = ['again', 'hard', 'good', 'easy'];

export const suggestRating = (correct: boolean): Rating => (correct ? 'good' : 'again');

/** "10m", "1d", "3w" … what a rating would schedule next (shown on the buttons). */
export function nextIntervalLabel(srs: SrsState, rating: Rating, now = new Date()): string {
  const s = schedule(srs, rating, now);
  if (s.intervalDays === 0) return '10m';
  if (s.intervalDays < 30) return `${s.intervalDays}d`;
  if (s.intervalDays < 365) return `${Math.round(s.intervalDays / 30)}mo`;
  return `${(s.intervalDays / 365).toFixed(1)}y`;
}

export interface SessionSummary {
  total: number;
  byRating: Record<Rating, number>;
  accuracy: number;
  ms: number;
}

export function summarize(answers: { rating: Rating }[], ms: number): SessionSummary {
  const byRating: Record<Rating, number> = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const a of answers) byRating[a.rating]++;
  const passed = byRating.good + byRating.easy + byRating.hard;
  return {
    total: answers.length,
    byRating,
    accuracy: answers.length ? Math.round((passed / answers.length) * 100) : 0,
    ms,
  };
}
