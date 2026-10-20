import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ulid } from 'ulid';
import { readTextDecoded, writeEncoded, writeJsonEncoded } from '@cipherkeep/jsonstore';
import { COLLECTIONS, SCHEMAS, normalizeTitle, type CollectionName } from '@cipherkeep/shared';
import type { Context } from '../context.ts';
import type { Entity } from '../repo.ts';
import { AppError, notFound } from '../util.ts';
import type { VirtualFs } from './source.ts';
import type {
  ImportManifest,
  ImportOptions,
  ImportReport,
  Plan,
  PlanItem,
  RelTarget,
  Strategy,
} from './types.ts';

const isEmpty = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const SKIP_KEYS = new Set(['id', 'createdAt', 'updatedAt', 'importRef', 'slug']);
const RELATION_LINK: Record<string, string> = {
  relatedCommandIds: 'command',
  commandIds: 'command',
  conceptIds: 'concept',
  relatedConceptIds: 'concept',
  labIds: 'lab',
  scriptIds: 'snippet',
};

/** Fields to write for an existing entity under the chosen strategy. */
function mergePatch(
  existing: Entity,
  incoming: Record<string, unknown>,
  strategy: Strategy,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (SKIP_KEYS.has(k) || v === undefined) continue;
    const cur = existing[k];
    if (strategy === 'overwrite') {
      if (!same(cur, v)) patch[k] = v;
    } else if (k === 'tags' || k === 'links' || RELATION_LINK[k]) {
      // collections: union, never remove what the user has
      const union = [...(Array.isArray(cur) ? cur : [])];
      for (const x of v as unknown[]) if (!union.some((y) => same(x, y))) union.push(x);
      if (union.length !== (Array.isArray(cur) ? cur.length : 0)) patch[k] = union;
    } else if (k === 'extras') {
      const merged = { ...(v as object), ...(cur as object) };
      if (!same(merged, cur)) patch[k] = merged;
    } else if (isEmpty(cur) && !isEmpty(v)) patch[k] = v;
  }
  return patch;
}

function importId(): string {
  return (
    new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '') +
    '-' +
    ulid().slice(-6).toLowerCase()
  );
}

export function existingLookup(ctx: Context) {
  const maps = new Map<CollectionName, Map<string, string>>();
  for (const c of COLLECTIONS) {
    const m = new Map<string, string>();
    for (const e of ctx.repos[c].all()) {
      const k = normalizeTitle(String(c === 'commands' ? (e.name ?? e.title) : e.title));
      if (!m.has(k)) m.set(k, e.id);
    }
    maps.set(c, m);
  }
  return { find: (c: CollectionName, k: string) => maps.get(c)?.get(k) };
}

export async function commitPlan(
  ctx: Context,
  plan: Plan,
  opts: ImportOptions,
  source?: { vfs?: VirtualFs; zip?: Buffer; zipName?: string },
): Promise<ImportReport> {
  const id = importId();
  const dir = path.join(ctx.dataDir, 'imports', id);
  await fs.mkdir(dir, { recursive: true });
  const snapshot = (await ctx.backups.create('pre-import')).name;

  // -- effective items after overrides
  const skipped: ImportReport['skipped'] = [];
  const effective: PlanItem[] = [];
  for (const it of plan.items) {
    const o = opts.overrides?.[it.ref];
    if (o === 'skip') {
      skipped.push({ ref: it.ref, title: it.title, reason: 'skipped by you' });
      continue;
    }
    let item = it;
    if ((o === 'note' || o === 'snippet' || o === 'include') && it.alternatives) {
      const c: CollectionName = o === 'snippet' ? 'snippets' : 'notes';
      item = { ...it, collection: c, input: it.alternatives[c] ?? it.input };
    } else if (it.skipByDefault && o !== 'include') {
      skipped.push({ ref: it.ref, title: it.title, reason: it.skipByDefault });
      continue;
    }
    effective.push(item);
  }

  // -- match against what is already stored
  const byRef = new Map<string, Entity>();
  const byTitle = new Map<string, Entity>();
  const titleKey = (c: CollectionName, e: { title: string; folder?: unknown; name?: unknown }) =>
    `${c}|${c === 'notes' ? String(e.folder ?? '') + '/' : ''}${normalizeTitle(String(c === 'commands' ? (e.name ?? e.title) : e.title))}`;
  for (const c of COLLECTIONS) {
    for (const e of ctx.repos[c].all()) {
      if (e.importRef) byRef.set(`${c}|${e.importRef}`, e);
      byTitle.set(titleKey(c, e as never), e);
    }
  }
  const findExisting = (it: PlanItem): Entity | undefined => {
    if (opts.strategy === 'keep-both') return undefined;
    if (it.fixedId) {
      const hit = ctx.repos[it.collection].get(it.fixedId);
      if (hit) return hit;
    }
    return (
      byRef.get(`${it.collection}|${it.ref}`) ??
      byTitle.get(
        titleKey(it.collection, { title: it.title, folder: it.input.folder, name: it.input.name }),
      )
    );
  };

  const refToId = new Map<string, string>();
  const plans = effective.map((it) => {
    const existing = findExisting(it);
    const newId = existing?.id ?? it.fixedId ?? ulid();
    refToId.set(it.ref, newId);
    return { it, existing, id: newId };
  });

  const created: Record<string, number> = {};
  const updated: Record<string, number> = {};
  const unchanged: Record<string, number> = {};
  const bump = (m: Record<string, number>, c: string) => void (m[c] = (m[c] ?? 0) + 1);
  const manifest: ImportManifest = {
    id,
    createdAt: new Date().toISOString(),
    created: [],
    updated: [],
    templates: [],
    attachments: [],
  };
  const resolveTargets = (ts: RelTarget[]) =>
    ts.map((t) => ('id' in t ? t.id : refToId.get(t.ref))).filter((x): x is string => !!x);

  for (const { it, existing, id: eid } of plans) {
    const input: Record<string, unknown> = { ...it.input };
    for (const rel of it.relations) {
      const ids = resolveTargets(rel.targets);
      if (!ids.length) continue;
      if (rel.field.startsWith('links:')) {
        const type = rel.field.slice(6);
        input.links = [
          ...((input.links as unknown[]) ?? []),
          ...ids.map((targetId) => ({ type, targetId })),
        ];
      } else {
        input[rel.field] = ids;
        const lt = RELATION_LINK[rel.field];
        if (lt)
          input.links = [
            ...((input.links as unknown[]) ?? []),
            ...ids.map((targetId) => ({ type: lt, targetId })),
          ];
      }
    }
    if (opts.strategy !== 'keep-both') input.importRef = it.ref;
    const repo = ctx.repos[it.collection];
    if (opts.strategy === 'skip' && existing) {
      skipped.push({ ref: it.ref, title: it.title, reason: 'already exists' });
      continue;
    }
    if (!existing) {
      if (it.fixedId && it.input.createdAt) {
        const full = SCHEMAS[it.collection].parse({ ...input, id: eid }) as Entity;
        await repo.restore(full);
      } else {
        await repo.create(input, { id: eid });
      }
      manifest.created.push({ collection: it.collection, id: eid });
      bump(created, it.collection);
      continue;
    }
    const patch = mergePatch(existing, input, opts.strategy);
    if (Object.keys(patch).length === 0) {
      bump(unchanged, it.collection);
      continue;
    }
    manifest.updated.push({
      collection: it.collection,
      id: eid,
      before: structuredClone(existing),
    });
    await repo.patch(eid, patch);
    bump(updated, it.collection);
  }

  // -- templates
  const written: string[] = [];
  for (const t of plan.templates) {
    const file = ctx.store.abs(`config/templates/${t.collection}.json`);
    let before: string | null = null;
    try {
      before = await readTextDecoded(ctx.store.codec, file);
    } catch {
      /* none yet */
    }
    if (before && opts.strategy !== 'overwrite') continue;
    manifest.templates.push({ collection: t.collection, before });
    await writeJsonEncoded(ctx.store.codec, file, t.template);
    written.push(t.collection);
  }

  // -- attachments
  let copied = 0;
  if (source?.vfs) {
    for (const a of plan.attachments) {
      const data = source.vfs.files.get(a.from);
      if (!data) continue;
      const target = ctx.store.abs(path.join('attachments', ...a.to.split('/')));
      try {
        await fs.access(target);
        continue;
      } catch {
        /* new file */
      }
      await writeEncoded(ctx.store.codec, target, data);
      manifest.attachments.push(path.join('attachments', ...a.to.split('/')));
      copied++;
    }
  }

  for (const c of new Set([...Object.keys(created), ...Object.keys(updated)])) {
    await ctx.activity.record({ type: 'import', collection: c }).catch(() => undefined);
  }

  const report: ImportReport = {
    id,
    kind: plan.kind,
    sourceName: plan.sourceName,
    strategy: opts.strategy,
    createdAt: manifest.createdAt,
    created,
    updated,
    unchanged,
    skipped,
    templates: written,
    attachments: copied,
    warnings: plan.warnings,
    itemWarnings: effective
      .filter((i) => i.warnings.length)
      .map((i) => ({ collection: i.collection, title: i.title, warnings: i.warnings })),
    snapshot,
  };
  await writeJsonEncoded(ctx.store.codec, path.join(dir, 'manifest.json'), manifest);
  await writeJsonEncoded(ctx.store.codec, path.join(dir, 'report.json'), report);
  if (source?.zip)
    await writeEncoded(
      ctx.store.codec,
      path.join(dir, source.zipName?.replace(/[^\w. -]/g, '_') || 'source.zip'),
      source.zip,
    );
  return report;
}

export async function undoImport(
  ctx: Context,
  importIdParam: string,
): Promise<{ removed: number; restored: number }> {
  if (!/^[\w-]+$/.test(importIdParam)) throw new AppError(400, 'VALIDATION', 'Bad import id');
  const file = path.join(ctx.dataDir, 'imports', importIdParam, 'manifest.json');
  let manifest: ImportManifest;
  try {
    manifest = JSON.parse(await readTextDecoded(ctx.store.codec, file)) as ImportManifest;
  } catch {
    throw notFound('import', importIdParam);
  }
  if (manifest.undone) throw new AppError(409, 'ALREADY_UNDONE', 'This import was already undone');
  await ctx.backups.create('pre-undo');
  let removed = 0;
  let restored = 0;
  for (const c of [...manifest.created].reverse()) {
    if (ctx.repos[c.collection].get(c.id)) {
      await ctx.repos[c.collection].remove(c.id);
      removed++;
    }
  }
  for (const u of manifest.updated) {
    await ctx.repos[u.collection].restore(u.before as Entity);
    restored++;
  }
  for (const t of manifest.templates) {
    const f = ctx.store.abs(`config/templates/${t.collection}.json`);
    if (t.before === null) await fs.rm(f, { force: true });
    else await writeEncoded(ctx.store.codec, f, t.before);
  }
  for (const a of manifest.attachments) await fs.rm(ctx.store.abs(a), { force: true });
  manifest.undone = new Date().toISOString();
  await writeJsonEncoded(ctx.store.codec, file, manifest);
  return { removed, restored };
}

export async function listImports(ctx: Context): Promise<ImportReport[]> {
  const dir = path.join(ctx.dataDir, 'imports');
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: ImportReport[] = [];
  for (const n of names.sort().reverse()) {
    try {
      out.push(
        JSON.parse(
          await readTextDecoded(ctx.store.codec, path.join(dir, n, 'report.json')),
        ) as ImportReport,
      );
    } catch {
      /* skip */
    }
  }
  return out;
}
