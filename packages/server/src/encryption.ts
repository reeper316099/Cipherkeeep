import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile, isEncrypted, isEncryptedLine, type Codec } from '@cipherkeep/jsonstore';
import type { Context } from './context.ts';
import type { NoteRepo } from './notes.ts';
import { VAULT_FILE } from './vault.ts';

/** Top-level names never rewritten: key material, plain metadata, backups (already raw copies) and scratch space. */
const SKIP_TOP = new Set([VAULT_FILE, 'meta.json', 'backups', 'exports', 'logs']);

async function* walk(dir: string, top = true): AsyncGenerator<string> {
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name.endsWith('.tmp')) continue;
    if (top && SKIP_TOP.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(abs, false);
    else if (ent.isFile()) yield abs;
  }
}

/**
 * Brings every file that is not a JSON shard or a note (templates, attachments, import records, append-only
 * logs) into the state `to` calls for. `from` decodes what is there now; plain files pass through any codec.
 * Safe to repeat: files already in the target state are left untouched.
 */
export async function recodeLooseFiles(ctx: Context, from: Codec, to: Codec): Promise<number> {
  const notesRoot = path.join(ctx.dataDir, 'data', 'notes');
  const open = new Set(ctx.store.openFiles().map((f) => f.path));
  let changed = 0;
  for await (const abs of walk(ctx.dataDir)) {
    if (abs.startsWith(notesRoot + path.sep) || open.has(abs)) continue;
    const rel = path.relative(ctx.dataDir, abs);
    if (abs.endsWith('.jsonl')) {
      // Append-only logs: convert line by line under the same lock the writers use.
      const did = await ctx.store.mutex.run(rel, async () => {
        const text = await fs.readFile(abs, 'utf8');
        let dirty = false;
        const lines = text.split('\n').map((l) => {
          if (!l || isEncryptedLine(l) === to.encrypting) return l;
          dirty = true;
          return to.encodeLine(from.decodeLine(l));
        });
        if (dirty) await atomicWriteFile(abs, lines.join('\n'));
        return dirty;
      });
      if (did) changed++;
      continue;
    }
    await ctx.store.mutex.run(rel, async () => {
      const raw = await fs.readFile(abs);
      if (isEncrypted(raw) === to.encrypting) return;
      await atomicWriteFile(abs, to.encode(from.decode(raw)));
      changed++;
    });
  }
  return changed;
}

/** Switch the whole library from the codec it currently uses to `to` (shards, notes, everything else). */
export async function recodeLibrary(ctx: Context, from: Codec, to: Codec): Promise<void> {
  ctx.codec.set(to);
  await ctx.store.rewriteAll();
  await (ctx.repos.notes as unknown as NoteRepo).recode();
  await recodeLooseFiles(ctx, from, to);
}

/** After opening an encrypted library: finish any switch an earlier run (or a restored older backup) left half-done. */
export async function normalizeEncryption(ctx: Context): Promise<void> {
  if (!ctx.codec.encrypting) return;
  const notes = ctx.repos.notes as unknown as NoteRepo;
  if (notes.plainSeen > 0) await notes.recode();
  await recodeLooseFiles(ctx, ctx.codec, ctx.codec);
  // JSON shards restored from an old plaintext backup are re-encoded the next time they are written;
  // do it now so nothing readable lingers.
  for (const f of ctx.store.openFiles()) {
    const raw = await fs.readFile(f.path).catch(() => null);
    if (raw && !isEncrypted(raw)) await ctx.store.mutex.run(f.rel, () => f.writeLocked(f.data));
  }
}
