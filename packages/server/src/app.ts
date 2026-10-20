import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyServerFactory,
} from 'fastify';
import { ZodError, z } from 'zod';
import { APP_NAME, COLLECTIONS, sanitizeWriteup, type CollectionName } from '@cipherkeep/shared';
import type { Context } from './context.ts';
import {
  CategoriesSchema,
  DEFAULT_TEMPLATES,
  SettingsSchema,
  SkillsSchema,
  TemplateSchema,
} from './config-files.ts';
import { normalizeEncryption } from './encryption.ts';
import { buildOverview } from './overview.ts';
import { registerVaultRoutes, type VaultControls } from './vault-routes.ts';
import { planStarter, starterCounts, STARTER_REF_PREFIX } from './starter.ts';
import type { ListQuery } from './repo.ts';
import { queryEntities } from './repo.ts';
import { AppError, notFound } from './util.ts';
import {
  readDecoded,
  readTextDecoded,
  writeEncoded,
  writeJsonEncoded,
} from '@cipherkeep/jsonstore';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import multipart from '@fastify/multipart';
import { exportCsv, exportJson, exportMarkdown, csvTemplate } from './export.ts';
import {
  PreviewStore,
  buildPlan,
  commitPlan,
  fromPath,
  fromUpload,
  listImports,
  undoImport,
  type Plan,
  type VirtualFs,
} from './import/index.ts';
import { NotionApiError, NotionJobs, type FetchFn } from './import/notion-api.ts';

export const UI_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serves a file from `root` (never outside it); extension-less paths fall back to index.html (client-side routes). */
async function serveStatic(root: string, url: string, reply: FastifyReply): Promise<boolean> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.split('?')[0]!.split('#')[0]!);
  } catch {
    return false;
  }
  if (pathname.includes('\0')) return false;
  const base = path.resolve(root);
  let file = path.resolve(base, '.' + path.posix.normalize('/' + pathname));
  if (file !== base && !file.startsWith(base + path.sep)) return false;
  let ext = path.extname(file).toLowerCase();
  if (!ext || pathname.endsWith('/')) {
    file = path.join(base, 'index.html');
    ext = '.html';
  }
  let data: Buffer;
  try {
    data = await fs.readFile(file);
  } catch {
    return false;
  }
  reply
    .header('content-type', MIME[ext] ?? 'application/octet-stream')
    .header('content-security-policy', UI_CSP)
    .header('x-content-type-options', 'nosniff')
    .header('referrer-policy', 'no-referrer')
    .header(
      'cache-control',
      file.includes(`${path.sep}assets${path.sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
    );
  await reply.send(data);
  return true;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

export interface AppOptions {
  ctx: Context;
  token: string;
  /** Built web bundle to serve at `/` (the desktop app). The API under /api still needs the bearer token. */
  staticDir?: string;
  /** Extra Host header values accepted (the bound host:port is always accepted). */
  logger?: boolean;
  /** Encryption-at-rest controls (set by `startServer`; absent when the app is embedded without a lifecycle). */
  vault?: VaultControls;
  /** Test hook: replaces the network for the optional Notion API import. */
  notionFetch?: FetchFn;
  /** Lets `startServer` own the listening socket so it can swap this app for the locked one at runtime. */
  serverFactory?: ServerFactory;
}

/** Bulky fields a list response may leave out (the UI fetches them on demand with GET /:id). */
const OMITTABLE = new Set([
  'markdown',
  'sections',
  'writeup',
  'body',
  'notes',
  'code',
  'whatItDoes',
]);

const ListSchema = z.object({
  omit: z
    .string()
    .regex(/^[A-Za-z]+(,[A-Za-z]+)*$/)
    .refine((v) => v.split(',').every((f) => OMITTABLE.has(f)), 'unsupported field in omit')
    .optional(),
  q: z.string().optional(),
  category: z.string().optional(),
  tag: z.string().optional(),
  favorite: z.enum(['true', 'false']).optional(),
  archived: z.enum(['true', 'false', 'all']).optional(),
  sort: z
    .string()
    .regex(/^[A-Za-z]+$/)
    .optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const BulkSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('delete'), ids: z.array(z.string()).min(1).max(1000) }),
  z.object({
    op: z.literal('patch'),
    ids: z.array(z.string()).min(1).max(1000),
    patch: z.record(z.unknown()),
  }),
]);

const collectionParam = (v: unknown): CollectionName => {
  if ((COLLECTIONS as readonly string[]).includes(String(v))) return v as CollectionName;
  throw new AppError(404, 'NOT_FOUND', `Unknown collection: ${String(v)}`);
};

type ServerFactory = FastifyServerFactory;

function previewResponse(plan: Plan, previewId: string) {
  const counts: Record<string, number> = {};
  for (const it of plan.items) counts[it.collection] = (counts[it.collection] ?? 0) + 1;
  return {
    previewId,
    kind: plan.kind,
    sourceName: plan.sourceName,
    counts,
    databases: plan.databases,
    templates: plan.templates.map((t) => ({
      collection: t.collection,
      name: t.template.name,
      sections: t.template.sections.length,
    })),
    attachments: plan.attachments.length,
    warnings: plan.warnings,
    items: plan.items.map((i) => ({
      ref: i.ref,
      collection: i.collection,
      title: i.title,
      source: i.source,
      warnings: i.warnings,
      skipByDefault: i.skipByDefault,
      alternatives: i.alternatives ? Object.keys(i.alternatives) : undefined,
    })),
  };
}

/** The pieces both the unlocked and the locked app share: ids, logging, host and token guards, errors, static UI. */
export function createBaseApp({
  token,
  staticDir,
  logger = false,
  serverFactory,
}: {
  token: string;
  staticDir?: string;
  logger?: boolean;
  serverFactory?: ServerFactory;
}): FastifyInstance {
  const want = digest(token);
  const app = Fastify({
    genReqId: () => randomUUID(),
    // Open SSE streams must not stall shutdown (app quit / data-folder switch).
    forceCloseConnections: true,
    ...(serverFactory ? { serverFactory } : {}),
    logger: logger
      ? {
          level: 'info',
          // Never log bodies or query strings (search terms can contain note content).
          serializers: {
            req: (r) => ({ method: r.method, path: String(r.url).split('?')[0] }),
          },
        }
      : false,
    bodyLimit: 20 * 1024 * 1024,
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('cache-control', 'no-store');
    // DNS-rebinding guard: only loopback hosts.
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
      throw new AppError(403, 'BAD_HOST', 'Forbidden host');
    }
    // The UI shell is public on loopback; everything under /api needs the per-launch token.
    if (staticDir && !req.url.startsWith('/api/')) return;
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!m || !timingSafeEqual(digest(m[1]!), want)) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing or invalid bearer token');
    }
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    const body = (status: number, code: string, message: string, details?: unknown) =>
      reply.status(status).send({ error: { code, message, requestId: req.id, details } });
    if (err instanceof ZodError) return body(400, 'VALIDATION', 'Invalid request', err.issues);
    if (err instanceof AppError) return body(err.status, err.code, err.message, err.details);
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode && e.statusCode < 500)
      return body(e.statusCode, e.code ?? 'BAD_REQUEST', e.message ?? 'Bad request');
    req.log.error({ err: { name: (err as Error).name, code: e.code } }, 'unhandled error');
    return body(500, 'INTERNAL', 'Internal error');
  });
  app.setNotFoundHandler(async (req, reply) => {
    if (
      staticDir &&
      (req.method === 'GET' || req.method === 'HEAD') &&
      !req.url.startsWith('/api/')
    ) {
      if (await serveStatic(staticDir, req.url, reply)) return;
    }
    return reply
      .status(404)
      .send({ error: { code: 'NOT_FOUND', message: 'No such route', requestId: req.id } });
  });
  return app;
}

/** What the app serves while an encrypted library is locked: the UI shell, the unlock endpoint, and 423 for the rest. */
export async function buildLockedApp(
  opts: Omit<AppOptions, 'ctx'> & { vault: VaultControls },
): Promise<FastifyInstance> {
  const app = createBaseApp(opts);
  await app.register(
    async (api) => {
      api.get('/health', async () => ({ status: 'ok', locked: true }));
      registerVaultRoutes(api, opts.vault, 'locked');
      api.all('/*', async () => {
        throw new AppError(423, 'LOCKED', 'Unlock your library to continue');
      });
    },
    { prefix: '/api/v1' },
  );
  return app;
}

export async function buildApp({
  ctx,
  token,
  staticDir,
  logger = false,
  vault,
  serverFactory,
  notionFetch,
}: AppOptions): Promise<FastifyInstance> {
  const app = createBaseApp({ token, staticDir, logger, serverFactory });
  if (vault) {
    // While the library is being (en/de)crypted, other requests wait out rather than race the rewrite.
    app.addHook('onRequest', async (req) => {
      if (vault.busy() && !req.url.startsWith('/api/v1/vault') && req.url.startsWith('/api/'))
        throw new AppError(503, 'BUSY', 'Encryption change in progress; try again in a moment');
    });
  }

  const previews = new PreviewStore();
  await app.register(
    async (api) => {
      await api.register(multipart, {
        limits: { fileSize: 500 * 1024 * 1024, files: 1, fields: 10 },
      });
      api.get('/health', async () => ({ status: 'ok' }));
      if (vault) registerVaultRoutes(api, vault, 'open');
      else api.get('/vault', async () => ({ enabled: false, locked: false, busy: false }));
      api.get('/meta', async () => ({
        appName: APP_NAME,
        apiVersion: 1,
        collections: COLLECTIONS,
        counts: Object.fromEntries(COLLECTIONS.map((c) => [c, ctx.repos[c].all().length])),
      }));

      // ---- collections ----
      for (const name of COLLECTIONS) {
        const repo = ctx.repos[name];
        const act = (type: 'create' | 'update' | 'delete', id: string) =>
          ctx.activity.record({ type, collection: name, id }).catch(() => undefined);

        api.get(`/${name}`, async (req) => {
          const p = ListSchema.parse(req.query);
          const q: ListQuery = {
            ...p,
            favorite: p.favorite === undefined ? undefined : p.favorite === 'true',
          };
          if (p.q) {
            q.ids = ctx.search.search(p.q, { types: [name], limit: 500 }).map((h) => h.id);
          }
          const page = queryEntities(repo.all(), q);
          if (!p.omit) return page;
          const drop = p.omit.split(',');
          return {
            ...page,
            items: page.items.map((e) =>
              Object.fromEntries(Object.entries(e).filter(([k]) => !drop.includes(k))),
            ),
          };
        });
        api.get(`/${name}/:id`, async (req) => {
          const { id } = req.params as { id: string };
          const e = repo.get(id);
          if (!e) throw notFound(name, id);
          return e;
        });
        api.post(`/${name}`, async (req, reply) => {
          const e = await repo.create(req.body);
          await act('create', e.id);
          return reply.status(201).send(e);
        });
        api.patch(`/${name}/:id`, async (req) => {
          const { id } = req.params as { id: string };
          const e = await repo.patch(id, req.body);
          await act('update', id);
          return e;
        });
        api.delete(`/${name}/:id`, async (req, reply) => {
          const { id } = req.params as { id: string };
          await repo.remove(id);
          await act('delete', id);
          return reply.status(204).send();
        });
        api.post(`/${name}/bulk`, async (req) => {
          const b = BulkSchema.parse(req.body);
          const missing = b.ids.filter((id) => !repo.get(id));
          if (missing.length)
            throw new AppError(404, 'NOT_FOUND', 'Some ids do not exist', missing);
          if (b.op === 'delete') await ctx.backups.create('pre-bulk-delete');
          for (const id of b.ids) {
            if (b.op === 'delete') await repo.remove(id);
            else await repo.patch(id, b.patch);
            await act(b.op === 'delete' ? 'delete' : 'update', id);
          }
          return { affected: b.ids.length };
        });
      }

      // ---- search ----
      api.get('/search', async (req) => {
        const p = z
          .object({
            q: z.string().default(''),
            type: z.string().optional(),
            limit: z.coerce.number().int().min(1).max(1000).default(50),
          })
          .parse(req.query);
        const types = p.type ? p.type.split(',').map(collectionParam) : undefined;
        const hits = ctx.search.search(p.q, { limit: p.limit, types });
        const facets: Record<string, number> = {};
        for (const h of hits) facets[h.type] = (facets[h.type] ?? 0) + 1;
        return { hits, facets };
      });

      // ---- taxonomy ----
      api.get('/categories', async () => ctx.categories.data);
      api.put('/categories', async (req) => {
        const next = CategoriesSchema.parse(req.body);
        await ctx.categories.update(() => next);
        return next;
      });
      api.get('/skills', async () => ctx.skills.data);
      api.put('/skills', async (req) => {
        const next = SkillsSchema.parse(req.body);
        await ctx.skills.update(() => next);
        return next;
      });
      api.get('/tags', async () => {
        const counts = new Map<string, number>();
        for (const c of COLLECTIONS)
          for (const e of ctx.repos[c].all())
            for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
        return [...counts]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      });
      const retag = async (from: string[], to: string) => {
        let changed = 0;
        for (const c of COLLECTIONS) {
          for (const e of ctx.repos[c].all()) {
            if (!e.tags.some((t) => from.includes(t))) continue;
            const tags = [...new Set(e.tags.map((t) => (from.includes(t) ? to : t)))];
            await ctx.repos[c].patch(e.id, { tags });
            changed++;
          }
        }
        return { changed };
      };
      api.post('/tags/rename', async (req) => {
        const b = z.object({ from: z.string().min(1), to: z.string().min(1) }).parse(req.body);
        return retag([b.from], b.to);
      });
      api.post('/tags/merge', async (req) => {
        const b = z
          .object({ from: z.array(z.string().min(1)).min(1), to: z.string().min(1) })
          .parse(req.body);
        return retag(b.from, b.to);
      });

      // ---- templates ----
      const templateRel = (c: CollectionName) => `config/templates/${c}.json`;
      api.get('/templates/:collection', async (req) => {
        const c = collectionParam((req.params as { collection: string }).collection);
        try {
          return TemplateSchema.parse(
            JSON.parse(await readTextDecoded(ctx.store.codec, ctx.store.abs(templateRel(c)))),
          );
        } catch {
          const d = DEFAULT_TEMPLATES[c];
          if (!d) throw notFound('template', c);
          return d;
        }
      });
      api.put('/templates/:collection', async (req) => {
        const c = collectionParam((req.params as { collection: string }).collection);
        const t = TemplateSchema.parse(req.body);
        await writeJsonEncoded(ctx.store.codec, ctx.store.abs(templateRel(c)), t);
        return t;
      });
      api.delete('/templates/:collection', async (req, reply) => {
        const c = collectionParam((req.params as { collection: string }).collection);
        await fs.rm(ctx.store.abs(templateRel(c)), { force: true });
        return reply.status(204).send();
      });

      // ---- settings & backups ----
      api.get('/settings', async () => ctx.settings.data);
      api.put('/settings', async (req) => {
        const next = SettingsSchema.parse(req.body);
        await ctx.settings.update(() => next);
        return next;
      });
      api.get('/backups', async () =>
        (await ctx.backups.list()).map(({ file: _f, ...b }) => (void _f, b)),
      );
      api.post('/backups', async (req, reply) => {
        const b = z.object({ reason: z.string().max(40).default('manual') }).parse(req.body ?? {});
        const { file: _f, ...info } = await ctx.backups.create(b.reason);
        void _f;
        return reply.status(201).send(info);
      });
      api.post('/backup/restore', async (req) => {
        const b = z.object({ name: z.string().regex(/^[\w.-]+\.zip$/) }).parse(req.body);
        if (!(await ctx.backups.list()).some((x) => x.name === b.name))
          throw notFound('backup', b.name);
        await ctx.backups.create('pre-restore');
        await ctx.backups.restore(b.name);
        await ctx.reloadAll();
        await normalizeEncryption(ctx); // an older plaintext backup must not leave plaintext behind
        return { restored: b.name };
      });

      // ---- starter pack (original MIT content bundled with the app) ----
      api.get('/starter-pack', async () => ({
        license: 'MIT',
        counts: starterCounts(),
        loaded: COLLECTIONS.reduce(
          (n, c) =>
            n +
            ctx.repos[c]
              .all()
              .filter((e) => String(e.importRef ?? '').startsWith(STARTER_REF_PREFIX)).length,
          0,
        ),
      }));
      api.post('/starter-pack/load', async (req) => {
        const b = z
          .object({
            strategy: z
              .enum(['skip', 'update-empty-only', 'overwrite', 'keep-both'])
              .default('update-empty-only'),
          })
          .parse(req.body ?? {});
        return commitPlan(ctx, planStarter(), { strategy: b.strategy });
      });

      // ---- import / export ----
      const MappingSchema = z.record(z.union([z.enum(COLLECTIONS), z.literal('skip')])).optional();
      api.post('/import/preview', async (req) => {
        let vfs: VirtualFs;
        let name: string;
        let zip: Buffer | undefined;
        let collection: CollectionName | undefined;
        let mapping: z.infer<typeof MappingSchema>;
        if (req.isMultipart()) {
          const file = await req.file();
          if (!file) throw new AppError(400, 'VALIDATION', 'No file uploaded');
          const buf = await file.toBuffer();
          const fields = file.fields as Record<string, { value?: string } | undefined>;
          if (fields.collection?.value) collection = collectionParam(fields.collection.value);
          if (fields.mapping?.value)
            mapping = MappingSchema.parse(JSON.parse(fields.mapping.value));
          name = file.filename;
          vfs = fromUpload(name, buf);
          if (/\.zip$/i.test(name)) zip = buf;
        } else {
          const b = z
            .object({
              path: z.string().min(1),
              collection: z.enum(COLLECTIONS).optional(),
              mapping: MappingSchema,
            })
            .parse(req.body);
          ({ vfs, name } = await fromPath(b.path));
          collection = b.collection;
          mapping = b.mapping;
        }
        const plan = buildPlan(ctx, vfs, { sourceName: name, collection, mapping });
        const previewId = previews.put(plan, vfs, zip, name);
        return previewResponse(plan, previewId);
      });
      // ---- optional: import straight from the Notion API (off by default; see Settings → Privacy) ----
      const notion = new NotionJobs();
      const notionPreviews = new Map<string, ReturnType<typeof previewResponse>>();
      api.post('/import/notion-api/start', async (req) => {
        if (!ctx.settings.data.notionApiEnabled)
          throw new AppError(
            403,
            'NOTION_API_DISABLED',
            'Turn on "Import from the Notion API" in Settings first',
          );
        const b = z.object({ token: z.string().min(20).max(500) }).parse(req.body);
        try {
          return { jobId: notion.start(b.token.trim(), { fetch: notionFetch }).id };
        } catch (e) {
          if (e instanceof NotionApiError) throw new AppError(409, 'BUSY', e.message);
          throw e;
        }
      });
      api.get('/import/notion-api/:id', async (req) => {
        const id = (req.params as { id: string }).id;
        const job = notion.get(id);
        if (!job) throw notFound('notion import', id);
        if (job.state === 'done' && job.vfs && !notionPreviews.has(id)) {
          const plan = buildPlan(ctx, job.vfs, { sourceName: 'Notion (API)' });
          notionPreviews.set(
            id,
            previewResponse(plan, previews.put(plan, job.vfs, undefined, 'Notion (API)')),
          );
          job.vfs = undefined;
        }
        return {
          state: job.state,
          progress: job.progress,
          message: job.message,
          stats: job.result,
          preview: notionPreviews.get(id),
        };
      });
      api.post('/import/notion-api/:id/cancel', async (req) => {
        notion.cancel((req.params as { id: string }).id);
        return { ok: true };
      });
      api.post('/import/commit', async (req) => {
        const b = z
          .object({
            previewId: z.string(),
            strategy: z
              .enum(['skip', 'update-empty-only', 'overwrite', 'keep-both'])
              .default('update-empty-only'),
            overrides: z.record(z.string()).optional(),
          })
          .parse(req.body);
        const p = previews.get(b.previewId);
        const report = await commitPlan(
          ctx,
          p.plan,
          { strategy: b.strategy, overrides: b.overrides },
          { vfs: p.vfs, zip: p.zip, zipName: p.zipName },
        );
        previews.drop(b.previewId);
        return report;
      });
      api.post('/import/undo/:id', async (req) =>
        undoImport(ctx, (req.params as { id: string }).id),
      );
      api.get('/imports', async () => listImports(ctx));

      const OptsQuery = z.object({ includePrivate: z.enum(['true', 'false']).optional() });
      const download = (
        reply: FastifyReply,
        type: string,
        filename: string,
        body: Buffer | string,
      ) =>
        reply
          .header('content-type', type)
          .header('content-disposition', `attachment; filename="${filename}"`)
          .send(body);
      const stamp = () => new Date().toISOString().slice(0, 10);
      api.get('/export/markdown', async (req, reply) => {
        const q = OptsQuery.parse(req.query);
        return download(
          reply,
          'application/zip',
          `${APP_NAME.toLowerCase()}-vault-${stamp()}.zip`,
          await exportMarkdown(ctx, { includePrivate: q.includePrivate === 'true' }),
        );
      });
      api.get('/export/csv', async (req, reply) => {
        const q = OptsQuery.extend({ collection: z.enum(COLLECTIONS) }).parse(req.query);
        return download(
          reply,
          'text/csv; charset=utf-8',
          `${q.collection}-${stamp()}.csv`,
          exportCsv(ctx, q.collection, { includePrivate: q.includePrivate === 'true' }),
        );
      });
      api.get('/export/csv-template', async (req, reply) => {
        const q = z.object({ collection: z.enum(COLLECTIONS) }).parse(req.query);
        return download(
          reply,
          'text/csv; charset=utf-8',
          `${q.collection}-template.csv`,
          csvTemplate(q.collection),
        );
      });
      api.get('/export/json', async (req, reply) => {
        const q = OptsQuery.parse(req.query);
        return download(
          reply,
          'application/json',
          `${APP_NAME.toLowerCase()}-backup-${stamp()}.json`,
          JSON.stringify(exportJson(ctx, { includePrivate: q.includePrivate === 'true' }), null, 2),
        );
      });

      // ---- links, backlinks, graph ----
      api.get('/entities/:id/backlinks', async (req) =>
        ctx.links.backlinks((req.params as { id: string }).id),
      );
      api.get('/entities/:id/links', async (req) =>
        ctx.links.outgoing((req.params as { id: string }).id),
      );
      api.get('/graph', async (req) => {
        const q = z
          .object({
            types: z.string().optional(),
            includeOrphans: z.enum(['true', 'false']).optional(),
          })
          .parse(req.query);
        return ctx.links.graph({
          types: q.types ? q.types.split(',').map(collectionParam) : undefined,
          includeOrphans: q.includeOrphans === 'true',
        });
      });

      // ---- sanitized writeup export ----
      api.post('/labs/:id/sanitized-writeup', async (req) => {
        const { id } = req.params as { id: string };
        const lab = ctx.repos.labs.get(id);
        if (!lab) throw notFound('labs', id);
        return sanitizeWriteup(String(lab.writeup ?? ''), ctx.settings.data.sanitizePatterns);
      });

      // ---- attachments (images pasted into notes / imported from Notion) ----
      const IMAGE_TYPES: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        pdf: 'application/pdf',
      };
      const magicOk = (ext: string, b: Buffer) =>
        (ext === 'png' && b.subarray(1, 4).toString() === 'PNG') ||
        ((ext === 'jpg' || ext === 'jpeg') && b[0] === 0xff && b[1] === 0xd8) ||
        (ext === 'gif' && b.subarray(0, 3).toString() === 'GIF') ||
        (ext === 'webp' && b.subarray(8, 12).toString() === 'WEBP');
      api.get('/attachments/:hash/:file', async (req, reply) => {
        const { hash, file } = req.params as { hash: string; file: string };
        if (
          !/^[0-9a-f]{8}$/.test(hash) ||
          !/^[\w][\w. -]{0,120}$/.test(file) ||
          file.includes('..')
        )
          throw notFound('attachment', file);
        const ext = file.split('.').pop()!.toLowerCase();
        let data: Buffer;
        try {
          data = await readDecoded(ctx.store.codec, ctx.store.abs(`attachments/${hash}/${file}`));
        } catch {
          throw notFound('attachment', file);
        }
        return reply
          .header('content-type', IMAGE_TYPES[ext] ?? 'application/octet-stream')
          .header('x-content-type-options', 'nosniff')
          .header(
            'content-security-policy',
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          )
          .header('cache-control', 'private, max-age=3600')
          .send(data);
      });
      api.post('/attachments', async (req, reply) => {
        const f = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
        if (!f) throw new AppError(400, 'VALIDATION', 'No file uploaded');
        const buf = await f.toBuffer();
        if (f.file.truncated) throw new AppError(413, 'TOO_LARGE', 'Image larger than 10 MB');
        const ext = (f.filename.split('.').pop() ?? '').toLowerCase();
        if (!['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) || !magicOk(ext, buf)) {
          throw new AppError(
            415,
            'UNSUPPORTED',
            'Only PNG, JPEG, GIF and WebP images can be attached',
          );
        }
        const name =
          f.filename
            .replace(/[^\w. -]/g, '_')
            .replace(/^[._ -]+/, '')
            .slice(-80) || `image.${ext}`;
        const hash = createHash('sha1').update(buf).digest('hex').slice(0, 8);
        await writeEncoded(ctx.store.codec, ctx.store.abs(`attachments/${hash}/${name}`), buf);
        return reply
          .status(201)
          .send({ url: `ck://attachments/${hash}/${encodeURIComponent(name)}` });
      });

      // ---- study & stats ----
      const TzQuery = z.object({ tzOffset: z.coerce.number().int().min(-840).max(840).default(0) });
      const StudyCollection = z.enum(['commands', 'concepts']);
      api.get('/study/queue', async (req) => {
        const q = TzQuery.extend({
          collection: StudyCollection.optional(),
          limit: z.coerce.number().int().min(1).max(200).default(20),
          onlyId: z.string().optional(),
        }).parse(req.query);
        return ctx.study.queue({
          collection: q.collection,
          limit: q.limit,
          onlyId: q.onlyId,
          tzOffset: q.tzOffset,
        });
      });
      api.post('/study/answer', async (req) => {
        const b = z
          .object({
            id: z.string().min(1),
            rating: z.enum(['again', 'hard', 'good', 'easy']),
            collection: StudyCollection.optional(),
            ms: z.number().int().min(0).max(3_600_000).optional(),
            cardType: z.string().max(20).optional(),
          })
          .parse(req.body);
        return ctx.study.answer(b);
      });
      api.get('/study/stats', async (req) =>
        ctx.study.stats({ tzOffset: TzQuery.parse(req.query).tzOffset }),
      );
      api.get('/stats/overview', async (req) =>
        buildOverview(ctx, { tzOffset: TzQuery.parse(req.query).tzOffset }),
      );
      api.get('/questions', async (req) =>
        ctx.study.questions(
          z.object({ includeDone: z.enum(['true', 'false']).optional() }).parse(req.query)
            .includeDone === 'true',
        ),
      );

      // ---- activity ----
      api.get('/activity/:month', async (req) =>
        ctx.activity.month((req.params as { month: string }).month),
      );

      // ---- live events (SSE) ----
      api.get('/events', (req, reply: FastifyReply) => {
        reply.hijack();
        const raw = reply.raw;
        raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        const send = (event: string, data: unknown) =>
          raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        send('hello', { ok: true });
        const hooks = (['change', 'invalid', 'quarantine', 'reload'] as const).map((ev) => {
          const fn = (d: unknown) => send(ev, d);
          ctx.bus.on(ev, fn);
          return [ev, fn] as const;
        });
        const ping = setInterval(() => raw.write(': ping\n\n'), 25_000);
        const stop = () => raw.end(); // the library is locking
        ctx.bus.once('shutdown', stop);
        req.raw.on('close', () => {
          clearInterval(ping);
          ctx.bus.off('shutdown', stop);
          for (const [ev, fn] of hooks) ctx.bus.off(ev, fn);
        });
      });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
