import type { MenuItemConstructorOptions } from 'electron';

export interface MenuDeps {
  appName: string;
  isMac: boolean;
  isDev: boolean;
  /** Tell the renderer to do something (navigate, open the palette, …). */
  send(action: string): void;
  openDataFolder(): void;
}

const GO: [string, string, string][] = [
  ['Home', '/', 'CmdOrCtrl+1'],
  ['Review', '/study', 'CmdOrCtrl+2'],
  ['Commands', '/commands', 'CmdOrCtrl+3'],
  ['Concepts', '/concepts', 'CmdOrCtrl+4'],
  ['Labs', '/labs', 'CmdOrCtrl+5'],
  ['Projects', '/projects', 'CmdOrCtrl+6'],
  ['Learning Log', '/log', 'CmdOrCtrl+7'],
  ['Notes & Guides', '/notes', 'CmdOrCtrl+8'],
  ['Snippets', '/snippets', 'CmdOrCtrl+9'],
  ['Knowledge Graph', '/graph', ''],
  ['Open Questions', '/questions', ''],
];

export function menuTemplate(d: MenuDeps): MenuItemConstructorOptions[] {
  const t: MenuItemConstructorOptions[] = [];
  if (d.isMac) {
    t.push({
      label: d.appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => d.send('nav:/settings') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }
  t.push({
    label: 'File',
    submenu: [
      { label: 'New Command', accelerator: 'CmdOrCtrl+N', click: () => d.send('new-command') },
      {
        label: 'Import / Export…',
        accelerator: 'CmdOrCtrl+Shift+I',
        click: () => d.send('nav:/import'),
      },
      ...(d.isMac
        ? []
        : ([
            { type: 'separator' },
            { label: 'Settings…', accelerator: 'Ctrl+,', click: () => d.send('nav:/settings') },
            { type: 'separator' },
            { role: 'quit' },
          ] as MenuItemConstructorOptions[])),
      ...(d.isMac
        ? ([{ type: 'separator' }, { role: 'close' }] as MenuItemConstructorOptions[])
        : []),
    ],
  });
  t.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  });
  t.push({
    label: 'View',
    submenu: [
      // Ctrl/⌘+K is handled by the page itself (registering it here too would toggle the palette twice).
      { label: 'Command Palette (Ctrl/⌘ + K)', click: () => d.send('palette') },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(d.isDev
        ? ([
            { type: 'separator' },
            { role: 'reload' },
            { role: 'toggleDevTools' },
          ] as MenuItemConstructorOptions[])
        : []),
    ],
  });
  t.push({
    label: 'Go',
    submenu: GO.map(([label, to, accelerator]) => ({
      label,
      click: () => d.send(`nav:${to}`),
      ...(accelerator ? { accelerator } : {}),
    })),
  });
  t.push({ role: 'windowMenu' });
  t.push({
    role: 'help',
    submenu: [
      { label: 'Keyboard Shortcuts', click: () => d.send('help') },
      { label: 'Show Data Folder', click: () => d.openDataFolder() },
      ...(d.isMac
        ? []
        : ([{ type: 'separator' }, { role: 'about' }] as MenuItemConstructorOptions[])),
    ],
  });
  return t;
}
