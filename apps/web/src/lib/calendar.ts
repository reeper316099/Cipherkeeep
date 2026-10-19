export interface Cell {
  date: string; // YYYY-MM-DD
  day: number;
  inMonth: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 6×7 Monday-first grid for a month (month is 0-based). Built from local dates, so no timezone drift. */
export function monthGrid(year: number, month: number): Cell[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, month, 1 - offset + i);
    return { date: isoDate(d), day: d.getDate(), inMonth: d.getMonth() === month };
  });
}

export const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

export function countByDate<T extends { date: string }>(entries: T[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.date, (m.get(e.date) ?? 0) + 1);
  return m;
}
