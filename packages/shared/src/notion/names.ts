const ID_SUFFIX = /\s([0-9a-f]{32})$/i;

export interface NotionName {
  title: string;
  id?: string;
  ext: string; // '' | '.md' | '.csv'
  all: boolean; // true for the `_all.csv` duplicate Notion emits next to a database CSV
}

/** Split `ls 32df3e3018aa80d89e90dddec81b898b.md` into title / id / extension. */
export function splitNotionName(filename: string): NotionName {
  const base = filename.split('/').pop() ?? filename;
  let stem = base;
  let ext = '';
  let all = false;
  const m = /\.(md|csv)$/i.exec(stem);
  if (m) {
    ext = m[0].toLowerCase();
    stem = stem.slice(0, -m[0].length);
  }
  if (ext === '.csv' && stem.endsWith('_all')) {
    all = true;
    stem = stem.slice(0, -4);
  }
  const idm = ID_SUFFIX.exec(stem);
  if (idm) stem = stem.slice(0, idm.index);
  return { title: stem.trim(), id: idm?.[1]?.toLowerCase(), ext, all };
}

/** Case/Unicode/emoji-variation-insensitive key for matching titles. */
export function normalizeTitle(s: string): string {
  return s.normalize('NFKC').replace(/[︎️]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Leading emoji / symbols removed (headings like `🧠 What is it?`). */
export function stripLeadingSymbols(s: string): string {
  return s.replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

export function headingKey(heading: string): string {
  return stripLeadingSymbols(heading)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Percent-decode a Notion link path and normalise to NFC / forward slashes. */
export function decodeNotionPath(p: string): string {
  let out = p;
  try {
    out = decodeURIComponent(p);
  } catch {
    /* keep raw */
  }
  return out.normalize('NFC').replace(/\\/g, '/');
}

/** Remove a leading UTF-8 byte-order mark (Notion CSVs start with one). */
export const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
