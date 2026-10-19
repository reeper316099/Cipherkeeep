import { promises as fs } from 'node:fs';
import path from 'node:path';
import { JsonStoreError } from './errors.ts';

export interface InstanceLock {
  release(): Promise<void>;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Single-instance lock: `<dir>/.lock` holding the owner pid. Stale locks are taken over. */
export async function acquireInstanceLock(dir: string): Promise<InstanceLock> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, '.lock');
  const body = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fs.writeFile(file, body, { flag: 'wx' });
      return { release: () => fs.rm(file, { force: true }) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let pid = NaN;
      try {
        pid = (JSON.parse(await fs.readFile(file, 'utf8')) as { pid: number }).pid;
      } catch {
        /* unreadable lock is treated as stale */
      }
      if (Number.isFinite(pid) && alive(pid)) {
        throw new JsonStoreError(`Data directory is in use by process ${pid}`, 'LOCKED', file);
      }
      await fs.rm(file, { force: true });
    }
  }
  throw new JsonStoreError('Could not acquire lock', 'LOCKED', file);
}
