import { useId, useMemo, useState } from 'react';
import { useEntities, type EntityName } from '../lib/entities';

/** Multi-select over another collection (commands used, concepts related, …). */
export function EntityPicker({
  collection,
  value,
  onChange,
  label,
}: {
  collection: EntityName;
  value: string[];
  onChange(ids: string[]): void;
  label: string;
}) {
  const { data } = useEntities(collection);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const listId = useId();
  const byId = useMemo(() => new Map((data ?? []).map((e) => [e.id, e])), [data]);
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data ?? [])
      .filter(
        (e) => !e.archived && !value.includes(e.id) && (!n || e.title.toLowerCase().includes(n)),
      )
      .slice(0, 8);
  }, [data, value, q]);
  const add = (id: string) => {
    onChange([...value, id]);
    setQ('');
    setSel(0);
  };
  return (
    <div className="field picker">
      <span>{label}</span>
      <div className="picker-box">
        {value.map((id) => (
          <span key={id} className="chip">
            {byId.get(id)?.title ?? '(missing)'}
            <button
              type="button"
              className="chip-x"
              aria-label={`Remove ${byId.get(id)?.title ?? 'item'}`}
              onClick={() => onChange(value.filter((x) => x !== id))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="picker-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={`Add to ${label}`}
          placeholder="add…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setSel(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, matches.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === 'Enter' && matches[sel]) {
              e.preventDefault();
              add(matches[sel]!.id);
            } else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1));
          }}
        />
      </div>
      {open && matches.length > 0 && (
        <ul id={listId} role="listbox" className="picker-list">
          {matches.map((m, i) => (
            <li
              key={m.id}
              role="option"
              aria-selected={i === sel}
              onMouseDown={(e) => (e.preventDefault(), add(m.id))}
            >
              {m.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
