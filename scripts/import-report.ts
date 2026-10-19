// Dry-runs an import into a throwaway data dir and prints a summary (counts + warnings, no note bodies).
// Usage: npx tsx scripts/import-report.ts <zip | folder | csv> [--json]
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createContext } from '../packages/server/src/context.ts';
import {
  buildPlan,
  commitPlan,
  fromPath,
  undoImport,
} from '../packages/server/src/import/index.ts';
import { COLLECTIONS } from '../packages/shared/src/index.ts';

const src = process.argv[2];
if (!src) {
  console.error('usage: import-report.ts <zip|folder|csv> [--json]');
  process.exit(1);
}
const dir = await mkdtemp(path.join(os.tmpdir(), 'ck-report-'));
const ctx = await createContext({ dataDir: dir, watch: false });
try {
  const { vfs, name } = await fromPath(src);
  const plan = buildPlan(ctx, vfs, { sourceName: name });
  const counts = (items: { collection: string }[]) =>
    Object.fromEntries(COLLECTIONS.map((c) => [c, items.filter((i) => i.collection === c).length]));
  const out: Record<string, unknown> = {
    kind: plan.kind,
    databases: plan.databases.map((d) => ({
      title: d.title,
      collection: d.collection,
      rows: d.rows,
    })),
    planned: counts(plan.items),
    templates: plan.templates.map((t) => `${t.collection}: ${t.template.sections.length} sections`),
    attachments: plan.attachments.length,
    skippedByDefault: plan.items
      .filter((i) => i.skipByDefault)
      .map((i) => `${i.title}: ${i.skipByDefault}`),
    planWarnings: plan.warnings,
  };
  const first = await commitPlan(ctx, plan, { strategy: 'update-empty-only' }, { vfs });
  const again = await commitPlan(
    ctx,
    buildPlan(ctx, vfs, { sourceName: name }),
    { strategy: 'update-empty-only' },
    { vfs },
  );
  out.commit = {
    created: first.created,
    updated: first.updated,
    unchanged: first.unchanged,
    skipped: first.skipped.length,
  };
  out.itemWarnings = first.itemWarnings;
  out.reimport = { created: again.created, updated: again.updated, unchanged: again.unchanged };
  const undone = await undoImport(ctx, first.id);
  out.undo = {
    ...undone,
    entitiesLeft: Object.fromEntries(COLLECTIONS.map((c) => [c, ctx.repos[c].all().length])),
  };
  console.log(JSON.stringify(out, null, 2));
} finally {
  await ctx.close();
  await rm(dir, { recursive: true, force: true });
}
