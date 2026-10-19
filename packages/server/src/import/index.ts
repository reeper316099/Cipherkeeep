import { randomUUID } from 'node:crypto';
import type { Context } from '../context.ts';
import { AppError } from '../util.ts';
import { existingLookup } from './commit.ts';
import { planCsv, planJsonBackup, planMarkdownFolder } from './generic.ts';
import { planNotion } from './notion.ts';
import type { VirtualFs } from './source.ts';
import type { Plan } from './types.ts';
import type { CollectionName } from '@cipherkeep/shared';

export * from './types.ts';
export { commitPlan, undoImport, listImports } from './commit.ts';
export * from './source.ts';

const NOTION_FILE = /\s[0-9a-f]{32}(_all)?\.(md|csv)$/i;

export function detectKind(vfs: VirtualFs): Plan['kind'] {
  const paths = vfs.paths();
  if (paths.some((p) => NOTION_FILE.test(p))) return 'notion';
  if (paths.some((p) => p.toLowerCase().endsWith('.md'))) return 'markdown';
  if (paths.some((p) => p.toLowerCase().endsWith('.csv'))) return 'csv';
  if (paths.some((p) => p.toLowerCase().endsWith('.json'))) return 'json-backup';
  throw new AppError(
    400,
    'BAD_SOURCE',
    'Nothing importable found (expected a Notion export, CSV, Markdown folder or JSON backup)',
  );
}

export function buildPlan(
  ctx: Context,
  vfs: VirtualFs,
  opts: {
    sourceName: string;
    collection?: CollectionName;
    mapping?: Record<string, CollectionName | 'skip'>;
  },
): Plan {
  const lookup = existingLookup(ctx);
  const kind = detectKind(vfs);
  if (kind === 'notion') return planNotion(vfs, { ...opts, lookup });
  if (kind === 'markdown') return planMarkdownFolder(vfs, opts);
  if (kind === 'csv') return planCsv(vfs, { ...opts, lookup });
  return planJsonBackup(vfs, opts);
}

/** Server-side holder for previews awaiting commit (previews never write). */
export class PreviewStore {
  private map = new Map<
    string,
    { plan: Plan; vfs: VirtualFs; zip?: Buffer; zipName?: string; expires: number }
  >();
  put(plan: Plan, vfs: VirtualFs, zip?: Buffer, zipName?: string): string {
    const now = Date.now();
    for (const [k, v] of this.map) if (v.expires < now) this.map.delete(k);
    const id = randomUUID();
    this.map.set(id, { plan, vfs, zip, zipName, expires: now + 30 * 60_000 });
    return id;
  }
  get(id: string) {
    const v = this.map.get(id);
    if (!v || v.expires < Date.now())
      throw new AppError(
        404,
        'PREVIEW_EXPIRED',
        'Preview not found or expired; run the preview again',
      );
    return v;
  }
  drop(id: string) {
    this.map.delete(id);
  }
}
