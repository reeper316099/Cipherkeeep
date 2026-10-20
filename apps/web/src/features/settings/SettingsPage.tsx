import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { api, type Settings } from '../../lib/api';
import { keys, useSaveSettings, useSettings } from '../../lib/queries';
import { ACCENT_PRESETS } from '../../lib/theme';
import { useUI } from '../../lib/store';
import { SecurityCard } from '../vault/SecurityCard';

interface Backup {
  name: string;
  createdAt: string;
  reason: string;
  size: number;
}

export function SettingsPage() {
  const settings = useSettings();
  const save = useSaveSettings();
  const toast = useUI((s) => s.toast);
  const qc = useQueryClient();
  const backups = useQuery({ queryKey: keys.backups, queryFn: () => api<Backup[]>('/backups') });
  const [custom, setCustom] = useState('');
  const [move, setMove] = useState<{ target: string; copy: boolean; error?: string } | null>(null);
  const desktop = window.cipherkeep;
  const s = settings.data;
  if (!s) return <div className="pad">Loading…</div>;
  const upd = (p: Partial<Settings>) => save.mutate({ ...s, ...p });
  const Seg = <K extends 'theme' | 'density'>({ k, opts }: { k: K; opts: Settings[K][] }) => (
    <div className="seg" role="group" aria-label={k}>
      {opts.map((o) => (
        <button
          key={o}
          aria-pressed={s[k] === o}
          onClick={() => upd({ [k]: o } as Partial<Settings>)}
        >
          {o}
        </button>
      ))}
    </div>
  );
  return (
    <div className="pad">
      <h1 className="page-title">Settings</h1>
      <div className="settings-grid">
        <section className="card">
          <h2 style={{ margin: 0, fontSize: 14 }}>Appearance</h2>
          <div className="rowflex">
            <span style={{ width: 90 }}>Theme</span>
            <Seg k="theme" opts={['dark', 'light', 'system']} />
          </div>
          <div className="rowflex">
            <span style={{ width: 90 }}>Density</span>
            <Seg k="density" opts={['comfortable', 'compact']} />
          </div>
          <div className="rowflex">
            <span style={{ width: 90 }}>Accent</span>
            <div className="swatches">
              {ACCENT_PRESETS.map((a) => (
                <button
                  key={a.value}
                  className="swatch"
                  style={{ background: a.value }}
                  aria-label={`Accent ${a.name}`}
                  aria-pressed={s.accent.toLowerCase() === a.value}
                  onClick={() => upd({ accent: a.value })}
                />
              ))}
              <input
                type="color"
                aria-label="Custom accent colour"
                value={/^#[0-9a-f]{6}$/i.test(custom || s.accent) ? custom || s.accent : '#38e8c6'}
                onChange={(e) => (setCustom(e.target.value), upd({ accent: e.target.value }))}
              />
            </div>
          </div>
        </section>
        <section className="card">
          <h2 style={{ margin: 0, fontSize: 14 }}>Privacy</h2>
          <label className="rowflex">
            <input
              type="checkbox"
              checked={s.blurSensitive}
              onChange={(e) => upd({ blurSensitive: e.target.checked })}
            />{' '}
            Blur sensitive content (for screen sharing)
          </label>
          <label className="rowflex">
            <input
              type="checkbox"
              checked={s.storeFlagsInLabs}
              onChange={(e) => upd({ storeFlagsInLabs: e.target.checked })}
            />{' '}
            Store flags in labs{' '}
            <span className="faint">(off by default; excluded from search and exports)</span>
          </label>
          <label className="rowflex">
            <input
              type="checkbox"
              checked={s.notionApiEnabled}
              onChange={(e) => upd({ notionApiEnabled: e.target.checked })}
            />{' '}
            Allow importing from the Notion API{' '}
            <span className="faint">
              (off by default; the only thing that goes online, and only to api.notion.com during an
              import)
            </span>
          </label>
          <span className="faint" style={{ fontSize: 12 }}>
            No telemetry and no accounts. Unless you turn on the Notion API import, nothing leaves
            your computer. Placeholder values marked sensitive are never stored.
          </span>
        </section>
        <SecurityCard />
        <section className="card">
          <h2 style={{ margin: 0, fontSize: 14 }}>Study</h2>
          <label className="rowflex">
            New cards per day{' '}
            <input
              className="input"
              style={{ width: 80 }}
              type="number"
              min={0}
              max={100}
              value={s.studyNewPerDay}
              onChange={(e) =>
                upd({ studyNewPerDay: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })
              }
              aria-label="New cards per day"
            />
          </label>
          <span className="faint" style={{ fontSize: 12 }}>
            Reviews that are due always show up; this only limits cards you have never seen.
          </span>
        </section>
        <section className="card">
          <h2 style={{ margin: 0, fontSize: 14 }}>Editor & writeups</h2>
          <label className="rowflex">
            <input
              type="checkbox"
              checked={s.vimMode}
              onChange={(e) => upd({ vimMode: e.target.checked })}
            />{' '}
            Vim key bindings in Markdown editors
          </label>
          <label className="field">
            <span>
              EXTRA REDACTION PATTERNS for “Export sanitized writeup” (regular expressions, one per
              line)
            </span>
            <textarea
              className="textarea"
              rows={3}
              spellCheck={false}
              defaultValue={s.sanitizePatterns.join('\n')}
              placeholder={'lab-\\d+\\.internal\\.test'}
              onBlur={(e) =>
                upd({
                  sanitizePatterns: e.target.value
                    .split('\n')
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .slice(0, 30),
                })
              }
            />
          </label>
          <span className="faint" style={{ fontSize: 12 }}>
            Always redacted: flags like name{'{…}'}, IPv4 addresses, emails, “password: …”, bearer
            tokens, AWS keys, private keys. Patterns with nested quantifiers are skipped.
          </span>
        </section>
        {desktop?.dataDir && (
          <section className="card" aria-label="Data folder">
            <h2 style={{ margin: 0, fontSize: 14 }}>Data folder</h2>
            <code className="mono" style={{ wordBreak: 'break-all' }}>
              {desktop.dataDir}
            </code>
            <div className="rowflex">
              <button className="btn" onClick={() => void desktop.openDataFolder?.()}>
                Show in file manager
              </button>
              <button
                className="btn"
                onClick={async () => {
                  const p = await desktop.pickFolder?.();
                  if (p) setMove({ target: p, copy: true });
                }}
              >
                Change…
              </button>
            </div>
            <span className="faint" style={{ fontSize: 12 }}>
              Everything lives here as plain JSON and Markdown. Set CIPHERKEEP_DATA_DIR to override
              it for a single launch.
            </span>
          </section>
        )}
        <section className="card">
          <h2 style={{ margin: 0, fontSize: 14 }}>Backups</h2>
          <div className="rowflex">
            <button
              className="btn"
              onClick={async () => {
                await api('/backups', { method: 'POST', json: { reason: 'manual' } });
                void qc.invalidateQueries({ queryKey: keys.backups });
                toast('Backup created');
              }}
            >
              Create backup now
            </button>
            <span className="faint">
              Kept: newest {s.backupKeep}. Automatic on launch if the last one is over{' '}
              {s.backupIntervalHours} h old, and before every import or bulk delete.
            </span>
          </div>
          <table className="flags">
            <tbody>
              {(backups.data ?? []).slice(0, 8).map((b) => (
                <tr key={b.name}>
                  <td>{new Date(b.createdAt).toLocaleString()}</td>
                  <td>{b.reason}</td>
                  <td className="faint">{(b.size / 1024).toFixed(0)} KB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      {move && (
        <Dialog
          title="Move data folder"
          onClose={() => setMove(null)}
          footer={
            <>
              <button className="btn" onClick={() => setMove(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={async () => {
                  const r = await desktop?.setDataFolder?.(move.target, move.copy);
                  if (r && !r.ok) setMove({ ...move, error: r.reason });
                }}
              >
                Move and restart
              </button>
            </>
          }
        >
          <div className="dialog-body">
            <span>New folder:</span>
            <code className="mono" style={{ wordBreak: 'break-all' }}>
              {move.target}
            </code>
            <label className="rowflex">
              <input
                type="checkbox"
                checked={move.copy}
                onChange={(e) => setMove({ ...move, copy: e.target.checked })}
              />{' '}
              Copy my current data there first (recommended)
            </label>
            <span className="faint" style={{ fontSize: 12 }}>
              The app restarts on the new folder. Your old folder is left untouched.
            </span>
            {move.error && (
              <div role="alert" style={{ color: 'var(--danger)' }}>
                {move.error}
              </div>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
