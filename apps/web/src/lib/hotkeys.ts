import { useEffect } from 'react';

export function isTyping(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  if (!e) return false;
  return e.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName);
}

/** Single-key shortcuts ignore typing contexts; combos like `mod+k` always fire. */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const combo = mod ? `mod+${key}` : key;
      const fn = map[combo] ?? (e.shiftKey && !mod ? map[`shift+${key}`] : undefined);
      if (!fn) return;
      if (!mod && (isTyping(e.target) || e.altKey)) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [map, enabled]);
}
