import { memo, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { resolveWikiLink } from '@cipherkeep/shared';
import { apiBlob } from '../lib/api';
import { useTitleIndex } from '../lib/entities';
import { parseWikiHref, remarkCallouts, remarkWikiLinks, sanitizeSchema } from '../lib/markdown';

const blobCache = new Map<string, string>();

/** Images come only from local attachments, fetched through the authenticated API. Remote images are blocked. */
function AttachmentImage({ src, alt }: { src: string; alt?: string }) {
  const [url, setUrl] = useState<string | undefined>(blobCache.get(src));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (blobCache.has(src)) return;
    const m = /^ck:\/\/attachments\/([0-9a-f]{8})\/(.+)$/.exec(src);
    if (!m) return setFailed(true);
    let live = true;
    apiBlob(`/attachments/${m[1]}/${m[2]}`)
      .then((b) => {
        const u = URL.createObjectURL(b);
        blobCache.set(src, u);
        if (live) setUrl(u);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [src]);
  if (failed)
    return <span className="img-blocked">[image unavailable: {alt || 'attachment'}]</span>;
  return url ? (
    <img src={url} alt={alt ?? ''} className="md-img" />
  ) : (
    <span className="img-blocked">loading image…</span>
  );
}

export function openExternal(url: string): void {
  const b = (window as unknown as { cipherkeep?: { openExternal?: (u: string) => void } })
    .cipherkeep;
  if (b?.openExternal) b.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export const MarkdownView = memo(function MarkdownView({
  source,
  className = '',
}: {
  source: string;
  className?: string;
}) {
  const index = useTitleIndex();
  const components = useMemo(
    () => ({
      a({ href = '', children }: { href?: string; children?: React.ReactNode }) {
        const w = parseWikiHref(href);
        if (w) {
          const hit = resolveWikiLink(index, { raw: '', target: w.target, kind: w.kind });
          return hit ? (
            <Link className="wikilink" to={`/${hit.type}/${hit.id}`}>
              {children}
            </Link>
          ) : (
            <span className="wikilink missing" title={`Nothing titled “${w.target}” yet`}>
              {children}
            </span>
          );
        }
        if (/^(https?:|mailto:)/i.test(href)) {
          return (
            <a
              href={href}
              rel="noopener noreferrer"
              target="_blank"
              onClick={(e) => {
                e.preventDefault();
                openExternal(href);
              }}
            >
              {children}
            </a>
          );
        }
        return <span>{children}</span>;
      },
      img({ src = '', alt }: { src?: string; alt?: string }) {
        return src.startsWith('ck://attachments/') ? (
          <AttachmentImage src={src} alt={alt} />
        ) : (
          <span className="img-blocked">[remote image blocked: {alt || 'image'}]</span>
        );
      },
    }),
    [index],
  );
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkWikiLinks, remarkCallouts]}
        rehypePlugins={[
          [rehypeSanitize, sanitizeSchema],
          [rehypeHighlight, { detect: false, ignoreMissing: true }],
        ]}
        components={components}
        skipHtml
        // The sanitize schema (http/https/mailto/ck-wiki links, ck images) is the single URL gate.
        urlTransform={(url) => url}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
