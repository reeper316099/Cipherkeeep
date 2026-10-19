import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import YAML from 'yaml';
import { ulid } from 'ulid';
import { atomicWriteFile } from '@cipherkeep/jsonstore';
import { NoteSchema, type Note } from '@cipherkeep/shared';
import { inputSchemas, type Entity, type Repo, type RepoEvents } from './repo.ts';
import { AppError, notFound, slugify } from './util.ts';

const sha = (s: string) => createHash('sha1').update(s).digest('hex');

export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = YAML.parse(m[1]!);
  return {
    data: data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
    body: m[2]!,
  };
}

export function serializeNote(n: Note): string {
  const { markdown, folder: _folder, slug: _slug, ...fm } = n;
  void _folder;
  void _slug;
  const clean = Object.fromEntries(Object.entries(fm).filter(([, v]) => v !== undefined));
  return `---\n${YAML.stringify(clean).trimEnd()}\n---\n${markdown}`;
}

/** Normalise a user-supplied folder to safe, slugged posix segments. */
export function safeFolder(folder: string): string {
  const segs = folder
    .split(/[\\/]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '.');
  if (segs.some((s) => s === '..')) throw new AppError(400, 'VALIDATION', 'Invalid folder');
  return segs.map(slugify).join('/');
}

/** Notes are real .md files with frontmatter under data/notes/<folder>/<slug>.md. */
export class NoteRepo extends EventEmitter<RepoEvents> implements Repo {
  readonly name = 'notes' as const;
  private byId = new Map<string, { e: Note; rel: string }>();
  private written = new Map<string, string>(); // abs -> hash of last own write
  private watcher?: FSWatcher;
  private schemas = inputSchemas('notes');

  constructor(
    private readonly dataDir: string,
    private readonly watch = true,
  ) {
    super();
  }

  private get root() {
    return path.join(this.dataDir, 'data', 'notes');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    await this.scan();
    if (this.watch) {
      this.watcher = chokidar.watch(this.root, {
        ignoreInitial: true,
        ignored: (p) => path.basename(p).startsWith('.'),
        awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
      });
      const changed = (p: string) => void this.loadFile(p).catch(() => undefined);
      this.watcher
        .on('add', changed)
        .on('change', changed)
        .on('unlink', (p) => this.dropFile(p));
      await new Promise<void>((r) => this.watcher!.once('ready', () => r()));
    }
  }

  async close(): Promise<void> {
    await this.watcher?.close();
  }

  private async scan(dir = this.root): Promise<void> {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.name.startsWith('.')) continue;
      if (ent.isDirectory()) await this.scan(abs);
      else if (ent.name.endsWith('.md')) await this.loadFile(abs, true);
    }
  }

  private async loadFile(abs: string, quiet = false): Promise<void> {
    const text = await fs.readFile(abs, 'utf8');
    if (this.written.get(abs) === sha(text)) return;
    const rel = path.relative(this.root, abs);
    const { data, body } = parseFrontmatter(text);
    const now = new Date().toISOString();
    const folder = path.dirname(rel) === '.' ? '' : path.dirname(rel).split(path.sep).join('/');
    const base = path.basename(rel, '.md');
    const needsId = typeof data.id !== 'string' || !data.id;
    const candidate = {
      ...data,
      id: needsId ? ulid() : data.id,
      title: data.title ?? base,
      slug: base,
      folder,
      markdown: body,
      createdAt: data.createdAt ?? now,
      updatedAt: data.updatedAt ?? now,
    };
    const parsed = NoteSchema.safeParse(candidate);
    if (!parsed.success) return; // invalid hand edit: keep previous state
    // drop any stale entry for this path
    for (const [id, v] of this.byId)
      if (v.rel === rel && id !== parsed.data.id) this.byId.delete(id);
    this.byId.set(parsed.data.id, { e: parsed.data, rel });
    if (needsId) await this.writeFile(parsed.data, rel);
    if (!quiet) this.emit('upsert', parsed.data as Entity);
  }

  private dropFile(abs: string): void {
    const rel = path.relative(this.root, abs);
    for (const [id, v] of this.byId) {
      if (v.rel === rel) {
        this.byId.delete(id);
        this.emit('remove', id);
      }
    }
  }

  private async writeFile(n: Note, rel: string): Promise<void> {
    const abs = path.join(this.root, rel);
    const text = serializeNote(n);
    this.written.set(abs, sha(text));
    await atomicWriteFile(abs, text);
  }

  private uniqueRel(folder: string, slug: string, selfId?: string): string {
    const taken = new Map([...this.byId.values()].map((v) => [v.rel, v.e.id]));
    for (let n = 1; ; n++) {
      const name = n === 1 ? slug : `${slug}-${n}`;
      const rel = path.posix.join(folder, `${name}.md`);
      const owner = taken.get(rel);
      if (!owner || owner === selfId) return rel;
    }
  }

  all = () => [...this.byId.values()].map((v) => v.e as Entity);
  get = (id: string) => this.byId.get(id)?.e as Entity | undefined;

  async reloadAll(): Promise<void> {
    this.byId.clear();
    await this.scan();
    this.emit('rebuild');
  }

  async create(input: unknown, opts?: { id?: string }): Promise<Entity> {
    if (!input || typeof input !== 'object')
      throw new AppError(400, 'VALIDATION', 'Body must be an object');
    const parsed = this.schemas.create.parse(input) as Record<string, unknown>;
    const title = String(parsed.title ?? '').trim();
    if (!title) throw new AppError(400, 'VALIDATION', 'title is required');
    const now = new Date().toISOString();
    const folder = safeFolder(String(parsed.folder ?? ''));
    const rel = this.uniqueRel(folder, slugify(title));
    const note = {
      ...parsed,
      title,
      folder,
      slug: path.posix.basename(rel, '.md'),
      id: opts?.id ?? ulid(),
      createdAt: now,
      updatedAt: now,
    } as Note;
    await this.writeFile(note, rel);
    this.byId.set(note.id, { e: note, rel });
    this.emit('upsert', note as Entity);
    return note as Entity;
  }

  async patch(id: string, input: unknown): Promise<Entity> {
    const cur = this.byId.get(id);
    if (!cur) throw notFound('notes', id);
    const patch = this.schemas.patch.parse(input ?? {}) as Record<string, unknown>;
    const merged = { ...cur.e, ...patch, id, createdAt: cur.e.createdAt } as Note;
    if (patch.folder !== undefined) merged.folder = safeFolder(String(patch.folder));
    merged.updatedAt = new Date().toISOString();
    const wantSlug = patch.title && !patch.slug ? slugify(String(patch.title)) : cur.e.slug;
    const rel = this.uniqueRel(merged.folder, wantSlug, id);
    merged.slug = path.posix.basename(rel, '.md');
    await this.writeFile(merged, rel);
    if (rel !== cur.rel) {
      const old = path.join(this.root, cur.rel);
      this.written.delete(old);
      await fs.rm(old, { force: true });
    }
    this.byId.set(id, { e: merged, rel });
    this.emit('upsert', merged as Entity);
    return merged as Entity;
  }

  async restore(entity: Entity): Promise<void> {
    const note = entity as unknown as Note;
    const cur = this.byId.get(note.id);
    const rel = this.uniqueRel(note.folder, note.slug, note.id);
    await this.writeFile(note, rel);
    if (cur && cur.rel !== rel) {
      const old = path.join(this.root, cur.rel);
      this.written.delete(old);
      await fs.rm(old, { force: true });
    }
    this.byId.set(note.id, { e: note, rel });
    this.emit('upsert', note as Entity);
  }

  async remove(id: string): Promise<void> {
    const cur = this.byId.get(id);
    if (!cur) throw notFound('notes', id);
    await fs.rm(path.join(this.root, cur.rel), { force: true });
    this.byId.delete(id);
    this.emit('remove', id);
  }
}
