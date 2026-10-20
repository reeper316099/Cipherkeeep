import { randomUUID } from 'node:crypto';
import { VirtualFs } from './source.ts';

/**
 * Optional import straight from the Notion API. This is the one feature that talks to the network, and only
 * ever to api.notion.com, only while you run an import, and only after you turned it on in Settings.
 *
 * It reads everything your integration can see and writes it into an in-memory copy of a Notion *export*
 * (CSV per database + Markdown per page), so the normal importer, preview, merge strategies and undo apply.
 * The token lives in memory for the duration of the job and is never written to disk or logged.
 */
export const NOTION_API_BASE = 'https://api.notion.com/v1';
/** The API version these shapes were written against (data sources, not databases). */
export const NOTION_VERSION = '2026-03-11';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export class NotionApiError extends Error {
  constructor(
    message: string,
    readonly code: 'BAD_TOKEN' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'CANCELLED' | 'FAILED',
  ) {
    super(message);
    this.name = 'NotionApiError';
  }
}

/** Polite client: ~3 requests/second (Notion's average limit), honours Retry-After, retries transient errors. */
export class NotionClient {
  private last = 0;
  constructor(
    private readonly token: string,
    private readonly opts: {
      fetch?: FetchFn;
      minIntervalMs?: number;
      sleep?: (ms: number) => Promise<void>;
      signal?: AbortSignal;
    } = {},
  ) {}

  private sleep = (ms: number) =>
    this.opts.sleep ? this.opts.sleep(ms) : new Promise<void>((r) => setTimeout(r, ms));

  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${NOTION_API_BASE}${path}`;
    if (!url.startsWith(`${NOTION_API_BASE}/`)) throw new NotionApiError('Bad URL', 'FAILED');
    const doFetch: FetchFn = this.opts.fetch ?? ((u, i) => fetch(u, i));
    for (let attempt = 0; ; attempt++) {
      if (this.opts.signal?.aborted) throw new NotionApiError('Cancelled', 'CANCELLED');
      const wait = (this.opts.minIntervalMs ?? 350) - (Date.now() - this.last);
      if (wait > 0) await this.sleep(wait);
      this.last = Date.now();
      let res: Response;
      try {
        res = await doFetch(url, {
          method,
          headers: {
            authorization: `Bearer ${this.token}`,
            'notion-version': NOTION_VERSION,
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: this.opts.signal,
        });
      } catch {
        if (this.opts.signal?.aborted) throw new NotionApiError('Cancelled', 'CANCELLED');
        if (attempt < 3) {
          await this.sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new NotionApiError('Could not reach api.notion.com', 'UNAVAILABLE');
      }
      if (res.ok) return (await res.json()) as T;
      if (res.status === 401)
        throw new NotionApiError('Notion rejected the token. Check it and try again.', 'BAD_TOKEN');
      if (res.status === 429 && attempt < 6) {
        const after = Number(res.headers.get('retry-after'));
        await this.sleep(
          Math.min(60_000, (Number.isFinite(after) && after >= 0 ? after : 2) * 1000),
        );
        continue;
      }
      if (res.status >= 500 && attempt < 3) {
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      const err = new NotionApiError(
        `Notion returned ${res.status}`,
        res.status === 429 ? 'RATE_LIMITED' : 'FAILED',
      );
      (err as NotionApiError & { status?: number }).status = res.status;
      throw err;
    }
  }
}

// ---------- Notion JSON shapes (only what we read) ----------

interface RichText {
  plain_text?: string;
  href?: string | null;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  };
}
interface Block {
  id: string;
  type: string;
  has_children?: boolean;
  [k: string]: unknown;
}
interface Prop {
  id?: string;
  type: string;
  name?: string;
  [k: string]: unknown;
}
interface NPage {
  id: string;
  object: string;
  in_trash?: boolean;
  is_archived?: boolean;
  archived?: boolean;
  parent?: { type: string; page_id?: string; data_source_id?: string; database_id?: string };
  properties?: Record<string, Prop>;
}
interface NDataSource {
  id: string;
  title?: RichText[];
  parent?: { database_id?: string };
  properties?: Record<string, Prop>;
}
interface List<T> {
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

const hex32 = (id: string) => id.replace(/-/g, '').toLowerCase();
const plain = (rt: RichText[] | undefined) => (rt ?? []).map((t) => t.plain_text ?? '').join('');
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME = /[/\\:*?"<>|\u0000-\u001f]/g;
const safeName = (s: string) => s.replace(UNSAFE_NAME, '-').trim().slice(0, 120) || 'Untitled';

// ---------- rich text and blocks → Markdown ----------

export function richTextToMarkdown(rt: RichText[] | undefined): string {
  return (rt ?? [])
    .map((t) => {
      const raw = t.plain_text ?? '';
      if (!raw.trim()) return raw;
      const lead = /^\s*/.exec(raw)![0];
      const trail = /\s*$/.exec(raw)![0];
      let core = raw.slice(lead.length, raw.length - trail.length);
      const a = t.annotations ?? {};
      if (a.code) core = '`' + core.replace(/`/g, "'") + '`';
      if (a.bold) core = `**${core}**`;
      if (a.italic) core = `*${core}*`;
      if (a.strikethrough) core = `~~${core}~~`;
      if (t.href) core = `[${core}](${t.href})`;
      return lead + core + trail;
    })
    .join('');
}

export interface ConvertStats {
  images: number;
  unsupported: number;
}

type Children = (blockId: string) => Promise<Block[]>;

async function renderBlocks(
  blocks: Block[],
  getChildren: Children,
  stats: ConvertStats,
  depth = 0,
): Promise<string[]> {
  const out: string[] = [];
  let n = 0; // numbered-list counter
  const kids = async (b: Block, d: number) =>
    b.has_children && d < 8 ? renderBlocks(await getChildren(b.id), getChildren, stats, d) : [];
  const indent = (lines: string[], by: string) => lines.map((l) => (l ? by + l : l));
  for (const b of blocks) {
    const body = (b[b.type] ?? {}) as { rich_text?: RichText[]; [k: string]: unknown };
    const text = richTextToMarkdown(body.rich_text);
    if (b.type !== 'numbered_list_item') n = 0;
    switch (b.type) {
      case 'paragraph':
        out.push(text, '');
        out.push(...indent(await kids(b, depth + 1), ''));
        break;
      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
      case 'heading_4': {
        const level = Math.min(6, Number(b.type.slice(-1)));
        out.push(`${'#'.repeat(level)} ${text}`, '');
        out.push(...(await kids(b, depth + 1))); // toggleable headings
        break;
      }
      case 'bulleted_list_item':
      case 'toggle':
      case 'to_do': {
        const box = b.type === 'to_do' ? ((body.checked as boolean) ? '[x] ' : '[ ] ') : '';
        const label = b.type === 'toggle' ? `**${text}**` : text;
        out.push(`- ${box}${label}`);
        out.push(...indent(await kids(b, depth + 1), '  '));
        break;
      }
      case 'numbered_list_item':
        n++;
        out.push(`${n}. ${text}`);
        out.push(...indent(await kids(b, depth + 1), '   '));
        break;
      case 'quote':
        out.push(...indent([text, ...(await kids(b, depth + 1))], '> '), '');
        break;
      case 'callout': {
        const icon = (body.icon as { emoji?: string } | undefined)?.emoji;
        out.push(`> ${icon ? icon + ' ' : ''}${text}`, '');
        break;
      }
      case 'code': {
        const lang = String(body.language ?? '');
        const code = plain(body.rich_text);
        const fence = '`'.repeat(
          Math.max(3, ...[...code.matchAll(/`+/g)].map((m) => m[0].length + 1)),
        );
        out.push(`${fence}${lang === 'plain text' ? '' : lang}`, code, fence, '');
        break;
      }
      case 'equation':
        out.push(`$$${String(body.expression ?? '')}$$`, '');
        break;
      case 'divider':
        out.push('---', '');
        break;
      case 'child_page':
        out.push(`[[${String((b.child_page as { title?: string })?.title ?? 'Untitled')}]]`, '');
        break;
      case 'link_to_page':
        break; // the target page is imported on its own
      case 'bookmark':
      case 'embed':
      case 'link_preview': {
        const url = String((b[b.type] as { url?: string })?.url ?? '');
        if (url) out.push(`[${url}](${url})`, '');
        break;
      }
      case 'image':
      case 'video':
      case 'pdf':
      case 'file':
      case 'audio': {
        const f = (b[b.type] ?? {}) as {
          type?: string;
          external?: { url?: string };
          caption?: RichText[];
        };
        const cap = plain(f.caption);
        if (f.type === 'external' && f.external?.url) {
          out.push(
            b.type === 'image'
              ? `![${cap}](${f.external.url})`
              : `[${cap || f.external.url}](${f.external.url})`,
            '',
          );
        } else {
          // Notion-hosted files are short-lived signed links on other hosts; we do not download them.
          stats.images++;
          out.push(`*(${b.type} not downloaded${cap ? `: ${cap}` : ''})*`, '');
        }
        break;
      }
      case 'table': {
        const rows = await getChildren(b.id);
        const cells = rows.map((r) =>
          (((r.table_row as { cells?: RichText[][] })?.cells ?? []) as RichText[][]).map((c) =>
            richTextToMarkdown(c).replace(/\|/g, '\\|').replace(/\n/g, ' '),
          ),
        );
        if (cells.length) {
          const width = Math.max(...cells.map((r) => r.length));
          const pad = (r: string[]) =>
            `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`;
          out.push(pad(cells[0]!), `| ${Array(width).fill('---').join(' | ')} |`);
          for (const r of cells.slice(1)) out.push(pad(r));
          out.push('');
        }
        break;
      }
      case 'column_list':
      case 'column':
      case 'synced_block':
        out.push(...(await kids(b, depth + 1)));
        break;
      case 'template':
      case 'breadcrumb':
      case 'table_of_contents':
      case 'table_row':
        break;
      default:
        stats.unsupported++;
        if (text) out.push(text, '');
    }
  }
  return out;
}

export async function blocksToMarkdown(
  blocks: Block[],
  getChildren: Children,
  stats: ConvertStats = { images: 0, unsupported: 0 },
): Promise<string> {
  const lines = await renderBlocks(blocks, getChildren, stats);
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- properties → CSV cells (Notion's export format) ----------

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
function niceDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : iso;
}

export function propertyToCell(p: Prop, titleOf: (pageId: string) => string | undefined): string {
  const v = p[p.type] as unknown;
  switch (p.type) {
    case 'title':
    case 'rich_text':
      return plain(v as RichText[]);
    case 'number':
      return v == null ? '' : String(v);
    case 'select':
    case 'status':
      return (v as { name?: string } | null)?.name ?? '';
    case 'multi_select':
      return ((v as { name: string }[]) ?? []).map((o) => o.name).join(', ');
    case 'date': {
      const d = v as { start?: string; end?: string } | null;
      return d?.start ? niceDate(d.start) + (d.end ? ` → ${niceDate(d.end)}` : '') : '';
    }
    case 'checkbox':
      return v ? 'Yes' : 'No';
    case 'url':
    case 'email':
    case 'phone_number':
      return (v as string | null) ?? '';
    case 'people':
      return ((v as { name?: string }[]) ?? [])
        .map((u) => u.name ?? '')
        .filter(Boolean)
        .join(', ');
    case 'files':
      return ((v as { name?: string }[]) ?? [])
        .map((f) => f.name ?? '')
        .filter(Boolean)
        .join(', ');
    case 'relation':
      return ((v as { id: string }[]) ?? [])
        .map((r) => {
          const t = titleOf(r.id);
          return t ? `${t} (https://www.notion.so/${hex32(r.id)})` : '';
        })
        .filter(Boolean)
        .join(', ');
    case 'formula': {
      const f = v as { type?: string; [k: string]: unknown } | null;
      return f && f.type && f[f.type] != null ? String(f[f.type]) : '';
    }
    case 'created_time':
    case 'last_edited_time':
      return String(v ?? '');
    case 'unique_id': {
      const u = v as { prefix?: string; number?: number } | null;
      return u?.number != null ? `${u.prefix ? u.prefix + '-' : ''}${u.number}` : '';
    }
    default:
      return ''; // rollups, buttons and other computed values are not imported
  }
}

const csvEscape = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

// ---------- the whole fetch ----------

export interface Progress {
  phase: 'listing' | 'reading' | 'building';
  done: number;
  total: number;
}

export interface FetchedExport {
  vfs: VirtualFs;
  stats: { databases: number; pages: number; skippedPages: number } & ConvertStats;
}

async function listAll<T>(
  client: NotionClient,
  body: Record<string, unknown>,
  cap = 20_000,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  do {
    const res: List<T> = await client.request('POST', '/search', {
      ...body,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor && out.length < cap);
  return out;
}

export async function fetchNotionExport(
  client: NotionClient,
  onProgress: (p: Progress) => void = () => undefined,
): Promise<FetchedExport> {
  onProgress({ phase: 'listing', done: 0, total: 0 });
  const sources = await listAll<NDataSource>(client, {
    filter: { property: 'object', value: 'data_source' },
  });
  const allPages = (
    await listAll<NPage>(client, { filter: { property: 'object', value: 'page' } })
  ).filter((p) => !(p.in_trash || p.is_archived || p.archived));
  const dsByDb = new Map<string, string>();
  const dsById = new Map<string, NDataSource>();
  for (const ds of sources) {
    dsById.set(ds.id, ds);
    if (ds.parent?.database_id) dsByDb.set(ds.parent.database_id, ds.id);
  }
  const dsOf = (p: NPage): string | undefined =>
    p.parent?.data_source_id ??
    (p.parent?.database_id ? dsByDb.get(p.parent.database_id) : undefined);

  const titleProp = (props: Record<string, Prop> | undefined) =>
    Object.entries(props ?? {}).find(([, v]) => v.type === 'title')?.[0];
  const pageTitle = (p: NPage) => {
    const k = titleProp(p.properties);
    return (k && plain(p.properties![k]![p.properties![k]!.type] as RichText[])) || 'Untitled';
  };
  const byId = new Map(allPages.map((p) => [p.id, p]));
  const titles = new Map(allPages.map((p) => [p.id, pageTitle(p)]));
  const titleOf = (id: string) => titles.get(id);

  const vfs = new VirtualFs();
  const stats: FetchedExport['stats'] = {
    databases: 0,
    pages: 0,
    skippedPages: 0,
    images: 0,
    unsupported: 0,
  };
  const convert: ConvertStats = { images: 0, unsupported: 0 };
  const childCache = new Map<string, Block[]>();
  const getChildren: Children = async (id) => {
    const cached = childCache.get(id);
    if (cached) return cached;
    const all: Block[] = [];
    let cursor: string | null = null;
    do {
      const res: List<Block> = await client.request(
        'GET',
        `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`,
      );
      all.push(...res.results);
      cursor = res.has_more ? res.next_cursor : null;
    } while (cursor);
    childCache.set(id, all);
    return all;
  };

  const pathOf = (p: NPage): string => {
    const ds = dsOf(p);
    if (ds) return safeName(plain(dsById.get(ds)?.title)) || 'Database';
    const parent = p.parent?.page_id ? byId.get(p.parent.page_id) : undefined;
    return parent ? `${pathOf(parent)}/${safeName(pageTitle(parent))} ${hex32(parent.id)}` : '';
  };

  let done = 0;
  for (const p of allPages) {
    onProgress({ phase: 'reading', done, total: allPages.length });
    let body = '';
    try {
      body = await blocksToMarkdown(await getChildren(p.id), getChildren, convert);
      stats.pages++;
    } catch (e) {
      if (e instanceof NotionApiError && (e.code === 'BAD_TOKEN' || e.code === 'CANCELLED'))
        throw e;
      stats.skippedPages++; // no access to the content, or a transient failure: import the properties only
    }
    childCache.clear();
    const title = pageTitle(p);
    const dir = pathOf(p);
    vfs.add(
      `${dir ? dir + '/' : ''}${safeName(title)} ${hex32(p.id)}.md`,
      Buffer.from(`# ${title}\n\n${body}\n`),
    );
    done++;
  }

  onProgress({ phase: 'building', done: allPages.length, total: allPages.length });
  for (const ds of sources) {
    const rows = allPages.filter((p) => dsOf(p) === ds.id);
    const schema = Object.entries(ds.properties ?? {});
    const tKey = schema.find(([, v]) => v.type === 'title')?.[0];
    if (!tKey) continue;
    const cols = [tKey, ...schema.map(([k]) => k).filter((k) => k !== tKey)];
    const lines = [cols.map(csvEscape).join(',')];
    for (const r of rows) {
      lines.push(
        cols
          .map((c) => {
            const prop = r.properties?.[c];
            return csvEscape(prop ? propertyToCell(prop, titleOf) : '');
          })
          .join(','),
      );
    }
    const name = safeName(plain(ds.title)) || 'Database';
    vfs.add(`${name} ${hex32(ds.id)}.csv`, Buffer.from('﻿' + lines.join('\n') + '\n'));
    stats.databases++;
  }
  stats.images = convert.images;
  stats.unsupported = convert.unsupported;
  return { vfs, stats };
}

// ---------- background jobs ----------

export interface NotionJob {
  id: string;
  state: 'running' | 'done' | 'failed' | 'cancelled';
  progress: Progress;
  message?: string;
  result?: FetchedExport['stats'];
  vfs?: VirtualFs;
}

/** In-memory jobs; the token is captured in the closure of `run` and nowhere else. */
export class NotionJobs {
  private jobs = new Map<string, { job: NotionJob; abort: AbortController }>();

  start(token: string, opts: { fetch?: FetchFn; minIntervalMs?: number } = {}): NotionJob {
    for (const [k, v] of this.jobs)
      if (v.job.state !== 'running' && this.jobs.size > 5) this.jobs.delete(k);
    if ([...this.jobs.values()].some((j) => j.job.state === 'running'))
      throw new NotionApiError('An import from Notion is already running', 'FAILED');
    const job: NotionJob = {
      id: randomUUID(),
      state: 'running',
      progress: { phase: 'listing', done: 0, total: 0 },
    };
    const abort = new AbortController();
    this.jobs.set(job.id, { job, abort });
    const client = new NotionClient(token, { ...opts, signal: abort.signal });
    void fetchNotionExport(client, (p) => (job.progress = p))
      .then((r) => {
        job.vfs = r.vfs;
        job.result = r.stats;
        job.state = 'done';
      })
      .catch((e: unknown) => {
        job.state = e instanceof NotionApiError && e.code === 'CANCELLED' ? 'cancelled' : 'failed';
        job.message =
          e instanceof NotionApiError
            ? e.message
            : 'Something went wrong while reading from Notion';
      });
    return job;
  }

  get(id: string): NotionJob | undefined {
    return this.jobs.get(id)?.job;
  }

  cancel(id: string): void {
    this.jobs.get(id)?.abort.abort();
  }
}
