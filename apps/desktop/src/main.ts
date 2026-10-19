import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { APP_NAME } from '@cipherkeep/shared';
import { resolveDataDir, startServer, type RunningServer } from '@cipherkeep/server';
import { menuTemplate } from './menu.ts';
import {
  allowRequest,
  fitBounds,
  isAppUrl,
  isRevealablePath,
  isSafeExternalUrl,
  validateNewDataDir,
  type Bounds,
} from './security.ts';

app.setName(APP_NAME);
// The data directory is the standard per-OS app-data folder. Everything Electron itself writes (Chromium
// profile, single-instance socket, window state) goes in a hidden subfolder so the data folder stays tidy
// and file-watchable; backups skip it.
const SESSION_DIR = '.electron-session';
// With CIPHERKEEP_DATA_DIR the whole app (data and Electron's own files) lives in that folder: handy for
// portable use and for tests that must not touch the real profile.
const defaultUserData = process.env.CIPHERKEEP_DATA_DIR
  ? path.resolve(process.env.CIPHERKEEP_DATA_DIR)
  : app.getPath('userData'); // the data folder
app.setPath('userData', path.join(defaultUserData, SESSION_DIR));
app.setPath('crashDumps', path.join(defaultUserData, SESSION_DIR, 'crashes'));

const isDev = !app.isPackaged && process.env.CIPHERKEEP_DEV_TOOLS === '1';
let server: RunningServer | undefined;
let win: BrowserWindow | undefined;
let dataDir = '';
let origin = '';
let quitting = false;

const pointerFile = path.join(defaultUserData, SESSION_DIR, 'location.json');
function readPointer(): string | undefined {
  try {
    const v = (JSON.parse(readFileSync(pointerFile, 'utf8')) as { dataDir?: string }).dataDir;
    return v && path.isAbsolute(v) && existsSync(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function logLine(msg: string): void {
  try {
    const dir = path.join(dataDir || defaultUserData, 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, 'main.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* logging must never take the app down */
  }
}
process.on('uncaughtException', (e) => logLine(`uncaughtException ${e?.name}: ${e?.message}`));
process.on('unhandledRejection', (e) =>
  logLine(`unhandledRejection ${(e as Error)?.message ?? String(e)}`),
);

/* ---------- window state ---------- */
const stateFile = () => path.join(defaultUserData, SESSION_DIR, 'window-state.json');
function loadState(): Bounds | undefined {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8')) as Bounds;
  } catch {
    return undefined;
  }
}
function saveState(w: BrowserWindow): void {
  try {
    const b = w.isMaximized() || w.isFullScreen() ? undefined : w.getBounds();
    const prev = loadState();
    mkdirSync(path.dirname(stateFile()), { recursive: true });
    writeFileSync(
      stateFile(),
      JSON.stringify({
        ...(b ?? prev ?? { width: 1280, height: 820 }),
        maximized: w.isMaximized(),
      }),
    );
  } catch {
    /* best effort */
  }
}

function createWindow(): void {
  const bounds = fitBounds(
    loadState(),
    screen.getAllDisplays().map((d) => d.workArea),
    { width: 1280, height: 820 },
  );
  win = new BrowserWindow({
    ...bounds,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: APP_NAME,
    backgroundColor: '#090c12',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: isDev,
    },
  });
  if (bounds.maximized) win.maximize();
  win.once('ready-to-show', () => win?.show());

  let t: ReturnType<typeof setTimeout> | undefined;
  const queueSave = () => {
    clearTimeout(t);
    t = setTimeout(() => win && !win.isDestroyed() && saveState(win), 300);
  };
  win.on('resize', queueSave);
  win.on('move', queueSave);
  win.on('close', () => win && saveState(win));
  win.on('closed', () => (win = undefined));

  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!isAppUrl(url, origin)) {
      e.preventDefault();
      if (isSafeExternalUrl(url)) void shell.openExternal(url);
    }
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  void win.loadURL(origin + '/');
}

function installMenu(): void {
  const send = (action: string) => {
    if (!win || win.isDestroyed()) createWindow();
    win?.webContents.send('ck:menu', action);
    win?.show();
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      menuTemplate({
        appName: APP_NAME,
        isMac: process.platform === 'darwin',
        isDev,
        send,
        openDataFolder: () => void shell.openPath(dataDir),
      }),
    ),
  );
}

/* ---------- IPC (every handler checks the sender is our own page) ---------- */
const senderOk = (e: IpcMainEvent | IpcMainInvokeEvent) =>
  !!e.senderFrame && isAppUrl(e.senderFrame.url, origin);

function registerIpc(): void {
  ipcMain.on('ck:bootstrap', (e) => {
    e.returnValue = senderOk(e)
      ? {
          apiBase: '',
          token: server!.token,
          platform: process.platform,
          version: app.getVersion(),
          dataDir,
        }
      : null;
  });
  ipcMain.handle('ck:open-external', async (e, url: unknown) => {
    if (!senderOk(e) || !isSafeExternalUrl(url)) return false;
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle('ck:reveal', (e, p: unknown) => {
    if (!senderOk(e) || !isRevealablePath(p) || !existsSync(p)) return false;
    shell.showItemInFolder(p); // shows the file in the file manager; never opens or runs it
    return true;
  });
  ipcMain.handle('ck:open-data-folder', async (e) => {
    if (senderOk(e)) await shell.openPath(dataDir);
  });
  ipcMain.handle('ck:pick-folder', async (e) => {
    if (!senderOk(e) || !win) return null;
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a data folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle('ck:set-data-folder', async (e, target: unknown, copy: unknown) => {
    if (!senderOk(e)) return { ok: false, reason: 'Not allowed.' };
    const v = validateNewDataDir(target, dataDir);
    if (!v.ok) return v;
    try {
      const t = path.resolve(target as string);
      mkdirSync(t, { recursive: true });
      if (copy === true && !existsSync(path.join(t, 'meta.json'))) {
        await server?.close(); // release the lock and flush writes before copying
        server = undefined;
        cpSync(dataDir, t, {
          recursive: true,
          filter: (src) => !/[\\/](\.lock|\.electron-session)$/.test(src),
        });
      }
      mkdirSync(path.dirname(pointerFile), { recursive: true });
      writeFileSync(pointerFile, JSON.stringify({ dataDir: t }));
      quitting = true;
      await server?.close();
      app.relaunch();
      app.exit(0);
      return { ok: true };
    } catch (err) {
      logLine(`set-data-folder failed: ${(err as Error).message}`);
      return { ok: false, reason: 'Could not move the data. Nothing was changed.' };
    }
  });
}

/* ---------- lifecycle ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    dataDir = resolveDataDir({ userData: readPointer() ?? defaultUserData });
    try {
      server = await startServer({
        dataDir,
        port: 0,
        staticDir: path.join(__dirname, '..', 'web'),
      });
    } catch (err) {
      const locked = (err as { code?: string })?.code === 'LOCKED';
      dialog.showErrorBox(
        APP_NAME,
        locked
          ? `${APP_NAME} is already using this data folder:\n${dataDir}\n\nClose the other copy and try again.`
          : `${APP_NAME} could not start its local data service.\n\n${(err as Error).message}`,
      );
      app.exit(1);
      return;
    }
    origin = new URL(server.url).origin;

    // Zero-network policy: the window may only reach its own loopback server; sensitive APIs are denied.
    const ses = session.defaultSession;
    ses.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (details, cb) => cb({ cancel: !allowRequest(details.url, origin) }),
    );
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);

    registerIpc();
    installMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (e) => {
    if (quitting || !server) return;
    e.preventDefault();
    quitting = true;
    void server.close().finally(() => app.exit(0));
  });
}
