import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KeyedMutex, atomicWriteJson, stableStringify } from '../src/index.ts';

async function tmp() {
  return mkdtemp(path.join(os.tmpdir(), 'jsonstore-'));
}

describe('atomicWriteJson', () => {
  it('writes stable pretty JSON and leaves no temp files', async () => {
    const dir = await tmp();
    try {
      const file = path.join(dir, 'nested', 'a.json');
      await atomicWriteJson(file, { b: 1, a: { d: 2, c: 3 } });
      expect(await readFile(file, 'utf8')).toBe(
        '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n',
      );
      expect(await readdir(path.dirname(file))).toEqual(['a.json']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is deterministic regardless of key order', () => {
    expect(stableStringify({ x: 1, y: 2 })).toBe(stableStringify({ y: 2, x: 1 }));
  });
});

describe('KeyedMutex', () => {
  it('serialises work on the same key', async () => {
    const m = new KeyedMutex();
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2].map((i) =>
        m.run('k', async () => {
          await new Promise((r) => setTimeout(r, 10 - i * 3));
          order.push(i);
        }),
      ),
    );
    expect(order).toEqual([0, 1, 2]);
  });

  it('continues after a failed task', async () => {
    const m = new KeyedMutex();
    await expect(m.run('k', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(m.run('k', async () => 'ok')).resolves.toBe('ok');
  });
});
