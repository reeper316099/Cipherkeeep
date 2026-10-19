import path from 'node:path';
import Papa from 'papaparse';
import { z } from 'zod';
import YAML from 'yaml';
import {
  COLLECTIONS,
  SCHEMAS,
  normalizeTitle,
  parseCommandPage,
  parseConceptPage,
  splitList,
  type CollectionName,
} from '@cipherkeep/shared';
import { parseFrontmatter } from '../notes.ts';
import { AppError } from '../util.ts';
import { detectCollection, planNotion, type Lookup } from './notion.ts';
import type { Plan, PlanItem } from './types.ts';
import type { VirtualFs } from './source.ts';

type Kind = 'string' | 'number' | 'boolean' | 'strings' | 'json';

function unwrap(t: z.ZodTypeAny): z.ZodTypeAny {
  let cur = t;
  for (let i = 0; i < 6; i++) {
    const def = cur._def as { innerType?: z.ZodTypeAny; typeName: string };
    if (def.innerType && /Optional|Default|Nullable/.test(def.typeName)) cur = def.innerType;
    else break;
  }
  return cur;
}

function fieldKind(t: z.ZodTypeAny): Kind {
  const u = unwrap(t);
  const name = (u._def as { typeName: string }).typeName;
  if (name === 'ZodNumber') return 'number';
  if (name === 'ZodBoolean') return 'boolean';
  if (name === 'ZodArray')
    return (unwrap((u as z.ZodArray<z.ZodTypeAny>).element)._def as { typeName: string })
      .typeName === 'ZodString'
      ? 'strings'
      : 'json';
  if (name === 'ZodObject' || name === 'ZodRecord' || name === 'ZodUnion')
    return name === 'ZodUnion' ? 'number' : 'json';
  return 'string';
}

/** Cells written by our exporter are prefixed with `'` when they could be read as spreadsheet formulas. */
export const unguardCell = (s: string) => (/^'[=+\-@]/.test(s) ? s.slice(1) : s);

export function planCsv(
  vfs: VirtualFs,
  opts: { sourceName: string; collection?: CollectionName; lookup?: Lookup },
): Plan {
  const csvs = vfs.paths().filter((p) => p.toLowerCase().endsWith('.csv'));
  if (!csvs.length) throw new AppError(400, 'BAD_SOURCE', 'No CSV found');
  const first = Papa.parse<Record<string, string>>(vfs.text(csvs[0]!), {
    header: true,
    preview: 1,
  });
  const headers = (first.meta.fields ?? []).map((h) => h.trim());
  // A Notion database CSV (with or without page bodies) goes through the Notion planner.
  if (!opts.collection && detectCollection(headers)) return planNotion(vfs, opts);
  const collection = opts.collection;
  if (!collection || !COLLECTIONS.includes(collection)) {
    throw new AppError(400, 'NEEDS_COLLECTION', 'Choose which collection this CSV belongs to', {
      headers,
    });
  }
  const shape = (SCHEMAS[collection] as unknown as z.ZodObject<z.ZodRawShape>).shape;
  const keyByLower = new Map(Object.keys(shape).map((k) => [k.toLowerCase(), k]));
  const items: PlanItem[] = [];
  const warnings: Plan['warnings'] = [];
  for (const csv of csvs) {
    const parsed = Papa.parse<Record<string, string>>(vfs.text(csv), {
      header: true,
      skipEmptyLines: 'greedy',
    });
    parsed.data.forEach((row, idx) => {
      const input: Record<string, unknown> = {};
      const extra: Record<string, string> = {};
      const warns: string[] = [];
      for (const [h0, raw0] of Object.entries(row)) {
        const h = h0.trim();
        const raw = unguardCell((raw0 ?? '').trim());
        if (!raw) continue;
        const key =
          keyByLower.get(h.toLowerCase().replace(/[\s_-]+/g, '')) ??
          keyByLower.get(h.toLowerCase());
        if (!key || ['id', 'createdat', 'updatedat'].includes(key.toLowerCase())) {
          if (
            key?.toLowerCase() !== 'id' &&
            !['createdat', 'updatedat'].includes((key ?? '').toLowerCase())
          )
            extra[h] = raw;
          continue;
        }
        const kind = fieldKind(shape[key]!);
        try {
          input[key] =
            kind === 'number'
              ? Number(raw)
              : kind === 'boolean'
                ? /^(true|yes|1|x)$/i.test(raw)
                : kind === 'strings'
                  ? raw.startsWith('[')
                    ? (JSON.parse(raw) as string[])
                    : splitList(raw.replace(/\|/g, ';'))
                  : kind === 'json'
                    ? JSON.parse(raw)
                    : raw;
        } catch {
          warns.push(`could not read column "${h}"; kept raw`);
          extra[h] = raw;
        }
      }
      const title = String(input.title ?? input.name ?? '').trim();
      if (!title) {
        warnings.push({
          level: 'warning',
          code: 'ROW_WITHOUT_TITLE',
          message: `Row ${idx + 2} in ${csv} has no title; skipped`,
          source: csv,
        });
        return;
      }
      if (collection === 'commands' && !input.name) input.name = title;
      input.title ??= title;
      if (Object.keys(extra).length) input.extras = { csvColumns: extra };
      items.push({
        collection,
        ref: String(input.importRef || `csv:${collection}:${normalizeTitle(title)}`),
        title,
        input,
        relations: [],
        source: csv,
        warnings: warns,
      });
    });
  }
  return {
    kind: 'csv',
    sourceName: opts.sourceName,
    items,
    templates: [],
    attachments: [],
    databases: [],
    warnings,
  };
}

export function planMarkdownFolder(vfs: VirtualFs, opts: { sourceName: string }): Plan {
  const items: PlanItem[] = [];
  const warnings: Plan['warnings'] = [];
  for (const p of vfs.paths().filter((x) => x.toLowerCase().endsWith('.md'))) {
    const { data, body } = parseFrontmatter(vfs.text(p));
    const stem = path.posix.basename(p, '.md');
    const h1 = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    const title = String(data.title ?? h1 ?? stem);
    const dir = path.posix.dirname(p);
    const tags = Array.isArray(data.tags)
      ? data.tags.map(String)
      : typeof data.tags === 'string'
        ? splitList(data.tags)
        : [];
    const kind = String(data.ck_collection ?? '');
    const rest = Object.fromEntries(
      Object.entries(data).filter(
        ([k]) => !['title', 'tags', 'category', 'ck_collection', 'ck_id', 'id'].includes(k),
      ),
    );
    let item: PlanItem;
    if (kind === 'commands') {
      const props = Object.fromEntries(
        ['syntax', 'explanation', 'example', 'category'].map((k) => [
          k[0]!.toUpperCase() + k.slice(1),
          String(data[k] ?? ''),
        ]),
      );
      const r = parseCommandPage({
        name: title,
        category: String(data.category ?? ''),
        props,
        body,
      });
      item = {
        collection: 'commands',
        ref: `md:${normalizeTitle(p)}`,
        title,
        input: { ...r.input, tags, ...(typeof data.risk === 'string' ? { risk: data.risk } : {}) },
        relations: [],
        source: p,
        warnings: r.warnings,
      };
    } else if (kind === 'concepts') {
      const r = parseConceptPage({
        name: title,
        category: String(data.category ?? ''),
        difficulty: String(data.difficulty ?? ''),
        tags,
        body,
      });
      item = {
        collection: 'concepts',
        ref: `md:${normalizeTitle(p)}`,
        title,
        input: r.input,
        relations: [],
        source: p,
        warnings: r.warnings,
      };
    } else {
      item = {
        collection: 'notes',
        ref: `md:${normalizeTitle(p)}`,
        title,
        input: {
          title,
          folder: dir === '.' ? '' : dir,
          markdown: body.trim(),
          tags,
          category: String(data.category ?? ''),
          kind: 'general',
          ...(Object.keys(rest).length ? { extras: { frontmatter: rest } } : {}),
        },
        relations: [],
        source: p,
        warnings: [],
      };
    }
    items.push(item);
  }
  if (!items.length)
    warnings.push({ level: 'warning', code: 'EMPTY', message: 'No Markdown files found' });
  void YAML;
  return {
    kind: 'markdown',
    sourceName: opts.sourceName,
    items,
    templates: [],
    attachments: [],
    databases: [],
    warnings,
  };
}

export interface JsonBackupDoc {
  app: string;
  format: number;
  collections: Record<string, Record<string, unknown>[]>;
}

export function planJsonBackup(vfs: VirtualFs, opts: { sourceName: string }): Plan {
  const file = vfs.paths().find((p) => p.toLowerCase().endsWith('.json'))!;
  let doc: JsonBackupDoc;
  try {
    doc = JSON.parse(vfs.text(file)) as JsonBackupDoc;
  } catch {
    throw new AppError(400, 'BAD_SOURCE', 'Not valid JSON');
  }
  if (typeof doc !== 'object' || !doc?.collections || doc.format !== 1) {
    throw new AppError(400, 'BAD_SOURCE', 'Not a Cipherkeep JSON backup');
  }
  const items: PlanItem[] = [];
  const warnings: Plan['warnings'] = [];
  for (const c of COLLECTIONS) {
    for (const e of doc.collections[c] ?? []) {
      const parsed = SCHEMAS[c].safeParse(e);
      if (!parsed.success) {
        warnings.push({
          level: 'warning',
          code: 'INVALID_ENTITY',
          message: `Skipped invalid ${c} entry "${String(e.title ?? e.id)}"`,
        });
        continue;
      }
      const ent = parsed.data as unknown as Record<string, unknown>;
      items.push({
        collection: c,
        ref: String(ent.importRef ?? `json:${ent.id}`),
        title: String(ent.title),
        input: ent,
        relations: [],
        source: file,
        warnings: [],
        fixedId: String(ent.id),
      });
    }
  }
  return {
    kind: 'json-backup',
    sourceName: opts.sourceName,
    items,
    templates: [],
    attachments: [],
    databases: [],
    warnings,
  };
}
