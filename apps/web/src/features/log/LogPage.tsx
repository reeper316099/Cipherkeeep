import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { parseTimeSpent, type LogEntry } from '@cipherkeep/shared';
import { BacklinksPanel } from '../../components/BacklinksPanel';
import { EntityPicker } from '../../components/EntityPicker';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { MasterDetail } from '../../components/MasterDetail';
import { SaveBar } from '../../components/SaveBar';
import { countByDate, isoDate, longDate, monthGrid } from '../../lib/calendar';
import { useEntities, useEntityMutations } from '../../lib/entities';
import { useSettings } from '../../lib/queries';
import { useUI } from '../../lib/store';
import { useDraft } from '../../lib/useDraft';

const minutesLabel = (m: number | null) =>
  m === null ? null : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;

function Calendar({
  entries,
  day,
  onPick,
}: {
  entries: LogEntry[];
  day: string;
  onPick(d: string): void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = day ? new Date(`${day}T12:00:00`) : new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const counts = useMemo(() => countByDate(entries), [entries]);
  const today = isoDate(new Date());
  const shift = (d: number) =>
    setCursor((c) => {
      const n = new Date(c.y, c.m + d, 1);
      return { y: n.getFullYear(), m: n.getMonth() };
    });
  return (
    <div className="cal" style={{ flex: '1 1 100%' }}>
      <div className="rowflex" style={{ justifyContent: 'space-between' }}>
        <button className="btn ghost icon" aria-label="Previous month" onClick={() => shift(-1)}>
          ‹
        </button>
        <b aria-live="polite">
          {new Date(cursor.y, cursor.m, 1).toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
          })}
        </b>
        <button className="btn ghost icon" aria-label="Next month" onClick={() => shift(1)}>
          ›
        </button>
      </div>
      <div className="cal-grid" role="group" aria-label="Learning log calendar">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="cal-h" aria-hidden="true">
            {d}
          </span>
        ))}
        {monthGrid(cursor.y, cursor.m).map((c) => (
          <button
            key={c.date}
            className={`cal-d ${c.inMonth ? '' : 'out'} ${c.date === today ? 'today' : ''}`}
            aria-pressed={c.date === day}
            aria-label={`${longDate(c.date)}${counts.get(c.date) ? `, ${counts.get(c.date)} entries` : ''}`}
            onClick={() => onPick(c.date === day ? '' : c.date)}
          >
            {c.day}
            {counts.has(c.date) && <i />}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuickLog({ onCreated }: { onCreated(id: string): void }) {
  const m = useEntityMutations('log');
  const toast = useUI((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(isoDate(new Date()));
  const [time, setTime] = useState('');
  const [topics, setTopics] = useState('');
  const [take, setTake] = useState('');
  const mins = parseTimeSpent(time);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const entry = await m.create.mutateAsync({
      title: longDate(date),
      category: 'Log',
      date,
      timeSpentRaw: time || null,
      timeSpentMin: mins,
      topicsRaw: topics || null,
      topics: topics
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      keyTakeaway: take,
    });
    toast(`Logged ${longDate(date)}`);
    setTime('');
    setTopics('');
    setTake('');
    setOpen(false);
    onCreated(entry.id);
  };
  if (!open)
    return (
      <button className="btn primary" style={{ flex: '1 1 100%' }} onClick={() => setOpen(true)}>
        + Log today
      </button>
    );
  return (
    <form
      className="stack card"
      style={{ flex: '1 1 100%', padding: 10, gap: 8 }}
      onSubmit={submit}
      aria-label="Quick log"
    >
      <div className="grid2">
        <label className="field">
          <span>DATE</span>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>TIME SPENT</span>
          <input
            className="input"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="1 hr, 45 mins, 2h 30m…"
          />
          <span className="faint" style={{ fontSize: 11 }} aria-live="polite">
            {time
              ? mins === null
                ? 'couldn’t read that; it will be kept as text'
                : `= ${mins} min`
              : ' '}
          </span>
        </label>
      </div>
      <label className="field">
        <span>TOPICS (comma separated)</span>
        <input className="input" value={topics} onChange={(e) => setTopics(e.target.value)} />
      </label>
      <label className="field">
        <span>KEY TAKEAWAY</span>
        <input className="input" value={take} onChange={(e) => setTake(e.target.value)} />
      </label>
      <div className="rowflex" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="btn primary" type="submit">
          Save entry
        </button>
      </div>
    </form>
  );
}

export function LogPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data = [], isLoading } = useEntities('log');
  const [day, setDay] = useState('');
  const live = useMemo(() => data.filter((e) => !e.archived), [data]);
  const list = useMemo(
    () =>
      live
        .filter((e) => !day || e.date === day)
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [live, day],
  );
  const selected = data.find((e) => e.id === id);
  const move = (d: number) => {
    const i = list.findIndex((e) => e.id === id);
    const next = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? -1 : i) + d))];
    if (next) nav(`/log/${next.id}`, { replace: true });
  };
  const total = list.reduce((a, e) => a + (e.timeSpentMin ?? 0), 0);
  return (
    <MasterDetail
      label="Learning log"
      items={list}
      rowHeight={56}
      getId={(e) => e.id}
      selectedId={id}
      onOpen={(e) => nav(`/log/${e.id}`)}
      onMove={move}
      tools={
        <>
          <QuickLog onCreated={(i) => nav(`/log/${i}`)} />
          <Calendar entries={live} day={day} onPick={setDay} />
          {day && (
            <button className="btn ghost" onClick={() => setDay('')}>
              Show all days
            </button>
          )}
        </>
      }
      renderRow={(e) => (
        <>
          <span className="title">{longDate(e.date)}</span>
          <span className="sub">
            <span>{minutesLabel(e.timeSpentMin) ?? e.timeSpentRaw ?? '—'}</span>
            <span>· {e.keyTakeaway || e.topicsRaw || 'no takeaway'}</span>
          </span>
        </>
      )}
      empty={
        isLoading ? (
          <div className="empty">Loading…</div>
        ) : (
          <div className="empty">
            <h3>No log entries{day ? ' that day' : ''}</h3>
            <span>Use “Log today” to record what you studied.</span>
          </div>
        )
      }
      footer={
        <span>
          {list.length} entries · {minutesLabel(total) ?? '0m'} logged
        </span>
      }
      detail={
        selected ? (
          <LogEditor key={selected.id} entry={selected} />
        ) : (
          <div className="empty detail-empty">
            <h3>Not found</h3>
          </div>
        )
      }
    />
  );
}

function LogEditor({ entry }: { entry: LogEntry }) {
  const nav = useNavigate();
  const m = useEntityMutations('log');
  const toast = useUI((s) => s.toast);
  const settings = useSettings();
  const { draft, set, dirty, reset, markSaved } = useDraft(entry);
  const [confirm, setConfirm] = useState(false);
  const e = draft ?? entry;
  const parsed = parseTimeSpent(e.timeSpentRaw);
  const save = async () => {
    if (!draft) return;
    const raw = draft.timeSpentRaw?.trim() || null;
    const saved = await m.patch.mutateAsync({
      id: draft.id,
      payload: {
        title: longDate(draft.date),
        date: draft.date,
        timeSpentRaw: raw,
        timeSpentMin: raw ? parseTimeSpent(raw) : null,
        topics: draft.topics,
        topicsRaw: draft.topics.join(', ') || null,
        keyTakeaway: draft.keyTakeaway,
        body: draft.body,
        commandIds: draft.commandIds,
        conceptIds: draft.conceptIds,
        labIds: draft.labIds,
      },
    });
    markSaved(saved);
    toast('Saved');
  };
  return (
    <article className="detail" aria-label={`Log ${longDate(e.date)}`}>
      <header className="detail-head">
        <button
          className="btn ghost icon only-narrow"
          aria-label="Back to list"
          onClick={() => nav('/log')}
        >
          ←
        </button>
        <h1 style={{ fontFamily: 'var(--sans)' }}>{longDate(e.date)}</h1>
      </header>
      <div className="grid2">
        <label className="field">
          <span>DATE</span>
          <input
            className="input"
            type="date"
            value={e.date}
            onChange={(ev) => set('date', ev.target.value)}
          />
        </label>
        <label className="field">
          <span>TIME SPENT</span>
          <input
            className="input"
            value={e.timeSpentRaw ?? ''}
            onChange={(ev) => set('timeSpentRaw', ev.target.value)}
          />
          <span className="faint" style={{ fontSize: 11 }}>
            {e.timeSpentRaw ? (parsed === null ? 'kept as text' : `= ${parsed} min`) : ' '}
          </span>
        </label>
      </div>
      <label className="field">
        <span>TOPICS (comma separated)</span>
        <input
          className="input"
          value={e.topics.join(', ')}
          onChange={(ev) =>
            set(
              'topics',
              ev.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            )
          }
        />
      </label>
      <label className="field">
        <span>KEY TAKEAWAY</span>
        <input
          className="input"
          value={e.keyTakeaway}
          onChange={(ev) => set('keyTakeaway', ev.target.value)}
        />
      </label>
      <div className="grid2">
        <EntityPicker
          collection="commands"
          label="COMMANDS"
          value={e.commandIds}
          onChange={(v) => set('commandIds', v)}
        />
        <EntityPicker
          collection="concepts"
          label="CONCEPTS"
          value={e.conceptIds}
          onChange={(v) => set('conceptIds', v)}
        />
      </div>
      <EntityPicker
        collection="labs"
        label="LABS"
        value={e.labIds}
        onChange={(v) => set('labIds', v)}
      />
      <section className="stack" style={{ gap: 6 }} data-sensitive>
        <h2>Notes (learned · insight · questions · review later)</h2>
        <MarkdownEditor
          label="Log notes"
          value={e.body}
          onChange={(v) => set('body', v)}
          vimMode={settings.data?.vimMode}
          onSave={() => void save()}
          minHeight={180}
        />
      </section>
      <BacklinksPanel id={entry.id} />
      <SaveBar
        dirty={dirty}
        saving={m.patch.isPending}
        onSave={() => void save()}
        onRevert={reset}
        onDelete={async () => {
          if (!confirm) return setConfirm(true);
          await m.remove.mutateAsync(entry.id);
          toast('Entry deleted');
          nav('/log');
        }}
        extra={confirm ? <span className="muted">Click Delete again to confirm</span> : null}
      />
    </article>
  );
}
