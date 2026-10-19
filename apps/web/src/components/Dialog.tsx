import { useEffect, useRef, type ReactNode } from 'react';

// Open dialogs, top-most last: Esc closes only the top one, wherever keyboard focus happens to be.
const openDialogs: symbol[] = [];

/** Accessible modal: focus trap, Esc to close, restores focus on unmount. */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const id = Symbol('dialog');
    openDialogs.push(id);
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openDialogs[openDialogs.length - 1] === id) {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('keydown', onEsc);
      openDialogs.splice(openDialogs.indexOf(id), 1);
    };
  }, []);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input,textarea,select,button');
    first?.focus();
    return () => prev?.focus?.();
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && ref.current) {
      const f = [
        ...ref.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input,textarea,select,[tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  return (
    <div
      className="scrim center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={onKey}
    >
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={wide ? { width: 'min(860px, calc(100vw - 32px))' } : undefined}
      >
        <div className="dialog-head">
          <span>{title}</span>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}
