import { placeholderRegex } from '@cipherkeep/shared';

/** Renders a command with unfilled placeholders highlighted and filled ones in the accent colour. */
export function Tokens({
  text,
  values,
}: {
  text: string;
  values: Record<string, string | undefined>;
}) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(placeholderRegex())) {
    const name = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const v = values[name];
    out.push(
      v ? (
        <span key={i++} className="filled" title={`${name} (filled)`}>
          {v}
        </span>
      ) : (
        <span key={i++} className="ph" title={`Fill in “${name}” above`}>
          {m[0]}
        </span>
      ),
    );
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
