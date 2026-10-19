import { normalizeTitle } from './notion/names.ts';
import type { CollectionName } from './constants.ts';

export interface WikiLink {
  raw: string;
  target: string;
  /** `cmd` for `[[cmd:ls]]`; undefined for `[[Title]]`. */
  kind?: string;
  alias?: string;
}

const KINDS = new Set(['cmd', 'concept', 'lab', 'note', 'project', 'log', 'snippet']);

/** Extract `[[Title]]`, `[[cmd:ls]]`, `[[Title|alias]]`; ignores code and glob classes like `[[:upper:]]`. */
export function extractWikiLinks(md: string): WikiLink[] {
  const stripped = md.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, '');
  const out: WikiLink[] = [];
  for (const m of stripped.matchAll(/\[\[([^\][\n]+?)\]\]/g)) {
    const inner = m[1]!;
    if (/^[:!]/.test(inner) || /:\]$/.test(inner)) continue; // [[:alpha:]] glob class
    const [left, alias] = inner.split('|') as [string, string | undefined];
    const kindMatch = /^(\w+):(.+)$/.exec(left);
    if (kindMatch && KINDS.has(kindMatch[1]!)) {
      out.push({ raw: m[0], kind: kindMatch[1], target: kindMatch[2]!.trim(), alias });
    } else out.push({ raw: m[0], target: left.trim(), alias });
  }
  return out;
}

const KIND_TO_COLLECTION: Record<string, CollectionName> = {
  cmd: 'commands',
  concept: 'concepts',
  lab: 'labs',
  note: 'notes',
  project: 'projects',
  log: 'log',
  snippet: 'snippets',
};
/** Order tried for an un-prefixed `[[Title]]`. */
const UNKINDED_ORDER: CollectionName[] = [
  'notes',
  'concepts',
  'commands',
  'labs',
  'projects',
  'snippets',
  'log',
];

export interface TitleIndexEntry {
  type: CollectionName;
  id: string;
  title: string;
  /** Commands are also addressable by name. */
  name?: string;
}

export type TitleIndex = Map<CollectionName, Map<string, string>>;

export function buildTitleIndex(entries: Iterable<TitleIndexEntry>): TitleIndex {
  const idx: TitleIndex = new Map();
  for (const e of entries) {
    const m = idx.get(e.type) ?? new Map<string, string>();
    for (const t of [e.title, e.name]) {
      if (!t) continue;
      const k = normalizeTitle(t);
      if (k && !m.has(k)) m.set(k, e.id);
    }
    idx.set(e.type, m);
  }
  return idx;
}

/** Resolve a wiki-link to an entity: `[[cmd:ls]]` is exact, `[[Title]]` tries each collection in turn. */
export function resolveWikiLink(
  idx: TitleIndex,
  link: WikiLink,
): { type: CollectionName; id: string } | undefined {
  const key = normalizeTitle(link.target);
  const kind = link.kind ? KIND_TO_COLLECTION[link.kind] : undefined;
  for (const type of kind ? [kind] : UNKINDED_ORDER) {
    const id = idx.get(type)?.get(key);
    if (id) return { type, id };
  }
  return undefined;
}
