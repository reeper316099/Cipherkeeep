export interface WikiLink {
  raw: string;
  target: string;
  /** `cmd` for `[[cmd:ls]]`; undefined for `[[Title]]`. */
  kind?: string;
  alias?: string;
}

const KINDS = new Set(['cmd', 'concept', 'lab', 'note', 'project', 'log', 'snippet']);

/** Extract `[[Title]]`, `[[cmd:ls]]`, `[[Title|alias]]`; ignores code and glob classes like `[[:upper:]]`. */
export function extractWikiLinks(md: string): WikiLink[] {
  const stripped = md.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, '');
  const out: WikiLink[] = [];
  for (const m of stripped.matchAll(/\[\[([^\][\n]+?)\]\]/g)) {
    const inner = m[1]!;
    if (/^[:!]/.test(inner) || /:\]$/.test(inner)) continue; // [[:alpha:]] glob class
    const [left, alias] = inner.split('|') as [string, string | undefined];
    const kindMatch = /^(\w+):(.+)$/.exec(left);
    if (kindMatch && KINDS.has(kindMatch[1]!)) {
      out.push({ raw: m[0], kind: kindMatch[1], target: kindMatch[2]!.trim(), alias });
    } else out.push({ raw: m[0], target: left.trim(), alias });
  }
  return out;
}
