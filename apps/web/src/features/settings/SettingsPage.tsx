import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Settings } from '../../lib/api';
import { keys, useSaveSettings, useSettings } from '../../lib/queries';
import { ACCENT_PRESETS } from '../../lib/theme';
import { useUI } from '../../lib/store';

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
          <span className="faint" style={{ fontSize: 12 }}>
            No telemetry, no accounts, no network calls. Placeholder values marked sensitive are
            never stored.
          </span>
        </section>
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
    </div>
  );
}
