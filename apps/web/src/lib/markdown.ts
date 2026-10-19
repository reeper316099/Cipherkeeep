import type { Root, Blockquote, Paragraph, Text, Link, PhrasingContent } from 'mdast';
import { defaultSchema } from 'rehype-sanitize';
import type { Options as SanitizeSchema } from 'rehype-sanitize';
import { visit } from 'unist-util-visit';

const WIKI = /\[\[([^\][\n]+?)\]\]/g;
const KINDS = new Set(['cmd', 'concept', 'lab', 'note', 'project', 'log', 'snippet']);

export interface WikiHref {
  target: string;
  kind?: string;
}

export const wikiHref = (w: WikiHref) => `ck-wiki:${encodeURIComponent(JSON.stringify(w))}`;
export function parseWikiHref(href: string): WikiHref | null {
  if (!href.startsWith('ck-wiki:')) return null;
  try {
    return JSON.parse(decodeURIComponent(href.slice(8))) as WikiHref;
  } catch {
    return null;
  }
}

/** `[[Title]]`, `[[cmd:ls]]`, `[[Title|alias]]` → links. Glob classes like `[[:alpha:]]` and code are left alone. */
export function remarkWikiLinks() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (
        !parent ||
        index === undefined ||
        parent.type === 'link' ||
        parent.type === 'linkReference'
      )
        return;
      const out: PhrasingContent[] = [];
      let last = 0;
      for (const m of node.value.matchAll(WIKI)) {
        const inner = m[1]!;
        if (/^[:!]/.test(inner) || /:$/.test(inner)) continue;
        const [left, alias] = inner.split('|') as [string, string | undefined];
        const km = /^(\w+):(.+)$/.exec(left);
        const kind = km && KINDS.has(km[1]!) ? km[1] : undefined;
        const target = (kind ? km![2]! : left).trim();
        const start = m.index ?? 0;
        if (start > last) out.push({ type: 'text', value: node.value.slice(last, start) });
        const link: Link = {
          type: 'link',
          url: wikiHref({ target, kind }),
          children: [{ type: 'text', value: alias?.trim() || target }],
        };
        out.push(link);
        last = start + m[0].length;
      }
      if (!out.length) return;
      if (last < node.value.length) out.push({ type: 'text', value: node.value.slice(last) });
      parent.children.splice(index, 1, ...out);
      return index + out.length;
    });
  };
}

const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

/** `> [!TIP]` blockquotes → styled callout containers. */
export function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, 'blockquote', (node: Blockquote) => {
      const first = node.children[0] as Paragraph | undefined;
      const text =
        first?.type === 'paragraph' ? (first.children[0] as Text | undefined) : undefined;
      if (!text || text.type !== 'text') return;
      const m = CALLOUT.exec(text.value);
      if (!m) return;
      text.value = text.value.slice(m[0].length);
      const kind = m[1]!.toLowerCase();
      node.data = { hName: 'div', hProperties: { className: ['callout', `callout-${kind}`] } };
      node.children.unshift({
        type: 'paragraph',
        children: [{ type: 'strong', children: [{ type: 'text', value: kind.toUpperCase() }] }],
      });
    });
  };
}

/**
 * Sanitisation: no raw HTML at all (react-markdown never parses it), plus an allow-list schema so even
 * plugin-generated nodes are filtered. Only http(s)/mailto links, our own wiki scheme, and ck:// images.
 */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto', 'ck-wiki'],
    src: ['ck'],
  },
  attributes: {
    ...defaultSchema.attributes,
    div: [['className', /^callout(?:-(?:note|tip|important|warning|caution))?$/]],
    code: [['className', /^language-[\w+-]+$/]],
  },
};
