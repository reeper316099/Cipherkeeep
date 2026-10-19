import { decodeNotionPath, splitNotionName } from './names.ts';

export interface RelationRef {
  title: string;
  path?: string;
  id?: string;
}

/**
 * Notion relation cells: `Title (url-encoded/path.md), Other (…)`. Titles may contain commas or
 * parentheses, so the link target (always ending in .md or an http URL) anchors the parse.
 */
export function parseRelationCell(cell: string | null | undefined): RelationRef[] {
  const text = (cell ?? '').trim();
  if (!text) return [];
  const out: RelationRef[] = [];
  const re = /(.*?)\s*\(((?:https?:\/\/[^()\s]+)|(?:[^()]*?\.md))\)\s*(?:,\s*|$)/gy;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    last = re.lastIndex;
    const title = m[1]!.trim();
    const path = decodeNotionPath(m[2]!);
    const id = /([0-9a-f]{32})(?:\.md)?$/i.exec(path)?.[1]?.toLowerCase();
    out.push({ title: title || splitNotionName(path).title, path, id });
    if (last >= text.length) break;
  }
  if (last < text.length) {
    for (const t of text.slice(last).split(',')) if (t.trim()) out.push({ title: t.trim() });
  }
  return out;
}

/** Split a plain `a, b, c` multi-select / tag cell. */
export function splitList(cell: string | null | undefined): string[] {
  return (cell ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
