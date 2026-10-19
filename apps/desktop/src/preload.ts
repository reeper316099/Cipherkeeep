// Runs sandboxed with contextIsolation: only a small, validated surface reaches the page.
import { contextBridge, ipcRenderer } from 'electron';

interface Boot {
  apiBase: string;
  token: string;
  platform: string;
  version: string;
  dataDir: string;
}
const boot = ipcRenderer.sendSync('ck:bootstrap') as Boot;

contextBridge.exposeInMainWorld('cipherkeep', {
  apiBase: boot.apiBase,
  token: boot.token,
  platform: boot.platform,
  version: boot.version,
  dataDir: boot.dataDir,
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('ck:open-external', url),
  revealInFolder: (p: string): Promise<boolean> => ipcRenderer.invoke('ck:reveal', p),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('ck:open-data-folder'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('ck:pick-folder'),
  /** Validates, optionally copies the current data, then relaunches the app on the new folder. */
  setDataFolder: (target: string, copy: boolean): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke('ck:set-data-folder', target, copy),
  onMenu: (cb: (action: string) => void): (() => void) => {
    const h = (_e: unknown, action: string) => cb(action);
    ipcRenderer.on('ck:menu', h);
    return () => ipcRenderer.removeListener('ck:menu', h);
  },
});
