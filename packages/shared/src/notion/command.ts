import { stripLeadingSymbols } from './names.ts';
import {
  cellText,
  fencedBlocks,
  parseTables,
  splitSections,
  unescapeAll,
  type Section,
  type Table,
} from './markdown.ts';

export interface ParsedCommand {
  input: Record<string, unknown>;
  warnings: string[];
}

export interface CommandSource {
  name: string;
  category?: string;
  props: Record<string, string>; // CSV row and/or page property block merged (CSV wins)
  body: string;
}

const HEADER_WORDS =
  /^(options?|flags?|command|commands|meaning|result|results|description|example|examples|key|action)$/i;

/** Notion exports header-less tables with the first data row in the header slot. */
function dataRows(t: Table): string[][] {
  const first = t.rows[0] ?? [];
  const looksLikeHeader = first.length > 0 && first.every((c) => HEADER_WORDS.test(cellText(c)));
  return looksLikeHeader ? t.rows.slice(1) : t.rows;
}

/** Split `cmd = "description"` on the first `= "`; plain lines become command-only. */
export function splitExampleLine(line: string): { command: string; description: string } | null {
  const raw = line.trim();
  if (!raw || raw.startsWith('#')) return null;
  const i = raw.indexOf('= "');
  if (i < 0) return { command: raw, description: '' };
  const command = raw.slice(0, i).trim();
  const description = raw
    .slice(i + 3)
    .replace(/"\s*$/, '')
    .trim();
  return command ? { command, description } : null;
}

export function parseExamples(section: Section | undefined): {
  examples: { command: string; description: string }[];
  extraMarkdown: string;
} {
  const examples: { command: string; description: string }[] = [];
  if (!section) return { examples, extraMarkdown: '' };
  for (const b of fencedBlocks(section.markdown)) {
    for (const line of b.code.split('\n')) {
      const ex = splitExampleLine(line);
      if (ex) examples.push(ex);
    }
  }
  for (const t of parseTables(section.markdown)) {
    for (const r of dataRows(t)) {
      const command = cellText(r[0] ?? '');
      if (command) examples.push({ command, description: cellText(r.slice(1).join(' ')) });
    }
  }
  return { examples, extraMarkdown: '' };
}

const PLACEHOLDER = /<([A-Za-z][\w -]*)>|\{([A-Za-z_][\w-]*)\}|\[([A-Za-z][\w -]*)\]/g;

/** `<target>`, `{ip}`, `[file]` tokens (skips glob classes like `[[:upper:]]`, `[!abc]`). */
export function detectPlaceholders(...texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    for (const m of t.matchAll(PLACEHOLDER)) out.add((m[1] ?? m[2] ?? m[3])!.trim());
  }
  return [...out];
}

const DESTRUCTIVE = new Set([
  'rm',
  'dd',
  'mkfs',
  'shred',
  'fdisk',
  'wipefs',
  'userdel',
  'format',
  'del',
]);
const CAUTION = new Set([
  'mv',
  'chmod',
  'chown',
  'kill',
  'killall',
  'pkill',
  'sudo',
  'su',
  'iptables',
  'ufw',
  'crontab',
  'passwd',
  'usermod',
  'truncate',
  'reboot',
  'shutdown',
  'systemctl',
]);

export function classifyRisk(name: string, examples: string[]): 'safe' | 'caution' | 'destructive' {
  const n = name.trim().split(/\s+/)[0]!.toLowerCase();
  if (DESTRUCTIVE.has(n)) return 'destructive';
  if (examples.some((e) => /\brm\s+-\w*[rf]|\bdd\s+[^|]*of=|\bmkfs\b|:\(\)\s*\{/.test(e)))
    return 'destructive';
  return CAUTION.has(n) ? 'caution' : 'safe';
}

function parseArguments(md: string, dropped: string[]): { name: string; meaning: string }[] {
  const out: { name: string; meaning: string }[] = [];
  for (const line of md.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = /^[-*+]\s+(.*?)\s*(?:→|->|—|–|:)\s*(.*)$/.exec(t);
    if (m) out.push({ name: unescapeAll(m[1]!).replace(/`/g, ''), meaning: unescapeAll(m[2]!) });
    else if (/^\(.*\)$/.test(t))
      dropped.push(t); // template hint like "(Inputs the command takes.)"
    else if (/^[-*+]\s+\S/.test(t))
      out.push({ name: unescapeAll(t.replace(/^[-*+]\s+/, '')), meaning: '' });
  }
  return out;
}

/** Map a Notion command page (+ CSV/property values) to the structured Command fields. */
export function parseCommandPage(src: CommandSource): ParsedCommand {
  const warnings: string[] = [];
  const { sections, preamble } = splitSections(src.body);
  const find = (...keys: string[]) => sections.find((s) => keys.includes(s.key));
  const used = new Set<Section>();
  const take = (...keys: string[]) => {
    const s = find(...keys);
    if (s) used.add(s);
    return s;
  };

  const what = take('what-it-does');
  const syntaxSec = take('basic-syntax');
  const argSec = take('arguments');
  const optSec = take('common-options-flags', 'common-options', 'options', 'flags', 'commands');
  const exSec = take('examples');
  const dropped: string[] = [];

  const options: { flag: string; meaning: string }[] = [];
  if (optSec) {
    for (const t of parseTables(optSec.markdown)) {
      for (const r of dataRows(t)) {
        const flag = cellText(r[0] ?? '');
        if (flag) options.push({ flag, meaning: cellText(r.slice(1).join(' ')) });
      }
    }
  }
  const { examples } = parseExamples(exSec);

  const syntaxFromProps = unescapeAll(src.props.Syntax ?? '').trim();
  const syntaxFromBody = unescapeAll(
    syntaxSec?.markdown.replace(/^```\w*\n?|\n?```$/g, '').trim() ?? '',
  );
  const syntax = syntaxFromProps || syntaxFromBody;

  const primary = unescapeAll(src.props.Example ?? '').trim();
  if (primary && !examples.some((e) => e.command === primary)) {
    examples.unshift({
      command: primary,
      description: unescapeAll(src.props.Explanation ?? '').trim(),
    });
  }

  const extraSections = sections.filter((s) => !used.has(s));
  const notes = [preamble, ...extraSections.map((s) => `## ${s.title}\n\n${s.markdown}`)]
    .filter(Boolean)
    .join('\n\n');
  if (extraSections.length)
    warnings.push(`kept ${extraSections.length} unrecognised section(s) in notes`);
  if (!what?.markdown && !src.props.Explanation) warnings.push('no description found');

  const extras: Record<string, unknown> = {};
  if (dropped.length) extras.droppedTemplateHints = dropped;
  if (optSec && optSec.key === 'commands')
    extras.optionsHeading = stripLeadingSymbols(optSec.title);
  if (syntaxFromProps && syntaxFromBody && syntaxFromProps !== syntaxFromBody)
    extras.bodySyntax = syntaxFromBody;

  const args = argSec ? parseArguments(argSec.markdown, dropped) : [];
  if (dropped.length) extras.droppedTemplateHints = dropped;

  return {
    warnings,
    input: {
      name: src.name,
      title: src.name,
      category: src.category ?? src.props.Category ?? '',
      syntax,
      explanation: unescapeAll(src.props.Explanation ?? ''),
      whatItDoes: what?.markdown ?? '',
      arguments: args,
      options,
      examples,
      placeholders: detectPlaceholders(syntax, ...examples.map((e) => e.command)),
      risk: classifyRisk(
        src.name,
        examples.map((e) => e.command),
      ),
      notes,
      ...(Object.keys(extras).length ? { extras } : {}),
    },
  };
}
