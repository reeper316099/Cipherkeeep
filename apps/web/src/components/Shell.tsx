import { useMemo } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { APP_NAME } from '@cipherkeep/shared';
import { useHotkeys } from '../lib/hotkeys';
import { useOverview } from '../lib/overview';
import { useLiveEvents, useMeta, useSaveSettings, useSettings } from '../lib/queries';
import { useUI } from '../lib/store';
import { CommandEditor } from '../features/commands/CommandEditor';
import { HelpDialog } from './HelpDialog';
import {
  IconBook,
  IconCalendar,
  IconCode,
  IconEye,
  IconFlask,
  IconFolder,
  IconGear,
  IconGraph,
  IconStudy,
  IconHelp,
  IconHome,
  IconImport,
  IconMoon,
  IconNote,
  IconSearch,
  IconSun,
  IconTerminal,
} from './Icons';
import { Palette } from './Palette';
import { Toasts } from './Toasts';

const NAV = [
  { to: '/', label: 'Home', icon: <IconHome />, end: true },
  { to: '/study', label: 'Review', icon: <IconStudy /> },
  { to: '/commands', label: 'Commands', icon: <IconTerminal />, key: 'commands' },
  { to: '/concepts', label: 'Concepts', icon: <IconBook />, key: 'concepts' },
  { to: '/labs', label: 'Labs', icon: <IconFlask />, key: 'labs' },
  { to: '/projects', label: 'Projects', icon: <IconFolder />, key: 'projects' },
  { to: '/log', label: 'Learning Log', icon: <IconCalendar />, key: 'log' },
  { to: '/notes', label: 'Notes & Guides', icon: <IconNote />, key: 'notes' },
  { to: '/snippets', label: 'Snippets', icon: <IconCode />, key: 'snippets' },
  { to: '/questions', label: 'Questions', icon: <IconHelp /> },
  { to: '/graph', label: 'Graph', icon: <IconGraph /> },
];

export function Shell() {
  const { paletteOpen, setPalette, helpOpen, setHelp, editor, setEditor } = useUI();
  const meta = useMeta();
  const overview = useOverview();
  const settings = useSettings();
  const save = useSaveSettings();
  useLiveEvents();

  const hotkeys = useMemo(
    () => ({
      'mod+k': () => setPalette(!useUI.getState().paletteOpen),
      '?': () => setHelp(true),
      'shift+?': () => setHelp(true),
    }),
    [setPalette, setHelp],
  );
  useHotkeys(hotkeys);

  const s = settings.data;
  const dark = document.documentElement.dataset.theme !== 'light';
  return (
    <div className="app">
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <div className="brand-mark">ck</div>
          <span>{APP_NAME}</span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} aria-label={n.label}>
              {n.icon}
              <span>{n.label}</span>
              {n.key && meta.data && <span className="count">{meta.data.counts[n.key] ?? 0}</span>}
            </NavLink>
          ))}
          <div className="nav-label">Data</div>
          <NavLink to="/import" aria-label="Import">
            <IconImport />
            <span>Import</span>
          </NavLink>
          <NavLink to="/settings" aria-label="Settings">
            <IconGear />
            <span>Settings</span>
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          <button
            className="btn"
            onClick={() => setPalette(true)}
            aria-label="Open command palette"
          >
            <IconSearch /> <span className="muted">Search</span>{' '}
            <span style={{ marginLeft: 'auto' }}>
              <kbd>⌘K</kbd>
            </span>
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div
            className="banner"
            title={overview.data?.banner.threat.explanation ?? 'Computed from your recent practice'}
          >
            [ <b>{APP_NAME.toUpperCase()} HQ</b> ] | STATUS: <b>ACTIVE</b> | MODE: <b>LEARNING</b>
            {overview.data && (
              <>
                {' '}
                | THREAT LEVEL:{' '}
                <b className={`threat threat-${overview.data.banner.threat.level}`}>
                  {overview.data.banner.threat.level}
                </b>
              </>
            )}
          </div>
          <span style={{ flex: 1 }} />
          <button
            className="btn ghost icon"
            aria-label="Toggle sensitive-content blur"
            aria-pressed={!!s?.blurSensitive}
            title="Blur sensitive content (screen sharing)"
            onClick={() => s && save.mutate({ ...s, blurSensitive: !s.blurSensitive })}
          >
            <IconEye off={!!s?.blurSensitive} />
          </button>
          <button
            className="btn ghost icon"
            aria-label="Toggle light/dark theme"
            title="Toggle theme"
            onClick={() => s && save.mutate({ ...s, theme: dark ? 'light' : 'dark' })}
          >
            {dark ? <IconSun /> : <IconMoon />}
          </button>
          <button
            className="btn ghost icon"
            aria-label="Keyboard shortcuts"
            title="Shortcuts (?)"
            onClick={() => setHelp(true)}
          >
            <IconHelp />
          </button>
        </header>
        <main className="page" style={{ padding: 0, overflow: 'hidden' }} id="main">
          <Outlet />
        </main>
      </div>
      {paletteOpen && <Palette onClose={() => setPalette(false)} />}
      {helpOpen && <HelpDialog onClose={() => setHelp(false)} />}
      {editor && <CommandEditor editor={editor} onClose={() => setEditor(null)} />}
      <Toasts />
    </div>
  );
}
