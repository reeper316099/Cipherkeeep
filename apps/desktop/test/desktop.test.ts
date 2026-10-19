import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  allowRequest,
  fitBounds,
  isAppUrl,
  isRevealablePath,
  isSafeExternalUrl,
  validateNewDataDir,
} from '../src/security.ts';
import { menuTemplate } from '../src/menu.ts';

describe('external links', () => {
  it('allows only plain http(s) and mailto links', () => {
    for (const ok of ['https://example.com/a?b=1', 'http://example.com', 'mailto:a@b.co'])
      expect(isSafeExternalUrl(ok), ok).toBe(true);
    for (const bad of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<script>',
      'vbscript:x',
      'ssh://host',
      'smb://x/y',
      'https://user:pw@example.com',
      '',
      'not a url',
      42,
      null,
      `https://example.com/${'a'.repeat(3000)}`,
    ]) {
      expect(isSafeExternalUrl(bad), String(bad)).toBe(false);
    }
  });
});

describe('network policy: the window may only reach its own loopback origin', () => {
  const origin = 'http://127.0.0.1:5555';
  it('allows the app origin and blocks everything else', () => {
    expect(allowRequest('http://127.0.0.1:5555/api/v1/health', origin)).toBe(true);
    expect(isAppUrl('http://127.0.0.1:5555/', origin)).toBe(true);
    for (const bad of [
      'https://example.com/x',
      'http://127.0.0.1:5556/',
      'http://localhost:5555/',
      'http://127.0.0.1.evil.test:5555/',
      'ws://127.0.0.1:9/',
      'garbage',
    ]) {
      expect(allowRequest(bad, origin), bad).toBe(false);
    }
  });
});

describe('reveal-in-folder paths', () => {
  it('accepts only absolute, bounded, NUL-free strings', () => {
    expect(isRevealablePath(path.resolve('/tmp/a.py'))).toBe(true);
    for (const bad of ['relative/path', '', '/tmp/a\0b', 5, undefined, '/' + 'x'.repeat(5000)])
      expect(isRevealablePath(bad)).toBe(false);
  });
});

describe('moving the data folder', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'ck-desktop-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('accepts a missing, empty, or existing-Cipherkeep folder', () => {
    const current = path.join(root, 'current');
    mkdirSync(current);
    expect(validateNewDataDir(path.join(root, 'new'), current)).toEqual({ ok: true });
    const empty = path.join(root, 'empty');
    mkdirSync(empty);
    writeFileSync(path.join(empty, '.DS_Store'), '');
    expect(validateNewDataDir(empty, current)).toEqual({ ok: true });
    const existing = path.join(root, 'existing');
    mkdirSync(existing);
    writeFileSync(path.join(existing, 'meta.json'), '{}');
    writeFileSync(path.join(existing, 'x.txt'), '');
    expect(validateNewDataDir(existing, current)).toEqual({ ok: true });
  });

  it('rejects the same folder, nesting, other people’s folders, files, and relative paths', () => {
    const current = path.join(root, 'current');
    mkdirSync(current);
    const reject = (t: unknown) => validateNewDataDir(t, current) as { ok: false; reason: string };
    expect(reject(current).ok).toBe(false);
    expect(reject(path.join(current, 'inner')).reason).toMatch(/inside/);
    expect(reject(root).reason).toMatch(/inside|contain/); // parent of the current folder
    const other = path.join(root, 'documents');
    mkdirSync(other);
    writeFileSync(path.join(other, 'taxes.pdf'), '');
    expect(reject(other).reason).toMatch(/not empty/);
    const file = path.join(root, 'file.txt');
    writeFileSync(file, '');
    expect(reject(file).reason).toMatch(/file/);
    expect(reject('relative').ok).toBe(false);
    expect(reject(undefined).ok).toBe(false);
  });
});

describe('window bounds', () => {
  const displays = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 1920, y: 0, width: 1280, height: 1024 },
  ];
  const dflt = { width: 1280, height: 820 };
  it('restores visible bounds and maximised state', () => {
    expect(
      fitBounds({ x: 100, y: 80, width: 1000, height: 700, maximized: true }, displays, dflt),
    ).toEqual({ x: 100, y: 80, width: 1000, height: 700, maximized: true });
    expect(fitBounds({ x: 2000, y: 40, width: 900, height: 600 }, displays, dflt).x).toBe(2000); // second monitor
  });
  it('falls back when the display is gone, the window is off-screen, or the data is nonsense', () => {
    expect(fitBounds({ x: 5000, y: 5000, width: 900, height: 600 }, displays, dflt)).toEqual(dflt);
    expect(fitBounds({ x: -880, y: 0, width: 900, height: 600 }, displays, dflt)).toEqual(dflt); // only 20px visible
    expect(fitBounds(undefined, displays, dflt)).toEqual(dflt);
    expect(fitBounds({ x: 0, y: 0, width: 10, height: 10 }, displays, dflt)).toEqual(dflt);
    expect(fitBounds({ x: 0, y: 0, width: NaN, height: 700 }, displays, dflt)).toEqual(dflt);
    expect(fitBounds({ x: 0, y: 0, width: 5000, height: 3000 }, displays, dflt).width).toBe(5000); // large but partly visible is kept
  });
  it('keeps a saved maximised flag even if bounds are unusable', () => {
    expect(
      fitBounds({ x: 9000, y: 9000, width: 900, height: 600, maximized: true }, displays, dflt),
    ).toEqual({ ...dflt, maximized: true });
  });
});

describe('application menu', () => {
  const build = (o: Partial<Parameters<typeof menuTemplate>[0]> = {}) => {
    const send = vi.fn();
    const openDataFolder = vi.fn();
    return {
      t: menuTemplate({
        appName: 'Cipherkeep',
        isMac: false,
        isDev: false,
        send,
        openDataFolder,
        ...o,
      }),
      send,
      openDataFolder,
    };
  };
  const find = (items: ReturnType<typeof menuTemplate>, label: string) =>
    (items.find((m) => m.label === label)?.submenu ?? []) as {
      label?: string;
      click?: () => void;
      accelerator?: string;
      role?: string;
    }[];

  it('navigates and triggers actions via the renderer', () => {
    const { t, send, openDataFolder } = build();
    find(t, 'Go').find((i) => i.label === 'Commands')!.click!();
    find(t, 'Go').find((i) => i.label === 'Review')!.click!();
    find(t, 'File').find((i) => i.label === 'New Command')!.click!();
    find(t, 'View')[0]!.click!();
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      'nav:/commands',
      'nav:/study',
      'new-command',
      'palette',
    ]);
    const help = t.find((m) => m.role === 'help')!.submenu as {
      label?: string;
      click?: () => void;
    }[];
    help.find((i) => i.label === 'Show Data Folder')!.click!();
    expect(openDataFolder).toHaveBeenCalled();
  });

  it('never registers Ctrl/⌘+K (the page owns it; a second binding would toggle the palette twice)', () => {
    const { t } = build();
    const all = JSON.stringify(t);
    expect(all).not.toMatch(/(CmdOrCtrl|Ctrl|Cmd)\+K/i);
    expect(find(t, 'View')[0]!.accelerator).toBeUndefined();
  });

  it('has the native app menu on macOS only, and dev tools only in dev', () => {
    expect(build({ isMac: true }).t[0]!.label).toBe('Cipherkeep');
    expect(build({ isMac: false }).t[0]!.label).toBe('File');
    const roles = (isDev: boolean) => find(build({ isDev }).t, 'View').map((i) => i.role);
    expect(roles(false)).not.toContain('toggleDevTools');
    expect(roles(true)).toContain('toggleDevTools');
  });

  it('gives each Go destination a number shortcut that does not clash with page keys', () => {
    const acc = find(build().t, 'Go')
      .map((i) => i.accelerator)
      .filter(Boolean) as string[];
    expect(acc).toHaveLength(9);
    expect(new Set(acc).size).toBe(9);
    expect(acc.every((a) => a.startsWith('CmdOrCtrl+'))).toBe(true);
  });
});
