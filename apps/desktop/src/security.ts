import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Only web links and mail links may leave the app, and never with embedded credentials. */
export function isSafeExternalUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  try {
    const u = new URL(raw);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) && !u.username && !u.password;
  } catch {
    return false;
  }
}

export function isAppUrl(raw: string, origin: string): boolean {
  try {
    return new URL(raw).origin === origin;
  } catch {
    return false;
  }
}

/** Network policy: the window may only talk to its own loopback origin. Everything else is cancelled. */
export const allowRequest = (raw: string, origin: string) => isAppUrl(raw, origin);

export function isRevealablePath(p: unknown): p is string {
  return (
    typeof p === 'string' &&
    p.length > 0 &&
    p.length < 4096 &&
    !p.includes('\0') &&
    path.isAbsolute(p)
  );
}

const inside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * A new data folder must be absolute, differ from the current one, not nest with it, and be either
 * missing, empty, or already contain Cipherkeep data (meta.json).
 */
export function validateNewDataDir(
  target: unknown,
  current: string,
): { ok: true } | { ok: false; reason: string } {
  if (typeof target !== 'string' || !isRevealablePath(target))
    return { ok: false, reason: 'Choose an absolute folder path.' };
  const t = path.resolve(target);
  const c = path.resolve(current);
  if (t === c) return { ok: false, reason: 'That is already the data folder.' };
  if (inside(t, c) || inside(c, t))
    return {
      ok: false,
      reason: 'The new folder cannot be inside the current one (or contain it).',
    };
  if (!existsSync(t)) return { ok: true };
  if (!statSync(t).isDirectory())
    return { ok: false, reason: 'That path is a file, not a folder.' };
  const entries = readdirSync(t).filter((n) => n !== '.DS_Store');
  if (entries.length === 0 || entries.includes('meta.json')) return { ok: true };
  return { ok: false, reason: 'That folder is not empty and does not look like Cipherkeep data.' };
}

export interface Bounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}
export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Restores saved window bounds only if enough of the window is still on a connected display. */
export function fitBounds(
  saved: Bounds | undefined,
  displays: Area[],
  fallback: { width: number; height: number },
): Bounds {
  const dflt: Bounds = { ...fallback };
  if (
    !saved ||
    !Number.isFinite(saved.width) ||
    !Number.isFinite(saved.height) ||
    saved.width < 600 ||
    saved.height < 400
  )
    return dflt;
  if (saved.x === undefined || saved.y === undefined)
    return { ...dflt, maximized: saved.maximized };
  const visible = displays.some((d) => {
    const w = Math.min(saved.x! + saved.width, d.x + d.width) - Math.max(saved.x!, d.x);
    const h = Math.min(saved.y! + saved.height, d.y + d.height) - Math.max(saved.y!, d.y);
    return w >= 200 && h >= 120;
  });
  return visible ? { ...saved } : { ...dflt, maximized: saved.maximized };
}
