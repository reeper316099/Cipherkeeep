import type { Lab } from '@cipherkeep/shared';

export const LAB_STATUSES = ['Not Started', 'In Progress', 'Completed'] as const;

export interface LabFilters {
  q: string;
  platform: string;
  difficulty: string;
  domain: string;
}

export function filterLabs(labs: Lab[], f: LabFilters): Lab[] {
  const n = f.q.trim().toLowerCase();
  return labs.filter(
    (l) =>
      !l.archived &&
      (!f.platform || l.platform === f.platform) &&
      (!f.difficulty || l.difficulty === f.difficulty) &&
      (!f.domain || l.domain === f.domain) &&
      (!n || l.title.toLowerCase().includes(n) || l.tags.some((t) => t.toLowerCase().includes(n))),
  );
}

export function groupByStatus(labs: Lab[]): Record<(typeof LAB_STATUSES)[number], Lab[]> {
  const out = { 'Not Started': [], 'In Progress': [], Completed: [] } as Record<
    (typeof LAB_STATUSES)[number],
    Lab[]
  >;
  for (const l of labs) out[l.status].push(l);
  for (const k of LAB_STATUSES) out[k].sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

/** Patch for moving a lab to a status: completing it stamps the solve date once. */
export function statusPatch(
  lab: Lab,
  status: Lab['status'],
  today = new Date().toISOString().slice(0, 10),
): Partial<Lab> {
  return status === 'Completed' && !lab.solvedAt ? { status, solvedAt: today } : { status };
}

export const formatMinutes = (m: number | undefined) =>
  m ? (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`) : '—';
