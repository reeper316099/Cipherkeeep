import { useEffect } from 'react';

export function SaveBar({
  dirty,
  saving,
  onSave,
  onRevert,
  onDelete,
  extra,
}: {
  dirty: boolean;
  saving?: boolean;
  onSave(): void;
  onRevert(): void;
  onDelete?: () => void;
  extra?: React.ReactNode;
}) {
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => dirty && e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  return (
    <div className="savebar">
      <button className="btn primary" onClick={onSave} disabled={!dirty || saving}>
        Save <kbd>⌘S</kbd>
      </button>
      <button className="btn" onClick={onRevert} disabled={!dirty}>
        Revert
      </button>
      {extra}
      {dirty && (
        <span className="dirty" role="status">
          ● unsaved changes
        </span>
      )}
      {onDelete && (
        <button className="btn danger" style={{ marginLeft: 'auto' }} onClick={onDelete}>
          Delete
        </button>
      )}
    </div>
  );
}
