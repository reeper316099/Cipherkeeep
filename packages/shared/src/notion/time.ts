/** "1 hr", "45 mins", "2h 30m", "~1.5 hours", "1:30", "half an hour" → minutes (null if unknown). */
export function parseTimeSpent(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw
    .toLowerCase()
    .replace(/[~≈]|\b(about|approx\.?|approximately|around|roughly)\b/g, ' ')
    .replace(/\band\b/g, ' ')
    .trim();
  if (!s) return null;
  const clock = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  let total = 0;
  let matched = false;
  if (/half an? hour/.test(s)) {
    total += 30;
    matched = true;
  } else if (/\ban? hour\b/.test(s)) {
    total += 60;
    matched = true;
  }
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/g)) {
    const n = Number(m[1]);
    total += m[2]!.startsWith('h') ? n * 60 : n;
    matched = true;
  }
  return matched ? Math.round(total) : null;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const iso = (y: number, m: number, d: number): string | null => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** "March 24, 2026", "2026-03-24", "24 Mar 2026", "03/24/2026" → YYYY-MM-DD (start of a range). */
export function parseNotionDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/^@/, '').split('→')[0]!.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(s);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m![1]!.toLowerCase().slice(0, 3)));
    return mi >= 0 ? iso(+m[3]!, mi + 1, +m[2]!) : null;
  }
  m = /^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})/.exec(s);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m![2]!.toLowerCase().slice(0, 3)));
    return mi >= 0 ? iso(+m[3]!, mi + 1, +m[1]!) : null;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return iso(+m[3]!, +m[1]!, +m[2]!);
  return null;
}
