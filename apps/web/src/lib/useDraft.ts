import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Local editable copy of a server entity. Re-seeds when the entity id changes, or when the server copy
 * changes while there are no unsaved edits (live refresh after a hand edit or import).
 */
export function useDraft<T extends { id: string }>(source: T | undefined) {
  const [draft, setDraft] = useState<T | undefined>(source);
  const base = useRef<string>(JSON.stringify(source ?? null));
  const dirty = draft !== undefined && JSON.stringify(draft) !== base.current;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    const next = JSON.stringify(source ?? null);
    if (source && (source.id !== draft?.id || !dirtyRef.current)) {
      base.current = next;
      setDraft(source);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const set = useCallback(
    <K extends keyof T>(k: K, v: T[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d)),
    [],
  );
  const reset = useCallback(() => {
    if (source) setDraft(source);
  }, [source]);
  const markSaved = useCallback((saved: T) => {
    base.current = JSON.stringify(saved);
    setDraft(saved);
  }, []);
  return { draft, set, dirty, reset, markSaved, setDraft };
}
