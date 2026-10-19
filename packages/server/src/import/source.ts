import AdmZip from 'adm-zip';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { stripBom } from '@cipherkeep/shared';
import { AppError } from '../util.ts';

/** In-memory view of an import source: normalised posix paths → bytes. */
export class VirtualFs {
  readonly files = new Map<string, Buffer>();

  add(p: string, data: Buffer): void {
    const clean = p.normalize('NFC').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean || clean.split('/').some((s) => s === '..')) return; // zip-slip guard
    if (clean.startsWith('__MACOSX/') || clean.split('/').pop() === '.DS_Store') return;
    this.files.set(clean, data);
  }

  text(p: string): string {
    return stripBom(this.files.get(p)!.toString('utf8'));
  }

  paths(): string[] {
    return [...this.files.keys()].sort();
  }
}

const MAX_BYTES = 500 * 1024 * 1024;
const MAX_FILES = 50_000;

export function fromZipBuffer(buf: Buffer, vfs = new VirtualFs(), depth = 0): VirtualFs {
  const zip = new AdmZip(buf);
  let total = 0;
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    if (vfs.files.size > MAX_FILES)
      throw new AppError(413, 'TOO_LARGE', 'Too many files in archive');
    total += e.header.size;
    if (total > MAX_BYTES) throw new AppError(413, 'TOO_LARGE', 'Archive too large');
    const data = e.getData();
    // Notion sometimes wraps parts as zips inside the outer zip.
    if (depth < 2 && /\.zip$/i.test(e.entryName)) fromZipBuffer(data, vfs, depth + 1);
    else vfs.add(e.entryName, data);
  }
  return vfs;
}

export async function fromFolder(dir: string): Promise<VirtualFs> {
  const root = path.resolve(dir);
  const vfs = new VirtualFs();
  let total = 0;
  const walk = async (d: string) => {
    for (const ent of await fs.readdir(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) await walk(abs);
      else if (ent.isFile()) {
        const data = await fs.readFile(abs);
        total += data.length;
        if (total > MAX_BYTES) throw new AppError(413, 'TOO_LARGE', 'Folder too large');
        vfs.add(path.relative(root, abs), data);
      }
    }
  };
  await walk(root);
  return vfs;
}

export async function fromPath(p: string): Promise<{ vfs: VirtualFs; name: string }> {
  const abs = path.resolve(p);
  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    throw new AppError(400, 'BAD_SOURCE', 'Source path does not exist');
  }
  const name = path.basename(abs);
  if (st.isDirectory()) return { vfs: await fromFolder(abs), name };
  const buf = await fs.readFile(abs);
  if (/\.zip$/i.test(abs)) return { vfs: fromZipBuffer(buf), name };
  const vfs = new VirtualFs();
  vfs.add(name, buf);
  return { vfs, name };
}

export function fromUpload(name: string, buf: Buffer): VirtualFs {
  if (/\.zip$/i.test(name) || (buf[0] === 0x50 && buf[1] === 0x4b)) return fromZipBuffer(buf);
  const vfs = new VirtualFs();
  vfs.add(name, buf);
  return vfs;
}
