import { useState } from 'react';
import { IconEye } from '../../components/Icons';
import { isSensitiveName, useUI } from '../../lib/store';

/** Type a target/IP/file once; every example and copy action updates. Sensitive values stay in memory only. */
export function PlaceholderBar({ names }: { names: string[] }) {
  const values = useUI((s) => s.values);
  const sensitive = useUI((s) => s.sensitive);
  const setValue = useUI((s) => s.setValue);
  const setSensitive = useUI((s) => s.setSensitive);
  const clear = useUI((s) => s.clearValues);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  if (!names.length) return null;
  return (
    <section className="card fillbar" aria-label="Fill in placeholders">
      {names.map((n) => {
        const sens = sensitive[n] ?? isSensitiveName(n);
        return (
          <label key={n}>
            <span>
              {n}
              {sens && <span className="faint"> · not saved</span>}
            </span>
            <span className="rowflex" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <input
                className="input"
                type={sens && !reveal[n] ? 'password' : 'text'}
                autoComplete="off"
                spellCheck={false}
                value={values[n] ?? ''}
                placeholder={`<${n}>`}
                onChange={(e) => setValue(n, e.target.value)}
              />
              <button
                type="button"
                className="btn ghost icon"
                aria-pressed={sens}
                title={
                  sens
                    ? 'Marked sensitive (kept in memory only). Click to allow session storage'
                    : 'Mark sensitive (never stored)'
                }
                aria-label={`Toggle sensitive for ${n}`}
                onClick={() => setSensitive(n, !sens)}
              >
                <IconEye off={sens} />
              </button>
              {sens && (
                <button
                  type="button"
                  className="btn ghost icon"
                  aria-label={`Show ${n}`}
                  onClick={() => setReveal({ ...reveal, [n]: !reveal[n] })}
                >
                  ◔
                </button>
              )}
            </span>
          </label>
        );
      })}
      <button className="btn ghost" onClick={clear}>
        Clear all
      </button>
    </section>
  );
}
