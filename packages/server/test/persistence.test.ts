import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveDataDir } from '../src/index.ts';
import { harness } from './helpers.ts';

describe('persistence & live reload', () => {
  it('survives restart and enforces the single-instance lock', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ck-persist-'));
    try {
      const a = await harness(false, dir);
      const id = (await a.req('POST', '/commands', { name: 'cp', category: 'File System' })).json
        .id;
      await expect(harness(false, dir)).rejects.toMatchObject({ code: 'LOCKED' });
      await a.stop();
      const b = await harness(false, dir);
      expect((await b.req('GET', `/commands/${id}`)).json.name).toBe('cp');
      expect((await b.req('GET', '/meta')).json.counts.commands).toBe(1);
      await b.stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reloads hand-edited JSON and notes, ignores invalid edits', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ck-live-'));
    try {
      const h = await harness(true, dir);
      const c = (await h.req('POST', '/commands', { name: 'rm', category: 'File System' })).json;
      const file = path.join(dir, 'data/commands/file-system.json');
      const doc = JSON.parse(await readFile(file, 'utf8'));
      doc.data.items[0].explanation = 'edited by hand';
      const changed = new Promise<void>((r) => h.s.ctx.bus.once('reload', () => r()));
      await writeFile(file, JSON.stringify(doc));
      await changed;
      expect((await h.req('GET', `/commands/${c.id}`)).json.explanation).toBe('edited by hand');
      expect((await h.req('GET', '/search?q=cmd:rm')).json.hits).toHaveLength(1);

      const bad = new Promise<{ line?: number }>((r) => h.s.ctx.bus.once('invalid', r));
      await writeFile(file, '{\n "schemaVersion": 1,\n oops');
      expect((await bad).line).toBeTypeOf('number');
      expect((await h.req('GET', `/commands/${c.id}`)).json.explanation).toBe('edited by hand');

      const n = (await h.req('POST', '/notes', { title: 'Live', markdown: 'one' })).json;
      const nf = path.join(dir, 'data/notes/live.md');
      const up = new Promise<void>((r) =>
        h.s.ctx.repos.notes.on('upsert', (e) => e.markdown === 'two' && r()),
      );
      await writeFile(nf, (await readFile(nf, 'utf8')).replace('one', 'two'));
      await up;
      expect((await h.req('GET', `/notes/${n.id}`)).json.markdown).toBe('two');
      await h.stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveDataDir', () => {
  it('follows env override then OS conventions', () => {
    expect(resolveDataDir({ env: { CIPHERKEEP_DATA_DIR: '/x/y' } })).toBe(path.resolve('/x/y'));
    expect(resolveDataDir({ env: {}, platform: 'darwin', home: '/Users/a' })).toBe(
      '/Users/a/Library/Application Support/Cipherkeep',
    );
    expect(resolveDataDir({ env: {}, platform: 'linux', home: '/home/a' })).toBe(
      '/home/a/.config/Cipherkeep',
    );
    expect(
      resolveDataDir({ env: { XDG_CONFIG_HOME: '/cfg' }, platform: 'linux', home: '/home/a' }),
    ).toBe('/cfg/Cipherkeep');
    expect(
      resolveDataDir({
        env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' },
        platform: 'win32',
        home: 'C:\\Users\\a',
      }),
    ).toBe('C:\\Users\\a\\AppData\\Roaming\\Cipherkeep');
  });
});
