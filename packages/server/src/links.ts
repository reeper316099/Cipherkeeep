import {
  COLLECTIONS,
  buildTitleIndex,
  extractWikiLinks,
  resolveWikiLink,
  type CollectionName,
} from '@cipherkeep/shared';
import type { Entity, Repo } from './repo.ts';

export interface Edge {
  source: string;
  target: string;
  kind: 'relation' | 'wikilink';
}

export interface GraphNode {
  id: string;
  type: CollectionName;
  title: string;
  category: string;
  degree: number;
}

/** Relation fields per collection and the collection each points at. */
const RELATIONS: Partial<Record<CollectionName, [string, CollectionName][]>> = {
  concepts: [
    ['relatedCommandIds', 'commands'],
    ['relatedConceptIds', 'concepts'],
  ],
  labs: [
    ['commandIds', 'commands'],
    ['conceptIds', 'concepts'],
    ['scriptIds', 'snippets'],
  ],
  projects: [['conceptIds', 'concepts']],
  log: [
    ['conceptIds', 'concepts'],
    ['commandIds', 'commands'],
    ['labIds', 'labs'],
  ],
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Markdown-bearing text of an entity, scanned for [[wiki links]]. */
export function textOf(type: CollectionName, e: Entity): string {
  switch (type) {
    case 'commands':
      return `${str(e.whatItDoes)}\n${str(e.notes)}`;
    case 'concepts':
      return (Array.isArray(e.sections) ? (e.sections as { markdown: string }[]) : [])
        .map((s) => s.markdown)
        .join('\n');
    case 'labs':
      return str(e.writeup);
    case 'projects':
      return str(e.notes);
    case 'log':
      return `${str(e.keyTakeaway)}\n${str(e.body)}`;
    case 'notes':
      return str(e.markdown);
    default:
      return str(e.description);
  }
}

/** Relations (explicit fields + typed `links`) and wiki-links, computed on demand and cached until a repo changes. */
export class LinkIndex {
  private dirty = true;
  private edges: Edge[] = [];
  private nodes = new Map<string, GraphNode>();
  private incoming = new Map<string, Edge[]>();

  constructor(private readonly repos: Record<CollectionName, Repo>) {
    for (const c of COLLECTIONS) {
      const r = repos[c];
      r.on('upsert', () => (this.dirty = true));
      r.on('remove', () => (this.dirty = true));
      r.on('rebuild', () => (this.dirty = true));
    }
  }

  private build(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.nodes.clear();
    const edges = new Map<string, Edge>();
    const entries: { type: CollectionName; id: string; title: string; name?: string }[] = [];
    for (const type of COLLECTIONS) {
      for (const e of this.repos[type].all()) {
        if (e.archived) continue;
        this.nodes.set(e.id, { id: e.id, type, title: e.title, category: e.category, degree: 0 });
        entries.push({
          type,
          id: e.id,
          title: e.title,
          name: type === 'commands' ? str(e.name) : undefined,
        });
      }
    }
    const titles = buildTitleIndex(entries);
    const add = (source: string, target: string, kind: Edge['kind']) => {
      if (source === target || !this.nodes.has(target) || !this.nodes.has(source)) return;
      const key = `${source}>${target}`;
      const prev = edges.get(key);
      if (!prev || (prev.kind === 'wikilink' && kind === 'relation'))
        edges.set(key, { source, target, kind });
    };
    for (const type of COLLECTIONS) {
      for (const e of this.repos[type].all()) {
        if (e.archived) continue;
        for (const [field, _target] of RELATIONS[type] ?? []) {
          void _target;
          for (const id of Array.isArray(e[field]) ? (e[field] as string[]) : [])
            add(e.id, id, 'relation');
        }
        for (const l of e.links ?? []) add(e.id, l.targetId, 'relation');
        for (const w of extractWikiLinks(textOf(type, e))) {
          const hit = resolveWikiLink(titles, w);
          if (hit) add(e.id, hit.id, 'wikilink');
        }
      }
    }
    this.edges = [...edges.values()];
    this.incoming.clear();
    for (const ed of this.edges) {
      this.nodes.get(ed.source)!.degree++;
      this.nodes.get(ed.target)!.degree++;
      const list = this.incoming.get(ed.target) ?? [];
      list.push(ed);
      this.incoming.set(ed.target, list);
    }
  }

  backlinks(id: string): { id: string; type: CollectionName; title: string; kind: Edge['kind'] }[] {
    this.build();
    return (this.incoming.get(id) ?? []).map((e) => {
      const n = this.nodes.get(e.source)!;
      return { id: n.id, type: n.type, title: n.title, kind: e.kind };
    });
  }

  outgoing(id: string): { id: string; type: CollectionName; title: string; kind: Edge['kind'] }[] {
    this.build();
    return this.edges
      .filter((e) => e.source === id)
      .map((e) => {
        const n = this.nodes.get(e.target)!;
        return { id: n.id, type: n.type, title: n.title, kind: e.kind };
      });
  }

  graph(opts: { types?: CollectionName[]; includeOrphans?: boolean } = {}): {
    nodes: GraphNode[];
    edges: Edge[];
  } {
    this.build();
    const keep = (n: GraphNode) =>
      (!opts.types?.length || opts.types.includes(n.type)) && (opts.includeOrphans || n.degree > 0);
    const nodes = [...this.nodes.values()].filter(keep);
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: this.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }
}
