export interface SkillDomain {
  name: string;
  weight: number;
  /** Category / tag / domain labels that count towards this domain (case-insensitive). */
  aliases?: string[];
}

export const DEFAULT_SKILL_DOMAINS: SkillDomain[] = [
  { name: 'Linux', weight: 1, aliases: ['linux', 'file system', 'general', 'permissions'] },
  { name: 'Bash', weight: 1, aliases: ['bash', 'shell', 'text processing'] },
  { name: 'Networking', weight: 1, aliases: ['networking', 'network', 'tcp/ip'] },
  { name: 'Web Security', weight: 1, aliases: ['web security', 'web', 'xss', 'sqli'] },
  { name: 'Windows', weight: 1, aliases: ['windows', 'powershell'] },
  { name: 'Cryptography', weight: 1, aliases: ['cryptography', 'crypto'] },
  { name: 'Forensics', weight: 1, aliases: ['forensics'] },
  { name: 'OSINT', weight: 1, aliases: ['osint'] },
  { name: 'Log Analysis', weight: 1, aliases: ['log analysis', 'logs'] },
  {
    name: 'Scanning & Recon',
    weight: 1,
    aliases: ['scanning & recon', 'scanning', 'recon', 'reconnaissance'],
  },
  { name: 'Password Cracking', weight: 1, aliases: ['password cracking', 'passwords'] },
  { name: 'Reverse Engineering', weight: 1, aliases: ['reverse engineering', 'reversing', 'rev'] },
  { name: 'Binary Exploitation', weight: 1, aliases: ['binary exploitation', 'pwn'] },
];

interface Common {
  id: string;
  category: string;
  tags: string[];
  archived: boolean;
  updatedAt: string;
}
export interface SkillConcept extends Common {
  difficulty: string;
  confidence: number;
}
export interface SkillCommand extends Common {
  mastery: number;
  lastPracticedAt?: string;
}
export interface SkillLab extends Common {
  status: string;
  difficulty: string;
  domain?: string;
  solvedAt?: string;
  conceptIds: string[];
}

export interface DomainScore {
  name: string;
  weight: number;
  score: number;
  parts: { concepts: number; commands: number; labs: number; recency: number };
  counts: { concepts: number; commands: number; labs: number };
  lastActivity?: string;
}

const DIFF_CONCEPT: Record<string, number> = { Easy: 1, Medium: 1.5, Hard: 2 };
const DIFF_LAB: Record<string, number> = { Easy: 1, Medium: 2, Hard: 3 };
const norm = (s: string) => s.trim().toLowerCase();

/** Which domains a set of labels (category, tags, lab domain) maps to. */
export function domainsFor(labels: string[], domains: SkillDomain[]): string[] {
  const ls = new Set(labels.filter(Boolean).map(norm));
  return domains
    .filter((d) => [d.name, ...(d.aliases ?? [])].some((a) => ls.has(norm(a))))
    .map((d) => d.name);
}

/**
 * Domain score 0–100 =
 *   concepts  ≤ 35  (Σ difficulty × (0.3 + 0.7 × confidence/3), saturating at 6)
 * + commands  ≤ 25  (Σ mastery/3, saturating at 10)
 * + labs      ≤ 30  (Σ completed-lab difficulty weight 1/2/3, saturating at 8)
 * + recency   ≤ 10  (10 × e^(−days since last activity in the domain / 30))
 */
export function scoreDomains(
  domains: SkillDomain[],
  data: { concepts: SkillConcept[]; commands: SkillCommand[]; labs: SkillLab[] },
  now: Date = new Date(),
): DomainScore[] {
  const conceptDomains = new Map<string, string[]>();
  for (const c of data.concepts)
    conceptDomains.set(c.id, domainsFor([c.category, ...c.tags], domains));
  // work out each entity's domains once, not once per domain (matters with thousands of commands)
  const commandDomains = new Map<string, Set<string>>(
    data.commands.map((c) => [c.id, new Set(domainsFor([c.category, ...c.tags], domains))]),
  );
  const labDomains = new Map<string, Set<string>>(
    data.labs.map((l) => [
      l.id,
      new Set([
        ...domainsFor([l.domain ?? '', ...l.tags], domains),
        ...l.conceptIds.flatMap((id) => conceptDomains.get(id) ?? []),
      ]),
    ]),
  );
  return domains.map((d) => {
    let concepts = 0;
    let commands = 0;
    let labs = 0;
    const counts = { concepts: 0, commands: 0, labs: 0 };
    let last = 0;
    const touch = (iso?: string) => {
      const t = iso ? Date.parse(iso) : NaN;
      if (!Number.isNaN(t)) last = Math.max(last, t);
    };
    for (const c of data.concepts) {
      if (c.archived || !conceptDomains.get(c.id)!.includes(d.name)) continue;
      counts.concepts++;
      concepts += (DIFF_CONCEPT[c.difficulty] ?? 1) * (0.3 + (0.7 * c.confidence) / 3);
      touch(c.updatedAt);
    }
    for (const c of data.commands) {
      if (c.archived || !commandDomains.get(c.id)!.has(d.name)) continue;
      counts.commands++;
      commands += c.mastery / 3;
      touch(c.lastPracticedAt);
    }
    for (const l of data.labs) {
      if (l.archived) continue;
      if (!labDomains.get(l.id)!.has(d.name)) continue;
      counts.labs++;
      if (l.status === 'Completed') {
        labs += DIFF_LAB[l.difficulty] ?? 1;
        touch(l.solvedAt ?? l.updatedAt);
      } else touch(l.updatedAt);
    }
    const days = last ? Math.max(0, (now.getTime() - last) / 86_400_000) : Infinity;
    const parts = {
      concepts: 35 * Math.min(1, concepts / 6),
      commands: 25 * Math.min(1, commands / 10),
      labs: 30 * Math.min(1, labs / 8),
      recency:
        counts.concepts + counts.commands + counts.labs === 0 ? 0 : 10 * Math.exp(-days / 30),
    };
    const score = Math.round(parts.concepts + parts.commands + parts.labs + parts.recency);
    return {
      name: d.name,
      weight: d.weight,
      score: Math.min(100, score),
      parts: Object.fromEntries(
        Object.entries(parts).map(([k, v]) => [k, Math.round(v * 10) / 10]),
      ) as DomainScore['parts'],
      counts,
      lastActivity: last ? new Date(last).toISOString() : undefined,
    };
  });
}
