import { Dialog } from './Dialog';

const KEYS: [string, string][] = [
  ['Ctrl/⌘ + K', 'Command palette: type a command, Enter copies its primary example'],
  ['/', 'Focus search'],
  ['N', 'New command'],
  ['E', 'Edit the selected command'],
  ['C', 'Copy the selected command’s primary example (placeholders filled)'],
  ['↑ / ↓', 'Move through the list'],
  ['1 – 4', 'Set mastery 0–3 on the selected command'],
  ['?', 'This help'],
  ['Esc', 'Close dialogs'],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <div className="dialog-body">
        {KEYS.map(([k, d]) => (
          <div
            key={k}
            style={{
              display: 'grid',
              gridTemplateColumns: '130px 1fr',
              gap: 12,
              alignItems: 'center',
            }}
          >
            <span>
              {k.split(' + ').map((p) => (
                <kbd key={p} style={{ marginRight: 4 }}>
                  {p}
                </kbd>
              ))}
              {!k.includes('+') && null}
            </span>
            <span className="muted">{d}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
