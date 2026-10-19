import { headingKey, stripBom } from './names.ts';

export interface Section {
  title: string; // original heading text, emoji included
  key: string; // emoji-stripped slug
  markdown: string;
}

const FENCE = /^\s*(```|~~~)/;

/** Apply `fn` to every line that is outside fenced code blocks. */
export function mapOutsideFences(md: string, fn: (line: string) => string): string {
  let fence: string | null = null;
  return md
    .split('\n')
    .map((line) => {
      const m = FENCE.exec(line);
      if (m) {
        if (!fence) fence = m[1]!;
        else if (m[1] === fence) fence = null;
        return line;
      }
      return fence ? line : fn(line);
    })
    .join('\n');
}

/** Unescape every backslash escape (for short structured fields such as `ls \[flags\]`). */
export function unescapeAll(s: string): string {
  return s.replace(/\\([\\`*_{}[\]()<>#+\-.!|~])/g, '$1');
}

/** Body-safe unescape: only brackets, which Notion over-escapes; leaves emphasis intact. */
function unescapeBrackets(line: string): string {
  // keep escapes inside inline code spans
  return line
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 ? part : part.replace(/\\([[\]])/g, '$1')))
    .join('');
}

const CALLOUT_KIND: Record<string, string> = {
  '💡': 'TIP',
  '⚠️': 'WARNING',
  '⚠': 'WARNING',
  '❗': 'IMPORTANT',
  '🚨': 'CAUTION',
  '☠️': 'CAUTION',
  '🔥': 'IMPORTANT',
  '📌': 'NOTE',
  ℹ️: 'NOTE',
};

/** `<aside>` callouts → `> [!KIND]`; `<details>` toggles → blockquote with bold summary. */
export function convertHtmlBlocks(md: string): string {
  let out = md.replace(/<aside>\s*([\s\S]*?)\s*<\/aside>/g, (_m, inner: string) => {
    const lines = inner.trim().split('\n');
    const first = lines[0] ?? '';
    const icon = [...Object.keys(CALLOUT_KIND)].find((k) => first.startsWith(k));
    if (icon) lines[0] = first.slice(icon.length).trim();
    const kind = icon ? CALLOUT_KIND[icon] : 'NOTE';
    return [`> [!${kind}]`, ...lines.map((l) => `> ${l}`.trimEnd())].join('\n');
  });
  out = out.replace(
    /<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g,
    (_m, summary: string, inner: string) =>
      [
        `> **▸ ${summary.trim()}**`,
        ...inner
          .trim()
          .split('\n')
          .map((l) => `> ${l}`.trimEnd()),
      ].join('\n'),
  );
  return out;
}

/** Join table rows that Notion broke across lines (a newline inside a cell). */
export function repairTables(md: string): string {
  const out: string[] = [];
  let inRow = false;
  let fence: string | null = null;
  for (const line of md.split('\n')) {
    const f = FENCE.exec(line);
    if (f) {
      if (!fence) fence = f[1]!;
      else if (f[1] === fence) fence = null;
    }
    if (fence || f) {
      out.push(line);
      inRow = false;
      continue;
    }
    if (inRow) {
      out[out.length - 1] += ' ' + line.trim();
      inRow = !/\|\s*$/.test(line);
      continue;
    }
    out.push(line);
    inRow = /^\s*\|/.test(line) && !/\|\s*$/.test(line);
  }
  return out.join('\n');
}

export function normalizeBody(md: string): string {
  const text = stripBom(md).replace(/\r\n?/g, '\n');
  const converted = repairTables(convertHtmlBlocks(text));
  return mapOutsideFences(converted, unescapeBrackets)
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface NotionPage {
  title: string;
  props: Record<string, string>;
  body: string;
}

const PROP_LINE = /^([^\s:#>|`-][^:\n]{0,60}):(?: (.*))?$/;

/**
 * Parse `# Title`, optional `Key: value` properties block (only when `expectProps`; database row
 * pages), and the remaining body.
 */
export function parseNotionPage(text: string, expectProps: boolean): NotionPage {
  const lines = stripBom(text).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && !lines[i]!.trim()) i++;
  let title = '';
  const h1 = /^#\s+(.*)$/.exec(lines[i] ?? '');
  if (h1) {
    title = h1[1]!.trim();
    i++;
  }
  while (i < lines.length && !lines[i]!.trim()) i++;
  const props: Record<string, string> = {};
  if (expectProps) {
    let j = i;
    const found: [string, string][] = [];
    while (j < lines.length && lines[j]!.trim()) {
      const m = PROP_LINE.exec(lines[j]!);
      if (!m) break;
      found.push([m[1]!.trim(), (m[2] ?? '').trim()]);
      j++;
    }
    const blockEndsCleanly = j >= lines.length || !lines[j]!.trim();
    if (found.length && blockEndsCleanly) {
      for (const [k, v] of found) props[k] = v;
      i = j;
    }
  }
  return { title, props, body: normalizeBody(lines.slice(i).join('\n')) };
}

/** Split a body on `## ` headings (outside code fences). Text before the first heading is the preamble. */
export function splitSections(body: string): { preamble: string; sections: Section[] } {
  const sections: Section[] = [];
  const preamble: string[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  let fence: string | null = null;
  for (const line of body.split('\n')) {
    const f = FENCE.exec(line);
    if (f) {
      if (!fence) fence = f[1]!;
      else if (f[1] === fence) fence = null;
    }
    const h = !fence && !f ? /^##\s+(.*)$/.exec(line) : null;
    if (h) {
      if (cur) sections.push(finish(cur));
      cur = { title: h[1]!.trim(), lines: [] };
    } else if (cur) cur.lines.push(line);
    else preamble.push(line);
  }
  if (cur) sections.push(finish(cur));
  return { preamble: cleanSection(preamble.join('\n')), sections };
}

function cleanSection(md: string): string {
  return md
    .replace(/^\s*(?:---+\s*\n)+/, '')
    .replace(/(?:\n\s*---+\s*)+$/, '')
    .trim();
}

function finish(c: { title: string; lines: string[] }): Section {
  return { title: c.title, key: headingKey(c.title), markdown: cleanSection(c.lines.join('\n')) };
}

export interface Table {
  rows: string[][]; // separator row removed; rows[0] is Notion's "header" row
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (c === '\\' && t[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '`') {
      inCode = !inCode;
      cur += c;
    } else if (c === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/** Find GFM tables (outside code fences). */
export function parseTables(md: string): Table[] {
  const tables: Table[] = [];
  let fence: string | null = null;
  let cur: string[] | null = null;
  const flush = () => {
    if (cur && cur.length) {
      const rows = cur.map(splitRow).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
      if (rows.length) tables.push({ rows });
    }
    cur = null;
  };
  for (const line of md.split('\n')) {
    const f = FENCE.exec(line);
    if (f) {
      flush();
      if (!fence) fence = f[1]!;
      else if (f[1] === fence) fence = null;
      continue;
    }
    if (!fence && /^\s*\|/.test(line)) (cur ??= []).push(line);
    else flush();
  }
  flush();
  return tables;
}

/** Plain text of a table cell: no backticks, emphasis markers or <br>. */
export function cellText(s: string): string {
  return unescapeAll(
    s
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|[^*\w])\*([^*]+)\*(?!\*)/g, '$1$2')
      .replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1$2'),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fenced code block bodies (all of them), with their language. */
export function fencedBlocks(md: string): { lang: string; code: string }[] {
  return [...md.matchAll(/(?:^|\n)(```|~~~)([^\n]*)\n([\s\S]*?)\n?\1(?=\n|$)/g)].map((m) => ({
    lang: m[2]!.trim(),
    code: m[3]!,
  }));
}
