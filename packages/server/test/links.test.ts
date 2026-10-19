import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { harness, type Harness, type Json } from './helpers.ts';

let h: Harness;
let ls: Json;
let tree: Json;
let note: Json;
let lab: Json;
beforeAll(async () => {
  h = await harness();
  ls = (await h.req('POST', '/commands', { name: 'ls', category: 'File System' })).json;
  tree = (
    await h.req('POST', '/concepts', {
      title: 'Directory Tree',
      sections: [{ key: 'a', title: 'A', markdown: 'see [[cmd:ls]] and [[:upper:]]' }],
      relatedCommandIds: [ls.id],
    })
  ).json;
  note = (
    await h.req('POST', '/notes', {
      title: 'Cheat',
      markdown: 'uses [[Directory Tree]] and [[Nope]] and `[[ls]]`',
    })
  ).json;
  lab = (
    await h.req('POST', '/labs', {
      title: 'Bandit 1',
      platform: 'Bandit',
      writeup:
        'The flag is picoCTF{abc123xyz} from 10.1.2.3, mail me@example.com, password: hunter2',
      commandIds: [ls.id],
    })
  ).json;
});
afterAll(() => h.stop());

describe('backlinks and graph', () => {
  it('combines relation fields and resolved wiki-links, ignoring code and glob classes', async () => {
    const back = (await h.req('GET', `/entities/${ls.id}/backlinks`)).json as Json[];
    expect(back.map((b) => `${b.type}:${b.title}:${b.kind}`).sort()).toEqual([
      'concepts:Directory Tree:relation',
      'labs:Bandit 1:relation',
    ]);
    const treeBack = (await h.req('GET', `/entities/${tree.id}/backlinks`)).json as Json[];
    expect(treeBack).toEqual([
      expect.objectContaining({ type: 'notes', title: 'Cheat', kind: 'wikilink' }),
    ]);
    const out = (await h.req('GET', `/entities/${note.id}/links`)).json as Json[];
    expect(out.map((o) => o.title)).toEqual(['Directory Tree']); // [[Nope]] unresolved, `[[ls]]` in code ignored
  });

  it('serves a typed graph and keeps links fresh after edits', async () => {
    const g = (await h.req('GET', '/graph')).json;
    expect(g.nodes.map((n: Json) => n.title).sort()).toEqual([
      'Bandit 1',
      'Cheat',
      'Directory Tree',
      'ls',
    ]);
    expect(g.edges).toHaveLength(3); // concept→ls counted once although linked both ways
    expect((await h.req('GET', '/graph?types=commands,labs')).json.edges).toHaveLength(1);
    await h.req('DELETE', `/concepts/${tree.id}`);
    expect((await h.req('GET', `/entities/${ls.id}/backlinks`)).json).toHaveLength(1);
    expect(
      (await h.req('GET', '/graph?includeOrphans=true')).json.nodes.some(
        (n: Json) => n.title === 'Cheat',
      ),
    ).toBe(true);
    expect((await h.req('GET', '/graph?types=bogus')).status).toBe(404);
  });
});

describe('sanitized writeup', () => {
  it('redacts flags, IPs, emails and credentials, plus user patterns', async () => {
    const r = (await h.req('POST', `/labs/${lab.id}/sanitized-writeup`)).json;
    expect(r.text).toBe(
      'The flag is [FLAG REDACTED] from [IP], mail [EMAIL], password: [REDACTED]',
    );
    expect(r.redactions).toBe(4);
    await h.req('PUT', '/settings', {
      ...(await h.req('GET', '/settings')).json,
      sanitizePatterns: ['from \\[IP\\]', '(a+)+$'],
    });
    const r2 = (await h.req('POST', `/labs/${lab.id}/sanitized-writeup`)).json;
    expect(r2.text).toContain('[REDACTED]');
    expect(r2.invalidPatterns).toEqual(['(a+)+$']);
    expect((await h.req('POST', '/labs/nope/sanitized-writeup')).status).toBe(404);
  });
});

describe('attachments', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  const upload = (name: string, data: Buffer, token = h.s.token) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)]), name);
    return fetch(`${h.s.url}/api/v1/attachments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  };
  it('stores a pasted image and serves it back with safe headers', async () => {
    const res = await upload('shot one.png', png);
    expect(res.status).toBe(201);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/^ck:\/\/attachments\/[0-9a-f]{8}\/shot%20one\.png$/);
    const [, , , hash, file] = url.split('/');
    expect(existsSync(path.join(h.dir, 'attachments', hash!, decodeURIComponent(file!)))).toBe(
      true,
    );
    const got = await fetch(`${h.s.url}/api/v1/attachments/${hash}/${file}`, {
      headers: { authorization: `Bearer ${h.s.token}` },
    });
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await got.arrayBuffer()).equals(png)).toBe(true);
  });
  it('rejects non-images, wrong magic bytes, traversal and unauthenticated access', async () => {
    expect((await upload('x.html', Buffer.from('<script>alert(1)</script>'))).status).toBe(415);
    expect((await upload('x.png', Buffer.from('not a png'))).status).toBe(415);
    expect((await upload('x.png', png, 'wrong')).status).toBe(401);
    expect((await h.req('GET', '/attachments/zzzzzzzz/x.png')).status).toBe(404);
    expect((await h.req('GET', '/attachments/abcdef12/..%2Fmeta.json')).status).toBe(404);
  });
});
