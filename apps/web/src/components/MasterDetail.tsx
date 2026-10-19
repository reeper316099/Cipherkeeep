import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, type ReactNode } from 'react';

/** Left list (virtualized) + right detail, reusing the command-library layout. */
export function MasterDetail<T>({
  tools,
  items,
  rowHeight = 52,
  getId,
  selectedId,
  renderRow,
  onOpen,
  detail,
  empty,
  footer,
  label,
  onMove,
}: {
  tools: ReactNode;
  items: T[];
  rowHeight?: number;
  getId(t: T): string;
  selectedId?: string;
  renderRow(t: T, selected: boolean): ReactNode;
  onOpen(t: T): void;
  detail: ReactNode;
  empty: ReactNode;
  footer?: ReactNode;
  label: string;
  onMove?(delta: number): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: items.length,
    getScrollElement: () => ref.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });
  return (
    <div className={`library ${selectedId ? 'has-detail' : ''}`}>
      <section className="lib-left" aria-label={`${label} list`}>
        <div className="lib-tools">{tools}</div>
        <div
          className="lib-list"
          ref={ref}
          tabIndex={0}
          role="listbox"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              onMove?.(e.key === 'ArrowDown' ? 1 : -1);
            }
          }}
        >
          {items.length === 0 && empty}
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {virt.getVirtualItems().map((vi) => {
              const it = items[vi.index]!;
              const sel = getId(it) === selectedId;
              return (
                <div
                  key={getId(it)}
                  className="row row-tall"
                  role="option"
                  aria-selected={sel}
                  style={{ transform: `translateY(${vi.start}px)`, height: vi.size }}
                  onClick={() => onOpen(it)}
                >
                  {renderRow(it, sel)}
                </div>
              );
            })}
          </div>
        </div>
        {footer && <div className="lib-foot">{footer}</div>}
      </section>
      {selectedId ? (
        detail
      ) : (
        <div className="empty detail-empty" style={{ alignContent: 'center' }}>
          <h3>Nothing selected</h3>
          <span>Pick an item on the left, or create a new one.</span>
        </div>
      )}
    </div>
  );
}
