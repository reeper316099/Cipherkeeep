import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  AesGcmCodec,
  BackupManager,
  BYTES_MAGIC,
  EncryptionError,
  JsonStore,
  PlainCodec,
  isEncrypted,
  openRaw,
  sealRaw,
} from '../src/index.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'jsonstore-enc-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SENTINEL = 'ZEBRA-SENTINEL-4471';
const opts = { version: 1, defaults: () => ({ items: [] as { id: string; text: string }[] }) };

describe('codecs', () => {
  const key = randomBytes(32);

  it('round-trips bytes, text and lines, with a fresh IV every time', () => {
    const c = new AesGcmCodec(key);
    const a = c.encodeText(SENTINEL);
    const b = c.encodeText(SENTINEL);
    expect(a.equals(b)).toBe(false);
    expect(isEncrypted(a)).toBe(true);
    expect(a.subarray(0, 8).equals(BYTES_MAGIC)).toBe(true);
    expect(a.includes(Buffer.from(SENTINEL))).toBe(false);
    expect(c.decodeText(a)).toBe(SENTINEL);
    const line = c.encodeLine(SENTINEL);
    expect(line).not.toContain(SENTINEL);
    expect(c.decodeLine(line)).toBe(SENTINEL);
    const bin = randomBytes(5000);
    expect(c.decode(c.encode(bin)).equals(bin)).toBe(true);
  });

  it('fails closed on a wrong key, tampering and truncation', () => {
    const c = new AesGcmCodec(key);
    const enc = c.encodeText('secret');
    expect(() => new AesGcmCodec(randomBytes(32)).decodeText(enc)).toThrow(EncryptionError);
    const flipped = Buffer.from(enc);
    flipped[flipped.length - 1]! ^= 1;
    expect(() => c.decodeText(flipped)).toThrow(EncryptionError);
    expect(() => c.decodeText(enc.subarray(0, 20))).toThrow(EncryptionError);
    expect(() => openRaw(key, Buffer.alloc(3))).toThrow(EncryptionError);
  });

  it('passes plaintext through when keyed, but refuses ciphertext when unkeyed', () => {
    const c = new AesGcmCodec(key);
    expect(c.decodeText(Buffer.from('plain'))).toBe('plain');
    expect(() => new PlainCodec().decodeText(c.encodeText('x'))).toThrow(
      expect.objectContaining({ code: 'ENCRYPTED' }),
    );
    expect(() => new PlainCodec().decodeLine(c.encodeLine('x'))).toThrow(EncryptionError);
    expect(openRaw(key, sealRaw(key, Buffer.from('k'))).toString()).toBe('k');
  });
});

describe('JsonStore with encryption', () => {
  it('writes ciphertext to disk, reads it back, and rewrites existing files on key change', async () => {
    const store = new JsonStore(dir);
    const f = await store.open('data/a.json', opts);
    await f.update((d) => void d.items.push({ id: '1', text: SENTINEL }));
    expect(await readFile(path.join(dir, 'data/a.json'), 'utf8')).toContain(SENTINEL);

    store.codec.set(new AesGcmCodec(randomBytes(32)));
    await store.rewriteAll();
    const raw = await readFile(path.join(dir, 'data/a.json'));
    expect(isEncrypted(raw)).toBe(true);
    expect(raw.includes(Buffer.from(SENTINEL))).toBe(false);

    await f.update((d) => void d.items.push({ id: '2', text: 'more' }));
    expect(f.data.items).toHaveLength(2);
    expect(raw.length).toBeGreaterThan(0);
  });

  it('loads encrypted files with the key, and never quarantines or overwrites them without it', async () => {
    const key = randomBytes(32);
    const s1 = new JsonStore(dir);
    s1.codec.set(new AesGcmCodec(key));
    const f = await s1.open('data/a.json', opts);
    await f.update((d) => void d.items.push({ id: '1', text: SENTINEL }));
    const before = await readFile(path.join(dir, 'data/a.json'));

    const locked = new JsonStore(dir);
    await expect(locked.open('data/a.json', opts)).rejects.toMatchObject({ code: 'ENCRYPTED' });
    const wrong = new JsonStore(dir);
    wrong.codec.set(new AesGcmCodec(randomBytes(32)));
    await expect(wrong.open('data/a.json', opts)).rejects.toMatchObject({
      code: 'DECRYPT_FAILED',
    });
    expect((await readFile(path.join(dir, 'data/a.json'))).equals(before)).toBe(true);
    expect(await readdir(dir)).not.toContain('.quarantine');

    const s2 = new JsonStore(dir);
    s2.codec.set(new AesGcmCodec(key));
    expect((await s2.open('data/a.json', opts)).data.items[0]!.text).toBe(SENTINEL);
  });

  it('keeps ciphertext in backups and can restore a damaged file from one', async () => {
    const key = randomBytes(32);
    const backups = new BackupManager({ dataDir: dir, backupDir: path.join(dir, 'backups') });
    const s = new JsonStore(dir, backups);
    s.codec.set(new AesGcmCodec(key));
    const f = await s.open('data/a.json', opts);
    await f.update((d) => void d.items.push({ id: '1', text: SENTINEL }));
    const b = await backups.create('test');
    const zip = await readFile(b.file);
    expect(zip.includes(Buffer.from(SENTINEL))).toBe(false);

    await writeFile(path.join(dir, 'data/a.json'), 'garbage{');
    const s2 = new JsonStore(dir, backups);
    s2.codec.set(new AesGcmCodec(key));
    const f2 = await s2.open('data/a.json', opts);
    expect(f2.data.items[0]!.text).toBe(SENTINEL);
  });
});
