import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { useUI } from '../lib/store';

interface Info {
  license: string;
  counts: { commands: number; concepts: number; notes: number; labs: number };
  loaded: number;
}

/** First-run choice and import-page card: load the bundled, original MIT starter content. */
export function useStarterPack() {
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const info = useQuery({ queryKey: ['starter-pack'], queryFn: () => api<Info>('/starter-pack') });
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const r = await api<{ created: Record<string, number> }>('/starter-pack/load', {
        method: 'POST',
        json: {},
      });
      const n = Object.values(r.created).reduce((a, b) => a + b, 0);
      toast(
        n
          ? `Loaded ${n} starter items. You can undo this from Import / Export.`
          : 'The starter pack was already loaded.',
      );
      void qc.invalidateQueries();
    } catch {
      toast('Could not load the starter pack.', { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return { info: info.data, busy, load };
}

export function StarterPackCard() {
  const { info, busy, load } = useStarterPack();
  if (!info) return null;
  const c = info.counts;
  return (
    <section className="card" aria-label="Starter pack">
      <h2 style={{ margin: 0, fontSize: 15 }}>Starter pack</h2>
      <p className="muted" style={{ margin: 0 }}>
        Original, MIT-licensed content written for Cipherkeep: {c.commands} commands, {c.concepts}{' '}
        concepts, {c.notes} cheat sheets and guides, and {c.labs} practice labs. It never overwrites
        what you have written, and you can undo it.
      </p>
      <div className="rowflex">
        <button className="btn primary" onClick={() => void load()} disabled={busy}>
          {info.loaded > 0 ? 'Load again (fills anything missing)' : 'Load the starter pack'}
        </button>
        {info.loaded > 0 && (
          <span className="faint">{info.loaded} items from it are already in your library.</span>
        )}
      </div>
    </section>
  );
}
