import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness, type Harness, type Json } from './helpers.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE = path.join(ROOT, 'fixtures/synthetic/notion-export');
const REAL = path.join(ROOT, 'private-fixtures/Cyber Security Dashboard.zip');

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(() => h.stop());

const preview = (h2: Harness, body: Record<string, unknown>) =>
  h2.req('POST', '/import/preview', body);
const commit = (
  h2: Harness,
  previewId: string,
  strategy = 'update-empty-only',
  overrides?: Record<string, string>,
) => h2.req('POST', '/import/commit', { previewId, strategy, overrides });
const list = async (h2: Harness, c: string) =>
  (await h2.req('GET', `/${c}?limit=500`)).json.items as Json[];

describe('synthetic Notion export', () => {
  let report: Json;
  let importId: string;

  it('auth is required on import/export routes', async () => {
    for (const [m, p] of [
      ['POST', '/import/preview'],
      ['POST', '/import/commit'],
      ['POST', '/import/undo/x'],
      ['GET', '/export/json'],
      ['GET', '/export/markdown'],
      ['GET', '/export/csv?collection=commands'],
    ] as const) {
      expect((await h.req(m, p, m === 'POST' ? {} : undefined, null)).status).toBe(401);
    }
  });

  it('previews with exact counts and writes nothing', async () => {
    const r = await preview(h, { path: FIXTURE });
    expect(r.status).toBe(200);
    expect(r.json.kind).toBe('notion');
    expect(r.json.counts).toEqual({
      commands: 15,
      concepts: 2,
      projects: 1,
      log: 1,
      notes: 12,
      snippets: 1,
    }); // 12 incl. the hub page, skipped by default
    expect(r.json.templates).toHaveLength(4);
    expect(r.json.attachments).toBe(1);
    expect(r.json.items.find((i: Json) => i.title === 'Lab Dashboard').skipByDefault).toMatch(
      /hub/,
    );
    expect((await h.req('GET', '/meta')).json.counts.commands).toBe(0);
    const cats = r.json.items
      .filter((i: Json) => i.collection === 'commands')
      .map((i: Json) => i.title);
    expect(cats).toHaveLength(15);
    // stash for the next tests
    importId = r.json.previewId;
  });

  it('commits and maps structured fields', async () => {
    const c = await commit(h, importId);
    expect(c.status).toBe(200);
    report = c.json;
    expect(report.created).toEqual({
      commands: 15,
      concepts: 2,
      projects: 1,
      log: 1,
      notes: 11,
      snippets: 1,
    });
    expect(report.skipped).toHaveLength(1);
    expect(report.snapshot).toMatch(/pre-import/);
    expect(report.itemWarnings.find((w: Json) => w.title === 'ls').warnings.join()).toMatch(
      /Ghost Lab/,
    );
    expect(
      report.itemWarnings.find((w: Json) => w.title === 'Directory Tree').warnings.join(),
    ).toMatch(/awk/);

    const cmds = await list(h, 'commands');
    const by = (n: string) => cmds.find((x) => x.name === n)!;
    expect(cmds.filter((x) => x.category === 'File System')).toHaveLength(10);
    expect(cmds.filter((x) => x.category === 'General')).toHaveLength(5);
    expect(by('ls').syntax).toBe('ls [flags] [directory]'); // unescaped
    expect(by('ls').options.map((o: Json) => o.flag)).toEqual(['-a', '-l', '-h', '-t']);
    expect(by('ls').examples.map((e: Json) => e.command)).toEqual([
      'ls -al',
      'ls /var',
      'ls --color=auto',
      'ls -lh ~',
    ]);
    expect(by('ls').examples[2].description).toBe('colourised output');
    expect(by('ls').placeholders).toEqual(['flags', 'directory']);
    expect(by('rm').risk).toBe('destructive');
    expect(by('rm').extras.droppedTemplateHints).toEqual(['(Inputs the command takes.)']);
    expect(by('less').extras.optionsHeading).toBe('Commands');
    expect(by('less').options).toHaveLength(4);
    expect(by('cp').options).toHaveLength(3); // -u row repaired
    expect(by('cp').examples.map((e: Json) => e.command)).toEqual([
      'cp a.txt b.txt',
      'cp one two',
      'cp -r d1 d2',
      'cp -u big small',
    ]);
    expect(by('mv').examples.map((e: Json) => e.command)).toEqual([
      'mv a.txt dir',
      'mv one',
      'mv -i one',
    ]);
    expect(by('mv').examples[1].description).toBe('Runs mv on one.');
    expect(by('cd').options).toHaveLength(3);
    expect(by('ls').links.length).toBe(0); // unresolved Used In link is a warning, not a link

    const concepts = await list(h, 'concepts');
    const tree = concepts.find((c2) => c2.title === 'Directory Tree')!;
    const globs = concepts.find((c2) => c2.title === 'Globs')!;
    expect(tree.sections).toHaveLength(13);
    expect(tree.questionsOpen).toBe(2);
    expect(globs.questionsOpen).toBe(0);
    expect(
      tree.relatedCommandIds.map((id: string) => cmds.find((x) => x.id === id)!.name).sort(),
    ).toEqual(['cd', 'pwd']);
    expect(
      globs.relatedCommandIds.map((id: string) => cmds.find((x) => x.id === id)!.name),
    ).toEqual(['cp', 'ls']);
    expect(tree.tags).toEqual(['Foundations']);
    expect(JSON.stringify(globs.sections)).toContain('[[:digit:]]');

    const [log] = await list(h, 'log');
    expect(log).toMatchObject({ date: '2026-06-03', timeSpentMin: 90, timeSpentRaw: '~1.5 hours' });
    expect(log.commandIds).toHaveLength(1);
    expect(log.conceptIds).toHaveLength(1);
    const [proj] = await list(h, 'projects');
    expect(proj).toMatchObject({
      status: 'In progress',
      type: 'Script',
      skillsUsed: ['Bash', 'Globs'],
    });
    expect(proj.conceptIds).toHaveLength(1);

    const notes = await list(h, 'notes');
    expect(notes.filter((n) => n.title === 'Notes')).toHaveLength(2); // duplicate titles kept
    const cheat = notes.find((n) => n.title === 'Linux Cheat Sheet')!;
    expect(cheat.kind).toBe('cheatsheet');
    expect(cheat.markdown).toContain('> [!TIP]');
    expect(cheat.markdown).toContain('> **▸ Hidden tips**');
    expect(cheat.markdown).toContain('ck://attachments/');
    expect(cheat.markdown).toContain('`ls \\[flags\\]`'); // code spans are never rewritten
    expect(notes.find((n) => n.title === 'Web Notes')!.folder).toBe('study-club/ctf-notes');
    expect(notes.find((n) => n.title === 'SSH Configuration')!.kind).toBe('guide');
    expect((await list(h, 'snippets'))[0]).toMatchObject({
      title: 'Helper Scripts',
      language: 'bash',
    });
    expect(existsSync(path.join(h.dir, 'attachments'))).toBe(true);
    expect(existsSync(path.join(h.dir, 'config/templates/concepts.json'))).toBe(true);
    expect(existsSync(path.join(h.dir, 'imports', report.id, 'manifest.json'))).toBe(true);
  });

  it('is idempotent and never overwrites user edits', async () => {
    const cd = (await list(h, 'commands')).find((x) => x.name === 'cd')!;
    await h.req('PATCH', `/commands/${cd.id}`, { explanation: 'my own words', whatItDoes: '' });
    const again = await commit(h, (await preview(h, { path: FIXTURE })).json.previewId);
    expect(again.json.created).toEqual({});
    expect(again.json.updated).toEqual({ commands: 1 }); // only the field I emptied is refilled
    const after = (await h.req('GET', `/commands/${cd.id}`)).json;
    expect(after.explanation).toBe('my own words');
    expect(after.whatItDoes).not.toBe('');
    const third = await commit(h, (await preview(h, { path: FIXTURE })).json.previewId);
    expect(third.json.updated).toEqual({});
    expect(Object.values(third.json.unchanged).reduce((a: number, b) => a + (b as number), 0)).toBe(
      31,
    );
  });

  it('overwrite replaces fields and undo restores them', async () => {
    const cd = (await list(h, 'commands')).find((x) => x.name === 'cd')!;
    const over = await commit(h, (await preview(h, { path: FIXTURE })).json.previewId, 'overwrite');
    expect(over.json.updated.commands).toBe(1);
    expect((await h.req('GET', `/commands/${cd.id}`)).json.explanation).toBe('change directory');
    expect((await h.req('POST', `/import/undo/${over.json.id}`)).json).toMatchObject({
      removed: 0,
      restored: 1,
    });
    expect((await h.req('GET', `/commands/${cd.id}`)).json.explanation).toBe('my own words');
    expect((await h.req('POST', `/import/undo/${over.json.id}`)).status).toBe(409);
  });

  it('undoing the first import removes everything it created', async () => {
    const u = await h.req('POST', `/import/undo/${report.id}`);
    expect(u.status).toBe(200);
    expect(u.json.removed).toBe(31);
    const counts = (await h.req('GET', '/meta')).json.counts;
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect(existsSync(path.join(h.dir, 'config/templates/concepts.json'))).toBe(false);
    expect((await h.req('GET', '/imports')).json.length).toBeGreaterThan(0);
  });

  it('lets me reclassify loose pages and import the hub page', async () => {
    const p = await preview(h, { path: FIXTURE });
    const find = (t: string) => p.json.items.find((i: Json) => i.title === t).ref;
    const c = await commit(h, p.json.previewId, 'update-empty-only', {
      [find('Helper Scripts')]: 'note',
      [find('Network Cheat Sheet')]: 'snippet',
      [find('Lab Dashboard')]: 'include',
      [find('Windows Cheat Sheet')]: 'skip',
    });
    expect(c.json.created).toMatchObject({ snippets: 1, notes: 11 });
    expect((await list(h, 'snippets'))[0].title).toBe('Network Cheat Sheet');
    expect((await list(h, 'notes')).map((n) => n.title)).toContain('Lab Dashboard');
    expect((await list(h, 'notes')).map((n) => n.title)).not.toContain('Windows Cheat Sheet');
    await h.req('POST', `/import/undo/${c.json.id}`);
  });
});

describe('zip uploads', () => {
  it('imports the same export from an uploaded zip (unicode names, _all.csv dedupe)', async () => {
    const zip = new AdmZip();
    zip.addLocalFolder(FIXTURE);
    const h2 = await harness();
    try {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(zip.toBuffer())]), 'export.zip');
      const res = await fetch(`${h2.s.url}/api/v1/import/preview`, {
        method: 'POST',
        headers: { authorization: `Bearer ${h2.s.token}` },
        body: form,
      });
      const json = (await res.json()) as Json;
      expect(res.status).toBe(200);
      expect(json.counts.commands).toBe(15);
      expect(json.databases.filter((d: Json) => d.collection).length).toBe(5);
      expect((await commit(h2, json.previewId)).json.created.commands).toBe(15);
      expect(
        existsSync(
          path.join(h2.dir, 'imports', (await h2.req('GET', '/imports')).json[0].id, 'export.zip'),
        ),
      ).toBe(true);
    } finally {
      await h2.stop();
    }
  });

  it('ignores zip-slip entries and rejects bad paths', async () => {
    const zip = new AdmZip();
    zip.addFile('../evil.md', Buffer.from('# evil'));
    zip.addFile('safe/ok.md', Buffer.from('# ok\n\nhello'));
    const h2 = await harness();
    try {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(zip.toBuffer())]), 'x.zip');
      const res = await fetch(`${h2.s.url}/api/v1/import/preview`, {
        method: 'POST',
        headers: { authorization: `Bearer ${h2.s.token}` },
        body: form,
      });
      const json = (await res.json()) as Json;
      // adm-zip already flattens `../evil.md` to `evil.md`; either way nothing can escape the virtual fs
      expect(json.items.map((i: Json) => i.title).sort()).toEqual(['evil', 'ok']);
      expect(existsSync(path.join(h2.dir, '..', 'evil.md'))).toBe(false);
      expect((await preview(h2, { path: '/definitely/not/here' })).status).toBe(400);
      expect((await h2.req('POST', '/import/commit', { previewId: 'nope' })).status).toBe(404);
    } finally {
      await h2.stop();
    }
  });
});

describe('exports and round trips', () => {
  let src: Harness;
  beforeAll(async () => {
    src = await harness();
    await commit(src, (await preview(src, { path: FIXTURE })).json.previewId);
    await src.req('POST', '/labs', {
      title: 'Secret Lab',
      platform: 'Bandit',
      writeup: 'the flag is here',
    });
    await src.req('POST', '/labs', {
      title: 'Open Lab',
      platform: 'Bandit',
      writeup: 'public notes',
      writeupPrivate: false,
    });
    await src.req('POST', '/commands', {
      name: '=cmd',
      category: 'General',
      syntax: '=cmd',
      options: [{ flag: '-x', meaning: 'x' }],
    });
  });
  afterAll(() => src.stop());

  const download = async (p: string) => {
    const res = await fetch(`${src.s.url}/api/v1${p}`, {
      headers: { authorization: `Bearer ${src.s.token}` },
    });
    return { res, buf: Buffer.from(await res.arrayBuffer()) };
  };

  it('exports an Obsidian-style vault with frontmatter, wiki-links and relative attachments', async () => {
    const { res, buf } = await download('/export/markdown');
    expect(res.headers.get('content-disposition')).toMatch(/vault/);
    const zip = new AdmZip(buf);
    const text = (n: string) => zip.readAsText(n);
    const ls = text('commands/ls.md');
    expect(ls).toMatch(/^---\nck_collection: commands/);
    expect(ls).toContain('| -a | include dotfiles |');
    expect(ls).toContain('ls --color=auto = "colourised output"');
    expect(text('concepts/Directory Tree.md')).toContain('[[pwd]]');
    expect(text('notes/study-club/linux-cheat-sheet.md')).toContain('](../../attachments/');
    expect(
      zip
        .getEntries()
        .some((e) => e.entryName.startsWith('attachments/') && e.entryName.endsWith('diagram.png')),
    ).toBe(true);
    expect(text('labs/Bandit/Secret Lab.md')).toContain('Private writeup omitted');
    expect(text('labs/Bandit/Secret Lab.md')).not.toContain('flag is here');
    expect(text('labs/Bandit/Open Lab.md')).toContain('public notes');
    const priv = new AdmZip((await download('/export/markdown?includePrivate=true')).buf);
    expect(priv.readAsText('labs/Bandit/Secret Lab.md')).toContain('flag is here');
  });

  it('round-trips the vault through the Markdown-folder importer', async () => {
    const dst = await harness();
    try {
      const { buf } = await download('/export/markdown');
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(buf)]), 'vault.zip');
      const res = await fetch(`${dst.s.url}/api/v1/import/preview`, {
        method: 'POST',
        headers: { authorization: `Bearer ${dst.s.token}` },
        body: form,
      });
      const json = (await res.json()) as Json;
      expect(json.kind).toBe('markdown');
      await commit(dst, json.previewId);
      const a = await list(src, 'commands');
      const b = await list(dst, 'commands');
      for (const cmd of a.filter((x) => x.name !== '=cmd')) {
        const copy = b.find((x) => x.name === cmd.name)!;
        expect(copy, cmd.name).toBeDefined();
        expect(copy.options).toEqual(cmd.options);
        expect(copy.examples.map((e: Json) => e.command)).toEqual(
          cmd.examples.map((e: Json) => e.command),
        );
        expect(copy.syntax).toBe(cmd.syntax);
        expect(copy.risk).toBe(cmd.risk);
      }
      expect(
        (await list(dst, 'concepts')).find((x) => x.title === 'Directory Tree')!.sections,
      ).toHaveLength(13);
    } finally {
      await dst.stop();
    }
  });

  it('exports CSV with formula-injection guard and re-imports it', async () => {
    const { buf, res } = await download('/export/csv?collection=commands');
    expect(res.headers.get('content-type')).toMatch(/csv/);
    const csv = buf.toString('utf8');
    expect(csv).toContain("'=cmd");
    expect(csv.split('\n')[0]).toContain('name');
    const dst = await harness();
    try {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(buf)]), 'commands.csv');
      form.append('collection', 'commands');
      const res2 = await fetch(`${dst.s.url}/api/v1/import/preview`, {
        method: 'POST',
        headers: { authorization: `Bearer ${dst.s.token}` },
        body: form,
      });
      const json = (await res2.json()) as Json;
      expect(json.kind).toBe('csv');
      expect(json.counts.commands).toBe(16);
      await commit(dst, json.previewId);
      const b = await list(dst, 'commands');
      expect(b.find((x) => x.name === '=cmd')!.syntax).toBe('=cmd');
      const ls = b.find((x) => x.name === 'ls')!;
      expect(ls.options).toHaveLength(4);
      expect(ls.tags).toEqual([]);
      // a CSV without a hint cannot be placed
      const bare = new FormData();
      bare.append('file', new Blob(['a,b\n1,2\n']), 'x.csv');
      const r3 = await fetch(`${dst.s.url}/api/v1/import/preview`, {
        method: 'POST',
        headers: { authorization: `Bearer ${dst.s.token}` },
        body: bare,
      });
      expect(r3.status).toBe(400);
    } finally {
      await dst.stop();
    }
    const tpl = (await download('/export/csv-template?collection=labs')).buf.toString('utf8');
    expect(tpl.split('\n')[0]).toContain('platform');
    expect(tpl).not.toContain('createdAt');
  });

  it('restores a full JSON backup with ids and relations intact', async () => {
    const { buf } = await download('/export/json');
    const doc = JSON.parse(buf.toString('utf8'));
    expect(doc).toMatchObject({ app: 'Cipherkeep', format: 1 });
    expect(JSON.stringify(doc)).not.toContain('flag is here'); // private writeup withheld
    const dst = await harness();
    try {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(buf)]), 'backup.json');
      const res = await fetch(`${dst.s.url}/api/v1/import/preview`, {
        method: 'POST',
        headers: { authorization: `Bearer ${dst.s.token}` },
        body: form,
      });
      const json = (await res.json()) as Json;
      expect(json.kind).toBe('json-backup');
      await commit(dst, json.previewId);
      const a = await list(src, 'concepts');
      const b = await list(dst, 'concepts');
      expect(b.map((x) => x.id).sort()).toEqual(a.map((x) => x.id).sort());
      const tree = b.find((x) => x.title === 'Directory Tree')!;
      expect(tree.relatedCommandIds.length).toBe(2);
      expect(tree.createdAt).toBe(a.find((x) => x.title === 'Directory Tree')!.createdAt);
      expect((await dst.req('GET', `/commands/${tree.relatedCommandIds[0]}`)).status).toBe(200);
    } finally {
      await dst.stop();
    }
  });
});

describe.skipIf(!existsSync(REAL))('real export (local only; skipped in CI)', () => {
  it('imports with the expected shape', async () => {
    const h2 = await harness();
    try {
      const p = await preview(h2, { path: REAL });
      expect(p.json.counts).toMatchObject({ commands: 15, concepts: 2, projects: 1, log: 1 });
      expect(p.json.counts.labs ?? 0).toBe(0);
      expect(p.json.templates).toHaveLength(4);
      const c = await commit(h2, p.json.previewId);
      expect(c.json.created.commands).toBe(15);
      const cmds = await list(h2, 'commands');
      expect(cmds.filter((x) => x.category === 'File System')).toHaveLength(10);
      expect(cmds.filter((x) => x.category === 'General')).toHaveLength(5);
      const again = await commit(h2, (await preview(h2, { path: REAL })).json.previewId);
      expect(again.json.created).toEqual({});
      expect(again.json.updated).toEqual({});
      expect(await readFile(path.join(h2.dir, 'meta.json'), 'utf8')).toContain('Cipherkeep');
    } finally {
      await h2.stop();
    }
  });
});
