import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Command } from '@cipherkeep/shared';
import { IconGrid, IconList, IconPlus, IconSearch } from '../../components/Icons';
import { useHotkeys } from '../../lib/hotkeys';
import { filterCommands, primaryExample } from '../../lib/commandFilters';
import { useCommands, usePatchCommand, useSearch, useSettings } from '../../lib/queries';
import { useLibrary, useUI } from '../../lib/store';
import { CommandDetail, Dots, useCopy } from './CommandDetail';

function Row({
  c,
  selected,
  y,
  onOpen,
}: {
  c: Command;
  selected: boolean;
  y: number;
  onOpen(): void;
}) {
  return (
    <div
      className="row"
      role="option"
      aria-selected={selected}
      style={{ transform: `translateY(${y}px)` }}
      onClick={onOpen}
      id={`cmd-${c.id}`}
    >
      <span className="name">{c.name}</span>
      <span className="syntax" title={c.syntax}>
        {c.syntax || c.explanation}
      </span>
      <span className="meta">
        {c.favorite && (
          <span title="Favourite" style={{ color: 'var(--warning)' }}>
            ★
          </span>
        )}
        {c.risk !== 'safe' && (
          <span className={`chip risk-${c.risk}`}>
            {c.risk === 'destructive' ? '⚠' : '!'} {c.risk}
          </span>
        )}
        <span className="chip">{c.category || '—'}</span>
        <Dots n={c.mastery} />
      </span>
    </div>
  );
}

function Card({ c, selected, onOpen }: { c: Command; selected: boolean; onOpen(): void }) {
  return (
    <div
      className="cmd-card"
      role="option"
      aria-selected={selected}
      onClick={onOpen}
      id={`cmd-${c.id}`}
    >
      <div className="rowflex" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <span className="name">{c.name}</span>
        <Dots n={c.mastery} />
      </div>
      <div
        className="syntax mono muted"
        style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {c.syntax}
      </div>
      <div className="desc">{c.explanation || c.whatItDoes}</div>
      <div className="rowflex" style={{ gap: 4 }}>
        <span className="chip">{c.category || '—'}</span>
        {c.risk !== 'safe' && <span className={`chip risk-${c.risk}`}>{c.risk}</span>}
      </div>
    </div>
  );
}

export function CommandLibrary() {
  const { id } = useParams();
  const nav = useNavigate();
  const all = useCommands();
  const { f, set, reset } = useLibrary();
  const q = f.q.trim();
  const search = useSearch(q, 'commands');
  const settings = useSettings();
  const patch = usePatchCommand();
  const copy = useCopy();
  const setEditor = useUI((s) => s.setEditor);
  const toast = useUI((s) => s.toast);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  const rank = useMemo(
    () => (q ? new Map((search.data?.hits ?? []).map((h, i) => [h.id, i])) : undefined),
    [q, search.data],
  );
  const list = useMemo(() => filterCommands(all.data ?? [], f, rank), [all.data, f, rank]);
  const categories = useMemo(
    () => [...new Set((all.data ?? []).map((c) => c.category).filter(Boolean))].sort(),
    [all.data],
  );
  const selected =
    list.find((c) => c.id === id) ?? (id ? all.data?.find((c) => c.id === id) : undefined);
  const selIndex = list.findIndex((c) => c.id === id);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const rowH = settings.data?.density === 'compact' ? 34 : 44;
  const cols = f.view === 'cards' ? Math.max(1, Math.floor((width - 16) / 250)) : 1;
  const rowsCount = Math.ceil(list.length / cols);
  const virt = useVirtualizer({
    count: rowsCount,
    getScrollElement: () => listRef.current,
    estimateSize: () => (f.view === 'cards' ? 122 : rowH),
    overscan: 12,
  });
  useEffect(() => virt.measure(), [f.view, cols, rowH]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = useCallback((c: Command) => nav(`/commands/${c.id}`), [nav]);
  const move = useCallback(
    (delta: number) => {
      if (!list.length) return;
      const next = Math.max(
        0,
        Math.min(
          list.length - 1,
          (selIndex < 0 ? (delta > 0 ? -1 : list.length) : selIndex) + delta,
        ),
      );
      nav(`/commands/${list[next]!.id}`, { replace: true });
      virt.scrollToIndex(Math.floor(next / cols), { align: 'auto' });
    },
    [list, selIndex, nav, virt, cols],
  );

  const hotkeys = useMemo(
    () => ({
      '/': () => searchRef.current?.focus(),
      n: () => setEditor({ mode: 'create' }),
      e: () => selected && setEditor({ mode: 'edit', id: selected.id }),
      c: () => selected && void copy(primaryExample(selected)),
      arrowdown: () => move(1),
      arrowup: () => move(-1),
      j: () => move(1),
      k: () => move(-1),
      ...Object.fromEntries(
        [0, 1, 2, 3].map((n) => [
          String(n + 1),
          () => {
            if (!selected) return;
            patch.mutate({ id: selected.id, patch: { mastery: n as 0 | 1 | 2 | 3 } });
            toast(`${selected.name}: mastery ${n}`);
          },
        ]),
      ),
    }),
    [selected, setEditor, copy, move, patch, toast],
  );
  useHotkeys(hotkeys);

  const filtersActive = !!(
    f.category ||
    f.platform ||
    f.risk ||
    f.mastery !== '' ||
    f.favorite ||
    q
  );

  return (
    <div className={`library ${selected ? 'has-detail' : ''}`}>
      <section className="lib-left" aria-label="Command list">
        <div className="lib-tools">
          <div className="search">
            <IconSearch />
            <input
              ref={searchRef}
              className="input"
              type="search"
              aria-label="Search commands"
              placeholder="Search commands, flags (-la), descriptions…   ( / )"
              value={f.q}
              onChange={(e) => set({ q: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  set({ q: '' });
                  e.currentTarget.blur();
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  e.currentTarget.blur();
                  listRef.current?.focus();
                  move(1);
                }
                if (e.key === 'Enter' && list[0] && !e.shiftKey) {
                  open(list[0]);
                  if (e.metaKey || e.ctrlKey) void copy(primaryExample(list[0]));
                }
              }}
            />
          </div>
          <select
            className="select"
            aria-label="Category"
            value={f.category}
            onChange={(e) => set({ category: e.target.value })}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Platform"
            value={f.platform}
            onChange={(e) => set({ platform: e.target.value })}
          >
            <option value="">Any platform</option>
            {['linux', 'macos', 'windows'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Risk"
            value={f.risk}
            onChange={(e) => set({ risk: e.target.value })}
          >
            <option value="">Any risk</option>
            {['safe', 'caution', 'destructive'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Mastery"
            value={f.mastery}
            onChange={(e) => set({ mastery: e.target.value })}
          >
            <option value="">Any mastery</option>
            {['Unseen', 'Learning', 'Comfortable', 'Mastered'].map((p, i) => (
              <option key={p} value={String(i)}>
                {i} · {p}
              </option>
            ))}
          </select>
          <button
            className="btn"
            aria-pressed={f.favorite}
            onClick={() => set({ favorite: !f.favorite })}
            title="Favourites only"
          >
            {f.favorite ? '★' : '☆'}
          </button>
          <span className="seg" role="group" aria-label="View">
            <button
              aria-pressed={f.view === 'table'}
              onClick={() => set({ view: 'table' })}
              aria-label="Table view"
            >
              <IconList />
            </button>
            <button
              aria-pressed={f.view === 'cards'}
              onClick={() => set({ view: 'cards' })}
              aria-label="Card view"
            >
              <IconGrid />
            </button>
          </span>
          <button
            className="btn primary"
            onClick={() => setEditor({ mode: 'create' })}
            title="New command (N)"
          >
            <IconPlus /> New
          </button>
        </div>

        <div
          className="lib-list"
          ref={listRef}
          tabIndex={0}
          role="listbox"
          aria-label="Commands"
          aria-activedescendant={id ? `cmd-${id}` : undefined}
        >
          {all.isLoading && <div className="empty">Loading…</div>}
          {search.isError && (
            <div className="empty" role="alert">
              <h3>Search failed</h3>
              <span>
                The search service returned an error. Clear the search box to see everything.
              </span>
            </div>
          )}
          {!all.isLoading && !search.isError && list.length === 0 && (
            <div className="empty">
              <h3>{(all.data?.length ?? 0) === 0 ? 'No commands yet' : 'Nothing matches'}</h3>
              {(all.data?.length ?? 0) === 0 ? (
                <>
                  <span>Import your Notion export or add your first command.</span>
                  <div className="rowflex">
                    <button className="btn primary" onClick={() => nav('/import')}>
                      Import data
                    </button>
                    <button className="btn" onClick={() => setEditor({ mode: 'create' })}>
                      New command
                    </button>
                  </div>
                </>
              ) : (
                <button className="btn" onClick={reset}>
                  Clear filters
                </button>
              )}
            </div>
          )}
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {virt.getVirtualItems().map((vi) =>
              f.view === 'cards' ? (
                <div
                  key={vi.key}
                  className="cards"
                  style={{
                    transform: `translateY(${vi.start}px)`,
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    height: vi.size - 10,
                  }}
                >
                  {list.slice(vi.index * cols, vi.index * cols + cols).map((c) => (
                    <Card key={c.id} c={c} selected={c.id === id} onOpen={() => open(c)} />
                  ))}
                </div>
              ) : (
                <Row
                  key={list[vi.index]!.id}
                  c={list[vi.index]!}
                  selected={list[vi.index]!.id === id}
                  y={vi.start}
                  onOpen={() => open(list[vi.index]!)}
                />
              ),
            )}
          </div>
        </div>
        <div className="lib-foot">
          <span>
            {list.length} of {all.data?.filter((c) => !c.archived).length ?? 0} commands
            {filtersActive && ' (filtered)'}
          </span>
          <span>↑↓ move · C copy · E edit · 1–4 mastery</span>
        </div>
      </section>

      {selected ? (
        <CommandDetail key={selected.id} cmd={selected} />
      ) : (
        <div className="empty detail-empty" style={{ alignContent: 'center' }}>
          <h3>Select a command</h3>
          <span>
            Pick one on the left, or press <kbd>⌘K</kbd> to jump straight to it.
          </span>
        </div>
      )}
    </div>
  );
}
