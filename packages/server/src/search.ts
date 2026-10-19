import MiniSearch from 'minisearch';
import type { CollectionName } from '@cipherkeep/shared';
import type { Entity, Repo } from './repo.ts';

const SEPARATORS = /[\s,;()"'`<>|{}[\]]+/;

/**
 * Tokenizer that keeps leading dashes (-la, --color=auto) and also emits useful sub-tokens
 * (dash-less form, parts around `=`, path/word segments) so both `-la` and `color` find them.
 */
export function tokenize(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(SEPARATORS)) {
    const chunk = raw.replace(/^[:*]+|[.:!?*]+$/g, '');
    if (!chunk) continue;
    out.add(chunk);
    const dashless = chunk.replace(/^-+/, '');
    if (dashless !== chunk && dashless) out.add(dashless);
    for (const part of chunk.split('=')) {
      if (part && part !== chunk) {
        out.add(part);
        const d = part.replace(/^-+/, '');
        if (d) out.add(d);
      }
    }
    for (const seg of dashless.split(/[/\\.\-_~=]+/)) if (seg.length > 0) out.add(seg);
  }
  return [...out];
}

interface Doc {
  key: string;
  type: CollectionName;
  id: string;
  name: string;
  title: string;
  tags: string;
  body: string;
  code: string;
  category: string;
  status: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const list = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);

function fencedCode(md: string): string {
  return [...md.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
}

export function toDoc(type: CollectionName, e: Entity): Doc {
  const d: Doc = {
    key: `${type}:${e.id}`,
    type,
    id: e.id,
    name: '',
    title: e.title,
    tags: e.tags.join(' '),
    body: '',
    code: '',
    category: e.category,
    status: '',
  };
  switch (type) {
    case 'commands':
      d.name = str(e.name);
      d.body = [
        e.whatItDoes,
        e.explanation,
        e.syntax,
        e.notes,
        ...list<{ name: string; meaning: string }>(e.arguments).map(
          (a) => `${a.name} ${a.meaning}`,
        ),
        ...list<{ flag: string; meaning: string }>(e.options).map((o) => o.meaning),
        ...list<{ description: string }>(e.examples).map((x) => x.description),
      ]
        .map(str)
        .join('\n');
      d.code = [
        e.syntax,
        ...list<{ flag: string }>(e.options).map((o) => o.flag),
        ...list<{ command: string }>(e.examples).map((x) => x.command),
      ]
        .map(str)
        .join('\n');
      break;
    case 'concepts':
      d.body = list<{ title: string; markdown: string }>(e.sections)
        .map((s) => `${s.title}\n${s.markdown}`)
        .join('\n');
      d.code = fencedCode(d.body);
      d.status = str(e.difficulty);
      break;
    case 'labs':
      d.body = [e.writeup, e.domain].map(str).join('\n');
      d.code = fencedCode(str(e.writeup));
      d.status = str(e.status);
      break;
    case 'projects':
      d.body = [e.notes, ...list<string>(e.skillsUsed)].map(str).join('\n');
      d.status = str(e.status);
      break;
    case 'log':
      d.body = [e.keyTakeaway, e.topicsRaw, e.body, ...list<string>(e.topics)].map(str).join('\n');
      break;
    case 'notes':
      d.body = str(e.markdown);
      d.code = fencedCode(d.body);
      d.status = str(e.kind);
      break;
    case 'snippets':
      d.body = str(e.description);
      d.code = str(e.code);
      d.status = str(e.language);
      break;
  }
  return d;
}

export interface SearchFilters {
  types?: CollectionName[];
  tags: string[];
  cats: string[];
  statuses: string[];
}

const OPERATORS = new Set(['cmd', 'tag', 'cat', 'status', 'type']);
const TYPE_ALIASES: Record<string, CollectionName> = {
  cmd: 'commands',
  command: 'commands',
  commands: 'commands',
  concept: 'concepts',
  concepts: 'concepts',
  lab: 'labs',
  labs: 'labs',
  project: 'projects',
  projects: 'projects',
  log: 'log',
  note: 'notes',
  notes: 'notes',
  snippet: 'snippets',
  snippets: 'snippets',
};

/** Split `cmd:ls tag:linux cat:"File System" status:done free text` into filters + text. */
export function parseQuery(q: string): { text: string; filters: SearchFilters } {
  const filters: SearchFilters = { tags: [], cats: [], statuses: [] };
  const terms: string[] = [];
  const re = /(\w+):(?:"([^"]*)"|(\S*))|(\S+)/g;
  for (const m of q.matchAll(re)) {
    const key = m[1]?.toLowerCase();
    if (key && OPERATORS.has(key)) {
      const val = (m[2] ?? m[3] ?? '').trim();
      if (key === 'cmd') {
        (filters.types ??= []).push('commands');
        if (val) terms.push(val);
      } else if (key === 'type') {
        const t = TYPE_ALIASES[val.toLowerCase()];
        if (t) (filters.types ??= []).push(t);
      } else if (key === 'tag') filters.tags.push(val.toLowerCase());
      else if (key === 'cat') filters.cats.push(val.toLowerCase());
      else filters.statuses.push(val.toLowerCase());
    } else terms.push(m[0]);
  }
  return { text: terms.join(' '), filters };
}

export interface SearchHit {
  type: CollectionName;
  id: string;
  title: string;
  category: string;
  score: number;
  highlight: string;
}

export function snippet(text: string, terms: string[], width = 120): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.replace(/^-+/, '').toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return text.slice(0, width).trim();
  const start = Math.max(0, at - 30);
  return (start > 0 ? '…' : '') + text.slice(start, start + width).trim();
}

export class SearchIndex {
  private mini = new MiniSearch<Doc>({
    idField: 'key',
    fields: ['name', 'title', 'tags', 'body', 'code'],
    storeFields: ['type', 'id', 'title', 'category', 'tags', 'status'],
    tokenize,
    searchOptions: {
      boost: { name: 12, title: 6, tags: 3, code: 2, body: 1 },
      prefix: true,
      fuzzy: (term) => (term.length > 4 ? 0.2 : false),
      combineWith: 'AND',
      tokenize,
    },
  });
  private repos = new Map<CollectionName, Repo>();

  attach(repo: Repo): void {
    this.repos.set(repo.name, repo);
    this.rebuild(repo);
    repo.on('upsert', (e) => {
      const key = `${repo.name}:${e.id}`;
      if (this.mini.has(key)) this.mini.discard(key);
      this.mini.add(toDoc(repo.name, e));
    });
    repo.on('remove', (id) => {
      const key = `${repo.name}:${id}`;
      if (this.mini.has(key)) this.mini.discard(key);
    });
    repo.on('rebuild', () => this.rebuild(repo));
  }

  private rebuild(repo: Repo): void {
    const prefix = `${repo.name}:`;
    const stale: string[] = [];
    // MiniSearch has no public key iteration; track via search of all docs of this type
    for (const r of this.mini.search(MiniSearch.wildcard, {
      filter: (x) => x.type === repo.name,
    })) {
      stale.push(r.id as string);
    }
    for (const k of stale) if (k.startsWith(prefix) && this.mini.has(k)) this.mini.discard(k);
    for (const e of repo.all()) {
      const doc = toDoc(repo.name, e);
      if (this.mini.has(doc.key)) this.mini.discard(doc.key);
      this.mini.add(doc);
    }
  }

  search(q: string, opts: { limit?: number; types?: CollectionName[] } = {}): SearchHit[] {
    const { text, filters } = parseQuery(q);
    const types = [...(filters.types ?? []), ...(opts.types ?? [])];
    const keep = (r: { type: CollectionName; tags: string; category: string; status: string }) =>
      (!types.length || types.includes(r.type)) &&
      filters.tags.every((t) => r.tags.toLowerCase().split(' ').includes(t)) &&
      filters.cats.every((c) => r.category.toLowerCase() === c) &&
      filters.statuses.every((s) => r.status.toLowerCase() === s);
    const results = text.trim()
      ? this.mini.search(text, { filter: (r) => keep(r as never) })
      : filters.types || filters.tags.length || filters.cats.length || filters.statuses.length
        ? this.mini.search(MiniSearch.wildcard, { filter: (r) => keep(r as never) })
        : [];
    const terms = tokenize(text);
    return results.slice(0, opts.limit ?? 50).map((r) => {
      const type = r.type as CollectionName;
      const e = this.repos.get(type)?.get(r.id as string);
      const d = e ? toDoc(type, e) : undefined;
      return {
        type,
        id: r.id as string,
        title: r.title as string,
        category: r.category as string,
        score: r.score,
        highlight: d ? snippet(`${d.body}\n${d.code}`, terms) : '',
      };
    });
  }
}
