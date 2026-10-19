import type { DomainScore } from './skills.ts';

export interface Recommendation {
  id: string;
  kind:
    | 'review'
    | 'weak-domain'
    | 'lab-in-progress'
    | 'concept-no-lab'
    | 'stale-command'
    | 'open-question';
  title: string;
  /** Why this is suggested: always shown to the learner. */
  why: string;
  route: string;
  priority: number;
}

export interface RecommendInput {
  domains: DomainScore[];
  concepts: { id: string; title: string; archived: boolean; questionsOpen: number }[];
  commands: {
    id: string;
    name: string;
    archived: boolean;
    mastery: number;
    lastPracticedAt?: string;
    createdAt: string;
  }[];
  labs: {
    id: string;
    title: string;
    archived: boolean;
    status: string;
    conceptIds: string[];
    updatedAt: string;
  }[];
  due: number;
  now?: Date;
  staleDays?: number;
}

const MAX = { concepts: 35, commands: 25, labs: 30, recency: 10 } as const;
const ROUTE = {
  concepts: '/concepts',
  commands: '/commands',
  labs: '/labs',
  recency: '/study',
} as const;
const ago = (d: number) => (d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`);
const daysAgo = (iso: string, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000));

export function buildRecommendations(input: RecommendInput): Recommendation[] {
  const now = input.now ?? new Date();
  const stale = input.staleDays ?? 14;
  const out: Recommendation[] = [];

  if (input.due > 0) {
    out.push({
      id: 'review',
      kind: 'review',
      title: `Review ${input.due} due card${input.due === 1 ? '' : 's'}`,
      why: 'Spaced repetition brings cards back just before you would forget them; clearing them keeps your streak and threat level low.',
      route: '/study',
      priority: 100,
    });
  }

  const withData = input.domains.filter(
    (d) => d.counts.concepts + d.counts.commands + d.counts.labs > 0,
  );
  const weakest = [...withData]
    .filter((d) => d.score < 60)
    .sort((a, b) => a.score / Math.max(a.weight, 0.1) - b.score / Math.max(b.weight, 0.1))[0];
  if (weakest) {
    const gaps = (Object.keys(MAX) as (keyof typeof MAX)[]).map((k) => ({
      k,
      gap: 1 - weakest.parts[k] / MAX[k],
    }));
    const worst = gaps.sort((a, b) => b.gap - a.gap)[0]!;
    const hint = {
      concepts: 'study a concept',
      commands: 'practise its commands',
      labs: 'complete a lab',
      recency: 'do something in it this week',
    }[worst.k];
    out.push({
      id: `domain:${weakest.name}`,
      kind: 'weak-domain',
      title: `Strengthen ${weakest.name}`,
      why: `${weakest.name} is your weakest weighted domain among those you have started (${weakest.score}/100). Biggest gap: ${worst.k}. Try to ${hint}.`,
      route: ROUTE[worst.k],
      priority: 80,
    });
  }

  for (const l of input.labs.filter((x) => !x.archived && x.status === 'In Progress').slice(0, 3)) {
    out.push({
      id: `lab:${l.id}`,
      kind: 'lab-in-progress',
      title: `Finish “${l.title}”`,
      why: `In progress, last touched ${ago(daysAgo(l.updatedAt, now))}.`,
      route: `/labs/${l.id}`,
      priority: 70,
    });
  }

  const used = new Set(input.labs.filter((l) => !l.archived).flatMap((l) => l.conceptIds));
  for (const c of input.concepts.filter((x) => !x.archived && !used.has(x.id)).slice(0, 3)) {
    out.push({
      id: `concept:${c.id}`,
      kind: 'concept-no-lab',
      title: `Practise “${c.title}” in a lab`,
      why: 'You have notes on this concept but no lab uses it yet. Applying it makes it stick.',
      route: `/concepts/${c.id}`,
      priority: 60,
    });
  }

  const staleCmds = input.commands
    .filter((c) => !c.archived && c.mastery < 3)
    .map((c) => ({
      c,
      days: daysAgo(c.lastPracticedAt ?? c.createdAt, now),
      never: !c.lastPracticedAt,
    }))
    .filter((x) => x.days >= stale || x.never)
    .sort((a, b) => Number(b.never) - Number(a.never) || b.days - a.days)
    .slice(0, 3);
  for (const { c, days, never } of staleCmds) {
    out.push({
      id: `cmd:${c.id}`,
      kind: 'stale-command',
      title: `Revisit \`${c.name}\``,
      why: never
        ? `Never practised (mastery ${c.mastery}/3).`
        : `Not practised for ${days} days (mastery ${c.mastery}/3).`,
      route: `/commands/${c.id}`,
      priority: 50,
    });
  }

  const openTotal = input.concepts
    .filter((c) => !c.archived)
    .reduce((n, c) => n + c.questionsOpen, 0);
  if (openTotal > 0) {
    out.push({
      id: 'questions',
      kind: 'open-question',
      title: `Answer ${openTotal} open question${openTotal === 1 ? '' : 's'}`,
      why: 'Questions you wrote down while studying are the cheapest next step: each one points at a gap.',
      route: '/questions',
      priority: 40,
    });
  }
  return out.sort((a, b) => b.priority - a.priority).slice(0, 10);
}
