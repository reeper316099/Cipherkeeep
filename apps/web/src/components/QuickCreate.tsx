import { useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';

/** Small “name it first” dialog used when creating entities. */
export function QuickCreate({
  title,
  label = 'Title',
  extra,
  onCreate,
  onClose,
}: {
  title: string;
  label?: string;
  extra?: ReactNode;
  onCreate(title: string): Promise<void> | void;
  onClose(): void;
}) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.trim()) return;
    setBusy(true);
    try {
      await onCreate(v.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="dialog-body" onSubmit={go}>
        <label className="field">
          <span>{label.toUpperCase()}</span>
          <input
            className="input"
            value={v}
            onChange={(e) => setV(e.target.value)}
            autoFocus
            required
          />
        </label>
        {extra}
        <div className="rowflex" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !v.trim()}>
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}
