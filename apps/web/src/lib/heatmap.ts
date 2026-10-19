export interface HeatCell {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  inRange: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const add = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

/** Intensity 0–4 relative to the busiest day, so a quiet profile still shows contrast. */
export function levelFor(count: number, max: number): HeatCell['level'] {
  if (count <= 0 || max <= 0) return 0;
  const r = count / max;
  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
}

/** Columns of 7 days (Monday first) covering from..to; cells outside the range are flagged. */
export function buildHeatGrid(
  days: Record<string, number>,
  from: string,
  to: string,
): HeatCell[][] {
  const dow = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = add(from, -dow);
  const max = Math.max(0, ...Object.values(days));
  const cols: HeatCell[][] = [];
  for (let d = start; d <= to; d = add(d, 7)) {
    cols.push(
      Array.from({ length: 7 }, (_, i) => {
        const date = add(d, i);
        const count = days[date] ?? 0;
        return { date, count, level: levelFor(count, max), inRange: date >= from && date <= to };
      }),
    );
  }
  return cols;
}
