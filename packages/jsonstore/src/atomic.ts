import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** Stable, pretty-printed JSON: keys sorted, 2-space indent, trailing newline. */
export function stableStringify(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, sort(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value), null, 2) + '\n';
}

/**
 * Read a file that another process may be finishing a write to. Windows reports a briefly locked file as
 * EBUSY/EPERM/EACCES; a watcher that gives up on the first failure would miss the edit for good.
 */
export async function readFileRetry(file: string, tries = 6, delayMs = 50): Promise<Buffer> {
  for (let i = 1; ; i++) {
    try {
      return await fs.readFile(file);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= tries || !['EBUSY', 'EPERM', 'EACCES'].includes(code ?? '')) throw e;
      await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
}

/** Write to a temp file in the same dir, fsync, then rename over the target. */
export async function atomicWriteFile(file: string, data: string | Uint8Array): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await atomicWriteFile(file, stableStringify(value));
}
