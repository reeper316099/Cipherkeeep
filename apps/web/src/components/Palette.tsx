import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fillPlaceholders } from '@cipherkeep/shared';
import { primaryExample } from '../lib/commandFilters';
import { copyText } from '../lib/clipboard';
import { useCommands, useSearch, useSaveSettings, useSettings } from '../lib/queries';
import { useUI } from '../lib/store';

interface Item {
  key: string;
  icon: string;
  title: string;
  sub: string;
  hint: string;
  run(alt: boolean): void;
}

const ACTIONS = [
  { title: 'Go to Commands', sub: 'Command library', to: '/commands', icon: '›_' },
  { title: 'Start review', sub: 'Spaced-repetition flashcards', to: '/study', icon: '▶' },
  { title: 'Go to Home', sub: 'Dashboard', to: '/', icon: '⌂' },
  { title: 'Open questions', sub: 'Things you still want to answer', to: '/questions', icon: '?' },
  {
    title: 'Import data',
    sub: 'Notion export, CSV, Markdown, JSON backup',
    to: '/import',
    icon: '⇩',
  },
  { title: 'Settings', sub: 'Theme, accent, density', to: '/settings', icon: '⚙' },
];

export function Palette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const toast = useUI((s) => s.toast);
  const values = useUI((s) => s.values);
  const setEditor = useUI((s) => s.setEditor);
  const setHelp = useUI((s) => s.setHelp);
  const commands = useCommands();
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const search = useSearch(q);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const byId = new Map((commands.data ?? []).map((c) => [c.id, c]));
    for (const h of q.trim() ? (search.data?.hits ?? []) : []) {
      if (h.type === 'commands') {
        const c = byId.get(h.id);
        out.push({
          key: `c:${h.id}`,
          icon: '›_',
          title: h.title,
          sub: c ? primaryExample(c) : h.highlight,
          hint: 'Enter: copy example · ⇧Enter: open',
          run: async (alt) => {
            if (alt || !c) return void nav(`/commands/${h.id}`);
            const text = fillPlaceholders(primaryExample(c), values);
            toast((await copyText(text)) ? `Copied: ${text}` : 'Copy failed', { kind: 'info' });
          },
        });
      } else {
        out.push({
          key: `${h.type}:${h.id}`,
          icon: h.type[0]!.toUpperCase(),
          title: h.title,
          sub: `${h.type} · ${h.highlight}`,
          hint: 'Enter: open',
          run: () => nav(`/${h.type}/${h.id}`),
        });
      }
    }
    const needle = q.trim().toLowerCase();
    const extra = [
      ...ACTIONS.map((a) => ({
        key: `a:${a.to}`,
        icon: a.icon,
        title: a.title,
        sub: a.sub,
        hint: '',
        run: () => nav(a.to),
      })),
      {
        key: 'a:new',
        icon: '+',
        title: 'New command',
        sub: 'Create a command entry',
        hint: '',
        run: () => setEditor({ mode: 'create' }),
      },
      {
        key: 'a:help',
        icon: '?',
        title: 'Keyboard shortcuts',
        sub: '',
        hint: '',
        run: () => setHelp(true),
      },
      {
        key: 'a:theme',
        icon: '◐',
        title: 'Toggle light / dark',
        sub: '',
        hint: '',
        run: () =>
          settings.data &&
          saveSettings.mutate({
            ...settings.data,
            theme: settings.data.theme === 'light' ? 'dark' : 'light',
          }),
      },
    ].filter((a) => !needle || a.title.toLowerCase().includes(needle));
    return [...out, ...extra];
  }, [
    q,
    search.data,
    commands.data,
    values,
    nav,
    toast,
    setEditor,
    setHelp,
    settings.data,
    saveSettings,
  ]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const run = (i: number, alt: boolean) => {
    const it = items[i];
    if (!it) return;
    onClose();
    it.run(alt);
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[sel] ? `pal-${sel}` : undefined}
          placeholder="Search commands, concepts, notes… (try: nmap, -la, cmd:grep)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(sel, e.shiftKey || e.ctrlKey || e.metaKey);
            } else if (e.key === 'Escape') onClose();
          }}
        />
        <ul id="palette-list" role="listbox" ref={listRef}>
          {items.map((it, i) => (
            <li
              key={it.key}
              id={`pal-${i}`}
              role="option"
              aria-selected={i === sel}
              onMouseMove={() => setSel(i)}
              onClick={() => run(i, false)}
            >
              <span className="faint mono">{it.icon}</span>
              <span style={{ minWidth: 0 }}>
                <div className="t">{it.title}</div>
                {it.sub && <div className="s mono">{it.sub}</div>}
              </span>
              <span className="faint" style={{ fontSize: 11 }}>
                {i === sel ? it.hint : ''}
              </span>
            </li>
          ))}
          {!items.length && (
            <li aria-selected="false">
              <span />
              <span className="muted">No matches</span>
              <span />
            </li>
          )}
        </ul>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>Enter</kbd> run
          </span>
          <span>
            <kbd>⇧ Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
