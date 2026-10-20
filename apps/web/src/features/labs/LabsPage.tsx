import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Lab } from '@cipherkeep/shared';
import { Dialog } from '../../components/Dialog';
import { EntityPicker } from '../../components/EntityPicker';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { MarkdownView } from '../../components/MarkdownView';
import { QuickCreate } from '../../components/QuickCreate';
import { SaveBar } from '../../components/SaveBar';
import { api } from '../../lib/api';
import { useEntities, useEntityMutations } from '../../lib/entities';
import {
  filterLabs,
  formatMinutes,
  groupByStatus,
  LAB_STATUSES,
  statusPatch,
} from '../../lib/labs';
import { useSettings } from '../../lib/queries';
import { useUI } from '../../lib/store';
import { useDraft } from '../../lib/useDraft';
import { BacklinksPanel } from '../../components/BacklinksPanel';

const DIFFS = ['Easy', 'Medium', 'Hard'];

export function LabsPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data = [], isLoading } = useEntities('labs');
  const m = useEntityMutations('labs');
  const toast = useUI((s) => s.toast);
  const [view, setView] = useState<'board' | 'table'>('board');
  const [f, setF] = useState({ q: '', platform: '', difficulty: '', domain: '' });
  const [creating, setCreating] = useState(false);
  const [sort, setSort] = useState<{ key: keyof Lab; dir: 1 | -1 }>({ key: 'title', dir: 1 });

  const live = useMemo(() => data.filter((l) => !l.archived), [data]);
  const platforms = useMemo(
    () => [...new Set(live.map((l) => l.platform).filter(Boolean))].sort(),
    [live],
  );
  const domains = useMemo(
    () => [...new Set(live.map((l) => l.domain).filter((d): d is string => !!d))].sort(),
    [live],
  );
  const list = useMemo(() => filterLabs(live, f), [live, f]);
  const groups = useMemo(() => groupByStatus(list), [list]);
  const sorted = useMemo(
    () =>
      [...list].sort((a, b) => ((a[sort.key] ?? '') > (b[sort.key] ?? '') ? sort.dir : -sort.dir)),
    [list, sort],
  );
  const selected = data.find((l) => l.id === id);

  const move = (lab: Lab, status: Lab['status']) =>
    m.patch.mutate({ id: lab.id, payload: statusPatch(lab, status) });
  const create = async (title: string) => {
    const lab = await m.create.mutateAsync({
      title,
      platform: f.platform || platforms[0] || 'Other',
      category: f.platform || platforms[0] || 'Other',
    });
    toast(`Created ${lab.title}`);
    nav(`/labs/${lab.id}`);
  };

  return (
    <div className="pad">
      <div className="rowflex" style={{ marginBottom: 'var(--space-4)' }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          Labs & CTFs
        </h1>
        <span style={{ flex: 1 }} />
        <input
          className="input"
          style={{ width: 220 }}
          type="search"
          aria-label="Search labs"
          placeholder="Search labs…"
          value={f.q}
          onChange={(e) => setF({ ...f, q: e.target.value })}
        />
        <select
          className="select"
          aria-label="Platform"
          value={f.platform}
          onChange={(e) => setF({ ...f, platform: e.target.value })}
        >
          <option value="">All platforms</option>
          {platforms.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select
          className="select"
          aria-label="Difficulty"
          value={f.difficulty}
          onChange={(e) => setF({ ...f, difficulty: e.target.value })}
        >
          <option value="">Any difficulty</option>
          {DIFFS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select
          className="select"
          aria-label="Domain"
          value={f.domain}
          onChange={(e) => setF({ ...f, domain: e.target.value })}
        >
          <option value="">Any domain</option>
          {domains.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={view === 'board'} onClick={() => setView('board')}>
            Board
          </button>
          <button aria-pressed={view === 'table'} onClick={() => setView('table')}>
            Table
          </button>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          + New lab
        </button>
      </div>

      {isLoading ? (
        <div className="empty">Loading…</div>
      ) : live.length === 0 ? (
        <div className="card empty">
          <h3>No labs logged yet</h3>
          <span>Track picoCTF, TryHackMe, Bandit and more. Add your first one.</span>
        </div>
      ) : view === 'board' ? (
        <div className="board">
          {LAB_STATUSES.map((s) => (
            <section
              key={s}
              className="board-col"
              aria-label={s}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const lab = data.find((l) => l.id === e.dataTransfer.getData('text/lab'));
                if (lab && lab.status !== s) move(lab, s);
              }}
            >
              <h2>
                {s} <span className="chip">{groups[s].length}</span>
              </h2>
              {groups[s].map((l) => (
                <div
                  key={l.id}
                  className="cmd-card"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/lab', l.id)}
                  onClick={() => nav(`/labs/${l.id}`)}
                >
                  <div
                    className="rowflex"
                    style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}
                  >
                    <button
                      type="button"
                      className="card-open"
                      onClick={(e) => {
                        e.stopPropagation();
                        nav(`/labs/${l.id}`);
                      }}
                    >
                      {l.title}
                    </button>
                    {l.writeupPrivate && <span title="Private writeup">🔒</span>}
                  </div>
                  <div className="rowflex" style={{ gap: 4 }}>
                    <span className="chip">{l.platform}</span>
                    <span className="chip">{l.difficulty}</span>
                    {l.domain && <span className="chip">{l.domain}</span>}
                  </div>
                  <div className="rowflex" style={{ justifyContent: 'space-between' }}>
                    <span className="faint" style={{ fontSize: 12 }}>
                      {formatMinutes(l.timeSpentMin)}
                      {l.points ? ` · ${l.points} pts` : ''}
                    </span>
                    <span
                      className="rowflex"
                      style={{ gap: 2 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {LAB_STATUSES.filter((x) => x !== s).map((x) => {
                        const back = LAB_STATUSES.indexOf(x) < LAB_STATUSES.indexOf(s);
                        return (
                          <button
                            key={x}
                            className="btn ghost"
                            style={{ padding: '2px 6px', fontSize: 11 }}
                            aria-label={`Move ${l.title} to ${x}`}
                            title={`Move to ${x}`}
                            onClick={() => move(l, x)}
                          >
                            {back ? '←' : '→'}{' '}
                            {x === 'Not Started' ? 'To do' : x === 'In Progress' ? 'Doing' : 'Done'}
                          </button>
                        );
                      })}
                    </span>
                  </div>
                </div>
              ))}
              {!groups[s].length && (
                <span className="faint" style={{ fontSize: 12.5 }}>
                  Drop labs here
                </span>
              )}
            </section>
          ))}
        </div>
      ) : (
        <table className="flags lab-table">
          <thead>
            <tr>
              {(
                [
                  ['title', 'Name'],
                  ['platform', 'Platform'],
                  ['status', 'Status'],
                  ['difficulty', 'Difficulty'],
                  ['domain', 'Domain'],
                  ['timeSpentMin', 'Time'],
                  ['points', 'Points'],
                ] as [keyof Lab, string][]
              ).map(([k, label]) => (
                <th
                  key={k}
                  scope="col"
                  aria-sort={
                    sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'
                  }
                >
                  <button
                    className="btn ghost"
                    onClick={() =>
                      setSort({ key: k, dir: sort.key === k && sort.dir === 1 ? -1 : 1 })
                    }
                  >
                    {label}
                    {sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((l) => (
              <tr
                key={l.id}
                className="clickable"
                tabIndex={0}
                onClick={() => nav(`/labs/${l.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && nav(`/labs/${l.id}`)}
              >
                <td style={{ font: 'inherit', color: 'inherit', fontWeight: 600 }}>
                  {l.writeupPrivate ? '🔒 ' : ''}
                  {l.title}
                </td>
                <td>{l.platform}</td>
                <td>{l.status}</td>
                <td>{l.difficulty}</td>
                <td>{l.domain ?? '—'}</td>
                <td>{formatMinutes(l.timeSpentMin)}</td>
                <td>{l.points ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <LabEditor
          key={selected.id}
          lab={selected}
          platforms={platforms}
          domains={domains}
          onClose={() => nav('/labs')}
        />
      )}
      {id && !selected && !isLoading && (
        <Dialog title="Lab not found" onClose={() => nav('/labs')}>
          <div className="dialog-body">That lab no longer exists.</div>
        </Dialog>
      )}
      {creating && (
        <QuickCreate
          title="New lab"
          label="Name"
          onCreate={create}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function LabTimer({ lab, onAdd }: { lab: Lab; onAdd(min: number): void }) {
  const timer = useUI((s) => s.timer);
  const start = useUI((s) => s.startTimer);
  const stop = useUI((s) => s.stopTimer);
  const [, tick] = useState(0);
  const mine = timer?.labId === lab.id;
  useEffect(() => {
    if (!mine) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [mine]);
  const elapsed = mine ? Math.floor((Date.now() - timer!.startedAt) / 1000) : 0;
  const fmt = `${String(Math.floor(elapsed / 3600)).padStart(2, '0')}:${String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  return (
    <div className="rowflex">
      <span className="mono" aria-live="off" style={{ fontSize: 18, minWidth: 90 }}>
        {mine ? fmt : '00:00:00'}
      </span>
      {mine ? (
        <button className="btn" onClick={() => onAdd(stop())}>
          ■ Stop & add time
        </button>
      ) : (
        <button
          className="btn"
          disabled={!!timer}
          title={timer ? 'Another lab timer is running' : undefined}
          onClick={() => start(lab.id)}
        >
          ▶ Start timer
        </button>
      )}
    </div>
  );
}

function LabEditor({
  lab,
  platforms,
  domains,
  onClose,
}: {
  lab: Lab;
  platforms: string[];
  domains: string[];
  onClose(): void;
}) {
  const m = useEntityMutations('labs');
  const toast = useUI((s) => s.toast);
  const settings = useSettings();
  const { draft, set, dirty, reset, markSaved } = useDraft(lab);
  const [out, setOut] = useState<{
    text: string;
    redactions: number;
    invalidPatterns: string[];
  } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState(false);
  const l = draft ?? lab;

  const save = async () => {
    if (!draft) return;
    const payload = {
      title: draft.title,
      platform: draft.platform,
      category: draft.platform,
      status: draft.status,
      difficulty: draft.difficulty,
      domain: draft.domain || undefined,
      points: draft.points,
      hintsUsed: draft.hintsUsed,
      solvedAt: draft.solvedAt || undefined,
      timeSpentMin: draft.timeSpentMin,
      commandIds: draft.commandIds,
      conceptIds: draft.conceptIds,
      writeup: draft.writeup,
      writeupPrivate: draft.writeupPrivate,
      tags: draft.tags,
    };
    const saved = await m.patch.mutateAsync({ id: draft.id, payload });
    markSaved(saved);
    toast('Saved');
    return saved;
  };
  const exportSanitized = async () => {
    if (dirty) await save();
    setOut(await api(`/labs/${lab.id}/sanitized-writeup`, { method: 'POST' }));
  };
  const num = (v: string) => (v === '' ? undefined : Number(v));

  return (
    <Dialog title={l.title || 'Lab'} onClose={onClose} wide>
      <div className="dialog-body">
        <label className="field">
          <span>NAME</span>
          <input className="input" value={l.title} onChange={(e) => set('title', e.target.value)} />
        </label>
        <div className="grid2">
          <label className="field">
            <span>PLATFORM</span>
            <input
              className="input"
              list="lab-platforms"
              value={l.platform}
              onChange={(e) => set('platform', e.target.value)}
            />
            <datalist id="lab-platforms">
              {[
                ...new Set([
                  ...platforms,
                  'picoCTF',
                  'TryHackMe',
                  'Bandit',
                  'HackTheBox',
                  'OverTheWire',
                ]),
              ].map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>DOMAIN</span>
            <input
              className="input"
              list="lab-domains"
              value={l.domain ?? ''}
              onChange={(e) => set('domain', e.target.value)}
              placeholder="forensics, web, crypto…"
            />
            <datalist id="lab-domains">
              {[
                ...new Set([
                  ...domains,
                  'crypto',
                  'forensics',
                  'web',
                  'reverse engineering',
                  'pwn',
                  'OSINT',
                  'log analysis',
                  'scanning',
                ]),
              ].map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
        </div>
        <div className="rowflex">
          <div className="field">
            <span>STATUS</span>
            <div className="seg" role="group" aria-label="Status">
              {LAB_STATUSES.map((s) => (
                <button
                  key={s}
                  aria-pressed={l.status === s}
                  onClick={() => {
                    set('status', s);
                    if (s === 'Completed' && !l.solvedAt)
                      set('solvedAt', new Date().toISOString().slice(0, 10));
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>DIFFICULTY</span>
            <div className="seg" role="group" aria-label="Difficulty">
              {DIFFS.map((s) => (
                <button
                  key={s}
                  aria-pressed={l.difficulty === s}
                  onClick={() => set('difficulty', s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>POINTS</span>
            <input
              className="input"
              style={{ width: 90 }}
              type="number"
              min={0}
              value={l.points ?? ''}
              onChange={(e) => set('points', num(e.target.value))}
            />
          </label>
          <label className="field">
            <span>HINTS USED</span>
            <input
              className="input"
              style={{ width: 90 }}
              type="number"
              min={0}
              value={l.hintsUsed ?? ''}
              onChange={(e) => set('hintsUsed', num(e.target.value))}
            />
          </label>
          <label className="field">
            <span>SOLVED ON</span>
            <input
              className="input"
              style={{ width: 150 }}
              type="date"
              value={l.solvedAt?.slice(0, 10) ?? ''}
              onChange={(e) => set('solvedAt', e.target.value || undefined)}
            />
          </label>
        </div>
        <div className="rowflex">
          <label className="field">
            <span>TIME SPENT (min)</span>
            <input
              className="input"
              style={{ width: 110 }}
              type="number"
              min={0}
              value={l.timeSpentMin ?? ''}
              onChange={(e) => set('timeSpentMin', num(e.target.value))}
            />
          </label>
          <LabTimer
            lab={lab}
            onAdd={(min) => {
              set('timeSpentMin', (l.timeSpentMin ?? 0) + min);
              toast(`Added ${min} min. Save to keep it.`);
            }}
          />
        </div>
        <div className="grid2">
          <EntityPicker
            collection="commands"
            label="COMMANDS USED"
            value={l.commandIds}
            onChange={(v) => set('commandIds', v)}
          />
          <EntityPicker
            collection="concepts"
            label="SKILLS / CONCEPTS USED"
            value={l.conceptIds}
            onChange={(v) => set('conceptIds', v)}
          />
        </div>
        <div className="rowflex" style={{ justifyContent: 'space-between' }}>
          <label className="rowflex" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={l.writeupPrivate}
              onChange={(e) => set('writeupPrivate', e.target.checked)}
            />{' '}
            🔒 Private writeup{' '}
            <span className="faint">(left out of exports unless you include it)</span>
          </label>
          <span className="rowflex">
            <button className="btn" onClick={() => setPreview(!preview)}>
              {preview ? 'Edit' : 'Preview'}
            </button>
            <button className="btn" onClick={() => void exportSanitized()}>
              Export sanitized writeup
            </button>
          </span>
        </div>
        <section className="stack" style={{ gap: 6 }} data-sensitive>
          <span className="faint" style={{ fontSize: 12 }}>
            Flags are never stored by default. The sanitized export also redacts flags, IPs, emails
            and credentials you paste in.
          </span>
          {preview ? (
            <div className="preview card" style={{ padding: 12 }}>
              <MarkdownView source={l.writeup} />
            </div>
          ) : (
            <MarkdownEditor
              label="Writeup"
              value={l.writeup}
              onChange={(v) => set('writeup', v)}
              vimMode={settings.data?.vimMode}
              onSave={() => void save()}
              minHeight={220}
              placeholder="Goal, process, solution, what I learned…"
            />
          )}
        </section>
        <BacklinksPanel id={lab.id} />
        <SaveBar
          dirty={dirty}
          saving={m.patch.isPending}
          onSave={() => void save()}
          onRevert={reset}
          onDelete={async () => {
            if (!confirm) return setConfirm(true);
            await m.remove.mutateAsync(lab.id);
            toast(`Deleted ${lab.title}`);
            onClose();
          }}
          extra={confirm ? <span className="muted">Click Delete again to confirm</span> : null}
        />
      </div>
      {out && (
        <Dialog
          title="Sanitized writeup"
          onClose={() => setOut(null)}
          wide
          footer={
            <>
              <button
                className="btn"
                onClick={() => navigator.clipboard.writeText(out.text).then(() => toast('Copied'))}
              >
                Copy
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(new Blob([out.text], { type: 'text/markdown' }));
                  a.download = `${lab.title.replace(/[^\w -]/g, '')}.md`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >
                Download .md
              </button>
            </>
          }
        >
          <div className="dialog-body">
            <span className="muted">
              {out.redactions} redaction{out.redactions === 1 ? '' : 's'} applied. Review before
              sharing.
            </span>
            {out.invalidPatterns.length > 0 && (
              <span style={{ color: 'var(--warning)' }}>
                Skipped unsafe/invalid custom patterns: {out.invalidPatterns.join(', ')}
              </span>
            )}
            <textarea
              className="textarea"
              readOnly
              rows={14}
              value={out.text}
              aria-label="Sanitized writeup"
            />
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
