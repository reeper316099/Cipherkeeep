import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { APP_NAME } from '@cipherkeep/shared';
import { ApiError, LOCKED_EVENT, api } from '../../lib/api';
import {
  dropCached,
  useForgetEverything,
  useVaultStatus,
  vaultKey,
  type VaultStatus,
} from '../../lib/vault';

/** Shows the unlock screen instead of the app while an encrypted library is locked. */
export function VaultGate({ children }: { children: ReactNode }) {
  const status = useVaultStatus();
  const qc = useQueryClient();
  const forget = useForgetEverything();
  useEffect(() => {
    const on = () => {
      if (qc.getQueryData<VaultStatus>(vaultKey)?.locked !== true) forget(true);
    };
    window.addEventListener(LOCKED_EVENT, on);
    return () => window.removeEventListener(LOCKED_EVENT, on);
  }, [qc, forget]);

  if (status.isLoading) return <div className="gate" aria-busy="true" />;
  if (status.data?.locked) return <UnlockScreen />;
  return <>{children}</>;
}

function UnlockScreen() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase');
  const [passphrase, setPassphrase] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [fresh, setFresh] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/vault/unlock', {
        method: 'POST',
        json:
          mode === 'passphrase'
            ? { passphrase }
            : { recoveryKey, newPassphrase: fresh || undefined },
      });
      dropCached(qc);
      qc.setQueryData<VaultStatus>(vaultKey, { enabled: true, locked: false, busy: false });
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'BAD_CREDENTIALS'
          ? mode === 'passphrase'
            ? 'That passphrase is not right.'
            : 'That recovery key is not right.'
          : err instanceof Error
            ? err.message
            : 'Could not unlock.',
      );
    } finally {
      setBusy(false);
      setPassphrase('');
      setFresh('');
    }
  };

  return (
    <main className="gate" id="main">
      <form className="card gate-card" onSubmit={submit} aria-labelledby="gate-title">
        <div className="brand-mark" aria-hidden="true">
          ck
        </div>
        <h1 id="gate-title" style={{ margin: 0, fontSize: 18 }}>
          {APP_NAME} is locked
        </h1>
        <span className="faint">Your library is encrypted on this computer.</span>
        {mode === 'passphrase' ? (
          <label className="field">
            <span>PASSPHRASE</span>
            <input
              className="input"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </label>
        ) : (
          <>
            <label className="field">
              <span>RECOVERY KEY</span>
              <input
                className="input mono"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                value={recoveryKey}
                onChange={(e) => setRecoveryKey(e.target.value)}
              />
            </label>
            <label className="field">
              <span>NEW PASSPHRASE (at least 10 characters)</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={fresh}
                onChange={(e) => setFresh(e.target.value)}
              />
            </label>
          </>
        )}
        {error && (
          <div role="alert" className="gate-error">
            {error}
          </div>
        )}
        <button
          className="btn primary"
          type="submit"
          disabled={
            busy || (mode === 'passphrase' ? !passphrase : !recoveryKey || fresh.length < 10)
          }
        >
          {busy ? 'Unlocking…' : mode === 'passphrase' ? 'Unlock' : 'Unlock and set new passphrase'}
        </button>
        <button
          className="btn ghost"
          type="button"
          onClick={() => {
            setMode(mode === 'passphrase' ? 'recovery' : 'passphrase');
            setError('');
          }}
        >
          {mode === 'passphrase' ? 'Use my recovery key instead' : 'Use my passphrase instead'}
        </button>
      </form>
    </main>
  );
}
