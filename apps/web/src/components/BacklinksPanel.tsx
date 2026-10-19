import { Link } from 'react-router-dom';
import { useBacklinks, useOutgoing, type LinkRef } from '../lib/entities';

const ICON: Record<string, string> = {
  commands: '›_',
  concepts: '📚',
  labs: '🧪',
  projects: '🛠',
  log: '📅',
  notes: '📝',
  snippets: '</>',
};

function Group({ title, items }: { title: string; items: LinkRef[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h2>{title}</h2>
      <div className="rowflex" style={{ gap: 6 }}>
        {items.map((l) => (
          <Link
            key={`${l.id}${l.kind}`}
            className="chip"
            to={`/${l.type}/${l.id}`}
            title={l.kind === 'wikilink' ? 'via [[wiki link]]' : 'via relation'}
          >
            {ICON[l.type]} {l.title}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function BacklinksPanel({ id }: { id: string }) {
  const back = useBacklinks(id);
  const out = useOutgoing(id);
  const none = !back.data?.length && !out.data?.length;
  return (
    <section className="stack" aria-label="Links">
      <Group title="Linked from (backlinks)" items={back.data ?? []} />
      <Group title="Links to" items={out.data ?? []} />
      {none && (
        <span className="faint" style={{ fontSize: 12.5 }}>
          No links yet. Use [[Title]] or [[cmd:ls]] in text, or pick related items.
        </span>
      )}
    </section>
  );
}
