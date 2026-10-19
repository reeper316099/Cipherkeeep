import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  BackupManager,
  JsonStore,
  acquireInstanceLock,
  atomicWriteJson,
  type InstanceLock,
  type JsonFile,
} from '@cipherkeep/jsonstore';
import { APP_NAME, COLLECTIONS, type CollectionName } from '@cipherkeep/shared';
import { ActivityLog } from './activity.ts';
import {
  CategoriesSchema,
  DEFAULT_CATEGORIES,
  DEFAULT_SKILLS,
  migrateSkillsV1,
  SettingsSchema,
  SkillsSchema,
  type Categories,
  type Settings,
} from './config-files.ts';
import { NoteRepo } from './notes.ts';
import { JsonRepo, type Repo } from './repo.ts';
import { LinkIndex } from './links.ts';
import { SearchIndex } from './search.ts';
import { StudyService } from './study.ts';

export const DATA_VERSION = 1;

export interface Context {
  dataDir: string;
  store: JsonStore;
  backups: BackupManager;
  repos: Record<CollectionName, Repo>;
  search: SearchIndex;
  links: LinkIndex;
  study: StudyService;
  activity: ActivityLog;
  settings: JsonFile<Settings>;
  categories: JsonFile<Categories>;
  skills: JsonFile<z.infer<typeof SkillsSchema>>;
  /** Emits: change {collection,id,kind}, invalid, quarantine, reload. */
  bus: EventEmitter;
  reloadAll(): Promise<void>;
  close(): Promise<void>;
}

export async function createContext(opts: { dataDir: string; watch?: boolean }): Promise<Context> {
  const dataDir = path.resolve(opts.dataDir);
  await fs.mkdir(dataDir, { recursive: true });
  const lock: InstanceLock = await acquireInstanceLock(dataDir);
  try {
    const backups = new BackupManager({ dataDir, backupDir: path.join(dataDir, 'backups') });
    const store = new JsonStore(dataDir, backups);
    const bus = new EventEmitter();
    store.on('invalid', (i) => bus.emit('invalid', i));
    store.on('quarantine', (i) => bus.emit('quarantine', i));
    store.on('reload', (rel) => bus.emit('reload', rel));

    const metaPath = path.join(dataDir, 'meta.json');
    try {
      await fs.access(metaPath);
    } catch {
      await atomicWriteJson(metaPath, {
        appName: APP_NAME,
        dataVersion: DATA_VERSION,
        createdAt: new Date().toISOString(),
      });
    }
    await backups.createIfStale(6, 'launch').catch(() => undefined);

    const settings = await store.open<Settings>('config/settings.json', {
      version: 1,
      defaults: () => SettingsSchema.parse({}),
      validator: SettingsSchema,
    });
    const categories = await store.open<Categories>('config/categories.json', {
      version: 1,
      defaults: () => DEFAULT_CATEGORIES,
      validator: CategoriesSchema,
    });
    const skills = await store.open('config/skills.json', {
      version: 2,
      defaults: () => DEFAULT_SKILLS,
      validator: SkillsSchema,
      migrations: { 1: migrateSkillsV1 },
    });

    const repos = {} as Record<CollectionName, Repo>;
    for (const name of COLLECTIONS) {
      repos[name] =
        name === 'notes' ? new NoteRepo(dataDir, opts.watch ?? true) : new JsonRepo(store, name);
      await repos[name].init();
    }
    const search = new SearchIndex();
    for (const name of COLLECTIONS) {
      const r = repos[name];
      search.attach(r);
      r.on('upsert', (e) => bus.emit('change', { collection: name, id: e.id, kind: 'upsert' }));
      r.on('remove', (id) => bus.emit('change', { collection: name, id, kind: 'remove' }));
      r.on('rebuild', () => bus.emit('change', { collection: name, kind: 'rebuild' }));
    }
    if (opts.watch ?? true) await store.watch();

    const activity = new ActivityLog(store);
    const study = new StudyService({ store, repos, activity, settings });
    return {
      dataDir,
      store,
      backups,
      repos,
      search,
      links: new LinkIndex(repos),
      settings,
      categories,
      skills,
      bus,
      activity,
      study,
      async reloadAll() {
        for (const name of COLLECTIONS) await repos[name].reloadAll();
      },
      async close() {
        await store.close();
        for (const name of COLLECTIONS) await repos[name].close?.();
        await lock.release();
      },
    };
  } catch (err) {
    await lock.release();
    throw err;
  }
}
