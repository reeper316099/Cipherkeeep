import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { atomicWriteFile, stableStringify } from './atomic.ts';
import type { BackupManager } from './backup.ts';
import { CodecHolder, EncryptionError } from './codec.ts';
import { JsonStoreError, jsonErrorLine } from './errors.ts';
import { KeyedMutex } from './mutex.ts';

export interface Validator<T> {
  parse(input: unknown): T;
}

export interface JsonFileOptions<T> {
  version: number;
  defaults: () => T;
  validator?: Validator<T>;
  /** migrations[n] upgrades data from version n to n+1. */
  migrations?: Record<number, (data: unknown) => unknown>;
  /** Extra validation hook; throw to reject. */
  validate?: (data: T) => void;
}

interface Doc {
  schemaVersion: number;
  data: unknown;
}

const sha = (s: string | Uint8Array) => createHash('sha1').update(s).digest('hex');

export interface StoreEvents {
  /** A file was changed on disk by someone else and reloaded. */
  reload: [rel: string];
  /** An external edit was invalid; in-memory state was kept. */
  invalid: [info: { rel: string; message: string; line?: number }];
  /** A corrupt file was moved aside. */
  quarantine: [info: { rel: string; movedTo: string; restored: boolean }];
}

export class JsonStore extends EventEmitter<StoreEvents> {
  readonly mutex = new KeyedMutex();
  private files = new Map<string, JsonFile<unknown>>();
  private watcher?: FSWatcher;
  /** At-rest encoding for every file this store reads or writes (identity unless encryption is on). */
  readonly codec: CodecHolder;

  constructor(
    readonly dir: string,
    readonly backups?: BackupManager,
    codec?: CodecHolder,
  ) {
    super();
    this.codec = codec ?? new CodecHolder();
  }

  /** Open file handles (the ones with in-memory state). */
  openFiles(): JsonFile<unknown>[] {
    return [...this.files.values()];
  }

  /** Rewrite every open file through the current codec (used when encryption is switched on or off). */
  async rewriteAll(): Promise<void> {
    for (const f of this.files.values()) await this.mutex.run(f.rel, () => f.writeLocked(f.data));
  }

  abs(rel: string): string {
    const full = path.resolve(this.dir, rel);
    if (full !== this.dir && !full.startsWith(path.resolve(this.dir) + path.sep)) {
      throw new JsonStoreError('Path escapes data directory', 'PATH_TRAVERSAL', rel);
    }
    return full;
  }

  async open<T>(rel: string, opts: JsonFileOptions<T>): Promise<JsonFile<T>> {
    const existing = this.files.get(rel);
    if (existing) return existing as JsonFile<T>;
    const f = new JsonFile<T>(this, rel, opts);
    await f.load();
    this.files.set(rel, f as JsonFile<unknown>);
    return f;
  }

  get(rel: string): JsonFile<unknown> | undefined {
    return this.files.get(rel);
  }

  /** Forget a file handle (e.g. an emptied shard) without deleting it. */
  forget(rel: string): void {
    this.files.delete(rel);
  }

  async watch(): Promise<void> {
    if (this.watcher) return;
    this.watcher = chokidar.watch(this.dir, {
      ignoreInitial: true,
      ignored: (p) => path.basename(p).startsWith('.'),
      ignorePermissionErrors: true,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
    });
    const onChange = (p: string) => {
      const rel = path.relative(this.dir, p);
      const f = this.files.get(rel);
      if (f) void f.reloadExternal();
    };
    this.watcher.on('change', onChange).on('add', onChange);
    // A path that cannot be watched (a socket, a permission error) must never crash or stall startup.
    this.watcher.on('error', () => undefined);
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      this.watcher!.once('ready', done);
      setTimeout(done, 1500).unref();
    });
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.watcher = undefined;
  }

  /**
   * Atomically apply `fn` across several files (e.g. moving an item between shards).
   * All writes succeed or previously written files are rolled back.
   */
  async transaction<T>(
    files: JsonFile<T>[],
    fn: (datas: T[]) => void | Promise<void>,
  ): Promise<void> {
    const unique = [...new Set(files)].sort((a, b) => (a.rel < b.rel ? -1 : 1));
    const run = async (i: number): Promise<void> => {
      if (i < unique.length) return this.mutex.run(unique[i]!.rel, () => run(i + 1));
      const drafts = files.map((f) => structuredClone(f.data));
      await fn(drafts);
      const validated = files.map((f, k) => f.check(drafts[k]!));
      const written: { f: JsonFile<T>; prevText: string; prevData: T }[] = [];
      try {
        for (const [k, f] of files.entries()) {
          written.push({ f, prevText: f.lastText, prevData: f.data });
          await f.writeLocked(validated[k]!);
        }
      } catch (err) {
        for (const w of written.reverse()) {
          await atomicWriteFile(this.abs(w.f.rel), this.codec.encodeText(w.prevText)).catch(
            () => undefined,
          );
          w.f.setState(w.prevData, w.prevText);
        }
        throw err;
      }
    };
    await run(0);
  }
}

export class JsonFile<T> {
  data!: T;
  lastText = '';
  private lastHash = '';

  constructor(
    readonly store: JsonStore,
    readonly rel: string,
    readonly opts: JsonFileOptions<T>,
  ) {}

  get path(): string {
    return this.store.abs(this.rel);
  }

  /** `text` is the plain JSON; `raw` the bytes as stored (they differ when encrypted). */
  setState(data: T, text: string, raw: string | Uint8Array = text): void {
    this.data = data;
    this.lastText = text;
    this.lastHash = sha(raw);
  }

  check(candidate: T): T {
    const v = this.opts.validator ? this.opts.validator.parse(candidate) : candidate;
    this.opts.validate?.(v);
    return v;
  }

  /** Initial load: handles missing, corrupt (quarantine + restore), migration. */
  async load(): Promise<void> {
    let raw: Buffer | null = null;
    try {
      raw = await fs.readFile(this.path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    let text: string | null = null;
    if (raw) {
      // A locked or wrongly keyed file is never "corrupt": do not quarantine it or replace it with defaults.
      try {
        text = this.store.codec.decodeText(raw);
      } catch (e) {
        if (e instanceof EncryptionError) throw new EncryptionError(e.code as never, this.rel);
        throw e;
      }
    }
    if (text === null) {
      await this.store.mutex.run(this.rel, () =>
        this.writeLocked(this.check(this.opts.defaults())),
      );
      return;
    }
    try {
      await this.ingest(text, false, raw!);
    } catch (err) {
      if (err instanceof JsonStoreError && err.code === 'VERSION_TOO_NEW') throw err;
      await this.quarantineAndRecover(raw!);
    }
  }

  /** Called by the watcher. Invalid hand-edits never replace in-memory state. */
  async reloadExternal(): Promise<void> {
    await this.store.mutex.run(this.rel, async () => {
      let raw: Buffer;
      let text: string;
      try {
        raw = await fs.readFile(this.path);
      } catch {
        return;
      }
      if (sha(raw) === this.lastHash) return; // our own write
      try {
        text = this.store.codec.decodeText(raw);
      } catch (err) {
        this.store.emit('invalid', {
          rel: this.rel,
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      try {
        await this.ingest(text, true, raw);
        this.store.emit('reload', this.rel);
      } catch (err) {
        const line = err instanceof JsonStoreError ? err.line : jsonErrorLine(text, err);
        this.store.emit('invalid', {
          rel: this.rel,
          message: err instanceof Error ? err.message : String(err),
          line,
        });
      }
    });
  }

  async update(fn: (draft: T) => T | void | Promise<T | void>): Promise<T> {
    return this.store.mutex.run(this.rel, async () => {
      const draft = structuredClone(this.data);
      const next = (await fn(draft)) ?? draft;
      const valid = this.check(next as T);
      await this.writeLocked(valid);
      return valid;
    });
  }

  async writeLocked(valid: T): Promise<void> {
    const text = stableStringify({ schemaVersion: this.opts.version, data: valid });
    const raw = this.store.codec.encodeText(text);
    await atomicWriteFile(this.path, raw);
    this.setState(valid, text, raw);
  }

  /** Parse, migrate and validate `text`; on success replace in-memory state. */
  private async ingest(
    text: string,
    external = false,
    raw: string | Uint8Array = text,
  ): Promise<void> {
    let doc: Doc;
    try {
      doc = JSON.parse(text) as Doc;
    } catch (e) {
      throw new JsonStoreError(
        `Invalid JSON: ${(e as Error).message}`,
        'INVALID_JSON',
        this.rel,
        jsonErrorLine(text, e),
      );
    }
    if (
      !doc ||
      typeof doc !== 'object' ||
      typeof doc.schemaVersion !== 'number' ||
      !('data' in doc)
    ) {
      throw new JsonStoreError('Missing schemaVersion/data envelope', 'INVALID_ENVELOPE', this.rel);
    }
    if (doc.schemaVersion > this.opts.version) {
      throw new JsonStoreError(
        `File schema v${doc.schemaVersion} is newer than supported v${this.opts.version}`,
        'VERSION_TOO_NEW',
        this.rel,
      );
    }
    let data = doc.data;
    const from = doc.schemaVersion;
    for (let v = from; v < this.opts.version; v++) {
      const step = this.opts.migrations?.[v];
      if (!step) throw new JsonStoreError(`No migration from v${v}`, 'MISSING_MIGRATION', this.rel);
      data = step(data);
    }
    const valid = this.check(data as T);
    if (from < this.opts.version) {
      await this.store.backups?.create('pre-migration');
      await this.writeLocked(valid);
      return;
    }
    this.setState(valid, text, raw);
    void external;
  }

  private async quarantineAndRecover(badRaw: Buffer): Promise<void> {
    const qdir = path.join(this.store.dir, '.quarantine');
    await fs.mkdir(qdir, { recursive: true });
    const movedTo = path.join(qdir, `${this.rel.replace(/[\\/]/g, '__')}.${Date.now()}.bad`);
    await fs.writeFile(movedTo, badRaw);
    await fs.rm(this.path, { force: true });
    let restored = false;
    const bytes = await this.store.backups?.readFromLatest(this.rel);
    if (bytes) {
      try {
        const plain = this.store.codec.decodeText(bytes);
        await this.ingest(plain, false, bytes);
        await this.store.mutex.run(this.rel, () => this.writeLocked(this.data));
        restored = true;
      } catch {
        /* fall through to defaults */
      }
    }
    if (!restored)
      await this.store.mutex.run(this.rel, () =>
        this.writeLocked(this.check(this.opts.defaults())),
      );
    this.store.emit('quarantine', { rel: this.rel, movedTo, restored });
  }
}
