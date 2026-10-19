import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { ZodError, z } from 'zod';
import { APP_NAME, COLLECTIONS, type CollectionName } from '@cipherkeep/shared';
import type { Context } from './context.ts';
import {
  CategoriesSchema,
  DEFAULT_TEMPLATES,
  SettingsSchema,
  SkillsSchema,
  TemplateSchema,
} from './config-files.ts';
import type { ListQuery } from './repo.ts';
import { queryEntities } from './repo.ts';
import { AppError, notFound } from './util.ts';
import { atomicWriteJson } from '@cipherkeep/jsonstore';
import { promises as fs } from 'node:fs';

const digest = (s: string) => createHash('sha256').update(s).digest();

export interface AppOptions {
  ctx: Context;
  token: string;
  /** Extra Host header values accepted (the bound host:port is always accepted). */
  logger?: boolean;
}

const ListSchema = z.object({
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

export async function buildApp({
  ctx,
  token,
  logger = false,
}: AppOptions): Promise<FastifyInstance> {
  const want = digest(token);
  const app = Fastify({
    genReqId: () => randomUUID(),
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
  app.setNotFoundHandler((req, reply) =>
    reply
      .status(404)
      .send({ error: { code: 'NOT_FOUND', message: 'No such route', requestId: req.id } }),
  );

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ status: 'ok' }));
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
          return queryEntities(repo.all(), q);
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
            limit: z.coerce.number().int().min(1).max(200).default(50),
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
            JSON.parse(await fs.readFile(ctx.store.abs(templateRel(c)), 'utf8')),
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
        await atomicWriteJson(ctx.store.abs(templateRel(c)), t);
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
        return { restored: b.name };
      });

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
        req.raw.on('close', () => {
          clearInterval(ping);
          for (const [ev, fn] of hooks) ctx.bus.off(ev, fn);
        });
      });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
