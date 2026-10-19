import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer, type RunningServer } from '../src/index.ts';

// Test responses are untyped JSON; assertions check the shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface Harness {
  s: RunningServer;
  dir: string;
  req(
    method: string,
    p: string,
    body?: unknown,
    token?: string | null,
  ): Promise<{ status: number; json: Json; headers: Headers }>;
  stop(): Promise<void>;
}

export async function harness(watch = false, dir?: string): Promise<Harness> {
  const d = dir ?? (await mkdtemp(path.join(os.tmpdir(), 'ck-server-')));
  const s = await startServer({ dataDir: d, watch });
  return {
    s,
    dir: d,
    async req(method, p, body, token) {
      const t = token === undefined ? s.token : token;
      const res = await fetch(`${s.url}/api/v1${p}`, {
        method,
        headers: {
          ...(t ? { authorization: `Bearer ${t}` } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
    },
    async stop() {
      await s.close();
      if (!dir) await rm(d, { recursive: true, force: true });
    },
  };
}

export const SAMPLES: Record<string, Record<string, unknown>> = {
  commands: { name: 'ls', category: 'File System', syntax: 'ls [flags] [directory]' },
  concepts: { title: 'Linux File System', category: 'Linux' },
  labs: { title: 'Bandit 0', platform: 'Bandit' },
  projects: { title: 'Printer Control', type: 'Script' },
  log: { title: 'Day one', date: '2026-03-24' },
  notes: { title: 'SSH Guide', folder: 'Guides', markdown: '# SSH\n' },
  snippets: { title: 'one-liner', language: 'bash', code: 'echo hi' },
};
