// Generates a large synthetic library (10k notes, 5k commands by default) and times startup, listing, search
// and the dashboard through the real HTTP API. Usage: npx tsx scripts/bench.ts [notes] [commands]
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ulid } from 'ulid';
import { startServer } from '../packages/server/src/index.ts';

const NOTES = Number(process.argv[2] ?? 10_000);
const COMMANDS = Number(process.argv[3] ?? 5_000);
const WORDS =
  'kernel socket packet handshake payload buffer privilege escalation enumerate banner fingerprint hash salt cipher token session cookie header query shell pipe signal process daemon mount inode symlink checksum archive payload exploit patch advisory'.split(
    ' ',
  );
const rnd = (n: number) => Math.floor(Math.random() * n);
const words = (n: number) => Array.from({ length: n }, () => WORDS[rnd(WORDS.length)]).join(' ');

const dir = mkdtempSync(path.join(os.tmpdir(), 'ck-bench-'));
const now = new Date().toISOString();
const t0 = Date.now();

// notes as real .md files with frontmatter, spread over folders
for (let i = 0; i < NOTES; i++) {
  const folder = `area-${i % 40}/topic-${i % 7}`;
  mkdirSync(path.join(dir, 'data/notes', folder), { recursive: true });
  const id = ulid();
  const body = `# Note ${i} ${words(3)}\n\n${words(150)}\n\n\`\`\`bash\nnmap -sV -p ${rnd(65000)} host${i}\n\`\`\`\n\n${words(120)}\n`;
  writeFileSync(
    path.join(dir, 'data/notes', folder, `note-${i}.md`),
    `---\nid: ${id}\ntitle: Note ${i} ${WORDS[i % WORDS.length]}\nkind: general\ntags:\n  - ${WORDS[i % 9]}\ncreatedAt: ${now}\nupdatedAt: ${now}\n---\n${body}`,
  );
}
// commands as JSON shards
const cats = ['File System', 'Networking', 'Permissions', 'Text Processing', 'General'];
mkdirSync(path.join(dir, 'data/commands'), { recursive: true });
for (const [ci, cat] of cats.entries()) {
  const items = [];
  for (let i = ci; i < COMMANDS; i += cats.length) {
    items.push({
      id: ulid(),
      title: `cmd${i}`,
      slug: `cmd${i}`,
      name: `cmd${i}`,
      category: cat,
      createdAt: now,
      updatedAt: now,
      syntax: `cmd${i} [flags] <target>`,
      explanation: words(8),
      whatItDoes: words(25),
      options: [
        { flag: '-a', meaning: words(4) },
        { flag: `--opt${i}=x`, meaning: words(4) },
      ],
      examples: [{ command: `cmd${i} -a ${WORDS[i % WORDS.length]}`, description: words(5) }],
    });
  }
  writeFileSync(
    path.join(dir, `data/commands/${cat.toLowerCase().replace(/\W+/g, '-')}.json`),
    JSON.stringify({ schemaVersion: 1, data: { items } }),
  );
}
console.log(`generated ${NOTES} notes + ${COMMANDS} commands in ${Date.now() - t0} ms`);

const t1 = Date.now();
const s = await startServer({ dataDir: dir, watch: true });
const startup = Date.now() - t1;
const call = async (p: string) => {
  const t = performance.now();
  const r = await fetch(`${s.url}/api/v1${p}`, { headers: { authorization: `Bearer ${s.token}` } });
  const body = await r.text();
  return { ms: performance.now() - t, bytes: body.length, status: r.status };
};
const stat = async (label: string, paths: string[]) => {
  const rs: { ms: number; bytes: number; status: number }[] = [];
  for (const p of paths) rs.push(await call(p));
  const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  console.log(
    `${label.padEnd(34)} median ${ms[Math.floor(ms.length / 2)]!.toFixed(1).padStart(7)} ms   max ${ms.at(-1)!.toFixed(1).padStart(7)} ms   ${(rs[0]!.bytes / 1024).toFixed(0).padStart(6)} KB   [${rs[0]!.status}]`,
  );
};
console.log(
  `\nstartup (load + index + watch)      ${startup} ms  (heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MB)\n`,
);
const q = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));
await stat(
  'GET /notes?limit=50',
  q(10, () => '/notes?limit=50'),
);
await stat(
  'GET /notes?limit=500 (full bodies)',
  q(5, () => '/notes?limit=500'),
);
await stat(
  'GET /notes?limit=500&omit=markdown',
  q(5, () => '/notes?limit=500&omit=markdown'),
);
await stat(
  'GET /commands?limit=500',
  q(5, () => '/commands?limit=500'),
);
await stat(
  'search "nmap" (all types)',
  q(20, () => '/search?q=nmap'),
);
await stat(
  'search "-sV" flag',
  q(20, () => '/search?q=' + encodeURIComponent('-sV')),
);
await stat(
  'search cmd:cmd42 (5k commands)',
  q(20, (i) => `/search?q=${encodeURIComponent('cmd:cmd' + (40 + i))}`),
);
await stat(
  'search prefix "kern" type=notes',
  q(20, () => '/search?q=kern&type=notes&limit=50'),
);
await stat(
  'GET /graph',
  q(3, () => '/graph?includeOrphans=true'),
);
await stat(
  'GET /stats/overview',
  q(3, () => '/stats/overview'),
);
const first = (
  (await (
    await fetch(`${s.url}/api/v1/notes?limit=1`, {
      headers: { authorization: `Bearer ${s.token}` },
    })
  ).json()) as { items: { id: string }[] }
).items[0]!.id;
await stat(
  'GET /notes/:id',
  q(20, () => `/notes/${first}`),
);
// write path: patch one note while the library is large
const t2 = performance.now();
await fetch(`${s.url}/api/v1/notes/${first}`, {
  method: 'PATCH',
  headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ markdown: 'edited' }),
});
console.log(`PATCH one note                      ${(performance.now() - t2).toFixed(1)} ms`);
await s.close();
rmSync(dir, { recursive: true, force: true });
