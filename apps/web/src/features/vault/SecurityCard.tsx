import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { ApiError, api } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { useUI } from '../../lib/store';
import { vaultKey, useLockNow, useVaultStatus } from '../../lib/vault';

const MIN = 10;
const message = (e: unknown) =>
  e instanceof ApiError || e instanceof Error ? e.message : 'Failed';

/** Optional encryption at rest: turn it on or off, lock now, change the passphrase, replace the recovery key. */
export function SecurityCard() {
  const status = useVaultStatus();
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const lock = useLockNow();
  const [recovery, setRecovery] = useState<string | null>(null);
  const [panel, setPanel] = useState<'enable' | 'change' | 'recovery' | 'disable' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [current, setCurrent] = useState('');
  const [deleteOld, setDeleteOld] = useState(true);

  const enabled = !!status.data?.enabled;
  const close = () => {
    setPanel(null);
    setError('');
    setPass('');
    setPass2('');
    setCurrent('');
  };
  const refresh = () => qc.invalidateQueries({ queryKey: vaultKey });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const next = panel === 'enable' ? pass : pass2;
      if ((panel === 'enable' || panel === 'change') && next.length < MIN)
        throw new Error(`Use at least ${MIN} characters.`);
      if (panel === 'enable') {
        if (pass !== pass2) throw new Error('The two passphrases differ.');
        const r = await api<{ recoveryKey: string }>('/vault/enable', {
          method: 'POST',
          json: { passphrase: pass, deleteOldBackups: deleteOld },
        });
        setRecovery(r.recoveryKey);
        toast('Encryption is on');
      } else if (panel === 'change') {
        await api('/vault/change-passphrase', {
          method: 'POST',
          json: { current, next: pass2 },
        });
        toast('Passphrase changed');
      } else if (panel === 'recovery') {
        const r = await api<{ recoveryKey: string }>('/vault/recovery-key', {
          method: 'POST',
          json: { passphrase: current },
        });
        setRecovery(r.recoveryKey);
      } else if (panel === 'disable') {
        await api('/vault/disable', { method: 'POST', json: { passphrase: current } });
        toast('Encryption is off');
      }
      close();
      await refresh();
      void qc.invalidateQueries({ queryKey: ['backups'] });
    });
  };

  const title =
    panel === 'enable'
      ? 'Encrypt my library'
      : panel === 'change'
        ? 'Change passphrase'
        : panel === 'recovery'
          ? 'Make a new recovery key'
          : 'Turn off encryption';

  return (
    <section className="card" aria-label="Encryption">
      <h2 style={{ margin: 0, fontSize: 14 }}>Encryption</h2>
      {!enabled ? (
        <>
          <span className="faint" style={{ fontSize: 12 }}>
            Optional. Encrypts your notes, commands, progress and backups on this computer (AES-256)
            so they cannot be read from the data folder without your passphrase. It does not hide
            anything while the app is unlocked.
          </span>
          <div>
            <button className="btn" onClick={() => setPanel('enable')}>
              Encrypt my library…
            </button>
          </div>
        </>
      ) : (
        <>
          <span style={{ fontSize: 13 }}>
            <b>Encryption is on.</b>{' '}
            <span className="faint">The app asks for your passphrase each time it starts.</span>
          </span>
          <div className="rowflex">
            <button className="btn" onClick={() => lock.mutate()} disabled={lock.isPending}>
              Lock now
            </button>
            <button className="btn ghost" onClick={() => setPanel('change')}>
              Change passphrase…
            </button>
            <button className="btn ghost" onClick={() => setPanel('recovery')}>
              New recovery key…
            </button>
            <button className="btn ghost" onClick={() => setPanel('disable')}>
              Turn off…
            </button>
          </div>
          <span className="faint" style={{ fontSize: 12 }}>
            Exports you create are plain files by design. Keep them somewhere safe.
          </span>
        </>
      )}

      {panel && (
        <Dialog
          title={title}
          onClose={close}
          footer={
            <>
              <button className="btn ghost" type="button" onClick={close}>
                Cancel
              </button>
              <button className="btn primary" type="submit" form="vault-form" disabled={busy}>
                {busy ? 'Working…' : panel === 'disable' ? 'Turn off encryption' : 'Continue'}
              </button>
            </>
          }
        >
          <form id="vault-form" className="stack" onSubmit={submit}>
            {panel === 'enable' && (
              <>
                <p style={{ margin: 0 }}>
                  <b>
                    If you lose both your passphrase and the recovery key, your data cannot be
                    recovered.
                  </b>{' '}
                  Nobody can reset it for you: there is no account and no server. You will be shown
                  a recovery key next. Store it somewhere safe and separate.
                </p>
                <label className="field">
                  <span>PASSPHRASE (at least {MIN} characters)</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>REPEAT PASSPHRASE</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={pass2}
                    onChange={(e) => setPass2(e.target.value)}
                  />
                </label>
                <label className="rowflex">
                  <input
                    type="checkbox"
                    checked={deleteOld}
                    onChange={(e) => setDeleteOld(e.target.checked)}
                  />{' '}
                  Delete older backups (they were made before encryption and are readable)
                </label>
              </>
            )}
            {panel === 'change' && (
              <>
                <label className="field">
                  <span>CURRENT PASSPHRASE</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>NEW PASSPHRASE (at least {MIN} characters)</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={pass2}
                    onChange={(e) => setPass2(e.target.value)}
                  />
                </label>
              </>
            )}
            {(panel === 'recovery' || panel === 'disable') && (
              <>
                <p style={{ margin: 0 }}>
                  {panel === 'recovery'
                    ? 'The current recovery key stops working as soon as you make a new one.'
                    : 'Your library is decrypted back to plain files. Backups made while encryption was on stay encrypted and need your passphrase to restore.'}
                </p>
                <label className="field">
                  <span>PASSPHRASE</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                </label>
              </>
            )}
            {error && (
              <div role="alert" className="gate-error">
                {error}
              </div>
            )}
          </form>
        </Dialog>
      )}

      {recovery && <RecoveryKeyDialog value={recovery} onDone={() => setRecovery(null)} />}
    </section>
  );
}

function RecoveryKeyDialog({ value, onDone }: { value: string; onDone: () => void }) {
  const toast = useUI((s) => s.toast);
  const [saved, setSaved] = useState(false);
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([`Recovery key: ${value}\n`], { type: 'text/plain;charset=utf-8' }),
    );
    a.download = 'recovery-key.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };
  return (
    <Dialog
      title="Your recovery key"
      onClose={() => saved && onDone()}
      footer={
        <button className="btn primary" disabled={!saved} onClick={onDone}>
          Done
        </button>
      }
    >
      <div className="stack">
        <p style={{ margin: 0 }}>
          This is the only way back in if you forget your passphrase. It is shown once. Write it
          down or save it in a password manager, and keep it away from this computer.
        </p>
        <code
          className="mono"
          style={{ fontSize: 16, letterSpacing: 1, wordBreak: 'break-all' }}
          data-sensitive
        >
          {value}
        </code>
        <div className="rowflex">
          <button
            className="btn"
            onClick={async () => toast((await copyText(value)) ? 'Copied' : 'Copy failed')}
          >
            Copy
          </button>
          <button className="btn" onClick={download}>
            Save as file
          </button>
        </div>
        <label className="rowflex">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I
          have stored my recovery key somewhere safe
        </label>
      </div>
    </Dialog>
  );
}
