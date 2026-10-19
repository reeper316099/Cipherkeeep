// Generates a fake Notion-style export with invented content into fixtures/synthetic/notion-export.
// It reproduces the structural quirks of a real export (see docs/NOTION_IMPORT.md); no personal data.
// Usage: npm run fixtures:generate
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/synthetic/notion-export',
);
const id = (seed: string) => createHash('sha1').update(seed).digest('hex').slice(0, 32);
const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const BOM = '\uFEFF';
rmSync(OUT, { recursive: true, force: true });

function put(rel: string, content: string | Buffer) {
  const abs = path.join(OUT, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
const csv = (rows: string[][]) =>
  BOM +
  rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
    .join('\n') +
  '\n';

const ROOT = 'Lab Dashboard';
const DB = {
  commands: '💻 Commands',
  concepts: '📚 Cyber Concepts',
  labs: '🧪 Labs',
  projects: '🛠️ Projects',
  log: '📅 Learning Log',
};
const dbId = Object.fromEntries(Object.keys(DB).map((k) => [k, id('db-' + k)]));
const pagePath = (db: keyof typeof DB, title: string) =>
  `${ROOT}/${DB[db]}/${title} ${id(db + title)}.md`;

// ---------- commands ----------
interface Cmd {
  name: string;
  cat: 'File System' | 'General';
  syntax: string;
  example: string;
  explanation: string;
  what: string;
  args?: string[];
  opts?: [string, string][];
  optsHeading?: string;
  examples: [string, string][];
  extra?: string;
  hint?: boolean;
}
const cmds: Cmd[] = [
  {
    name: 'ls',
    cat: 'File System',
    syntax: 'ls \\[flags\\] \\[directory\\]',
    example: 'ls -al',
    explanation: 'list directory entries',
    what: 'Prints the entries of a directory.',
    args: ['directory → folder to list'],
    opts: [
      ['-a', 'include dotfiles'],
      ['-l', 'long listing'],
      ['-h', 'sizes in K/M/G'],
      ['-t', 'newest first'],
    ],
    examples: [
      ['ls /var', 'list /var'],
      ['ls --color=auto', 'colourised output'],
      ['ls -lh ~', 'long listing of home, human sizes'],
    ],
  },
  {
    name: 'pwd',
    cat: 'File System',
    syntax: 'pwd',
    example: 'pwd',
    explanation: 'print working directory',
    what: 'Shows where you are.',
    examples: [['pwd', 'print the current folder']],
  },
  {
    name: 'cd',
    cat: 'File System',
    syntax: 'cd \\[directory\\]',
    example: 'cd ~',
    explanation: 'change directory',
    what: 'Moves into another folder.',
    args: ['directory → destination'],
    opts: [
      ['cd', 'jump home'],
      ['cd -', 'jump back'],
      ['cd ..', 'one level up'],
    ],
    optsHeading: '🔧 Common Options (Flags)',
    examples: [['cd ~/projects', 'enter projects']],
  },
  {
    name: 'file',
    cat: 'File System',
    syntax: 'file \\[filename\\]',
    example: 'file photo.jpg',
    explanation: 'detect file type',
    what: 'Guesses a file type from content.',
    args: ['filename → target file'],
    examples: [['file photo.jpg', 'report the type of photo.jpg']],
  },
  {
    name: 'less',
    cat: 'File System',
    syntax: 'less \\[filename\\]',
    example: 'less log.txt',
    explanation: 'page through a file',
    what: 'Scrollable file viewer.',
    args: ['filename → file to view'],
    optsHeading: '🔧 Commands',
    opts: [
      ['space', 'next page'],
      ['b', 'previous page'],
      ['/text', 'search forward'],
      ['q', 'quit'],
    ],
    examples: [['less log.txt', 'view log.txt']],
  },
  {
    name: 'mkdir',
    cat: 'File System',
    syntax: 'mkdir \\[directory\\]',
    example: 'mkdir demo',
    explanation: 'create folders',
    what: 'Makes new directories.',
    args: ['directory → name to create'],
    examples: [
      ['mkdir demo', 'create demo'],
      ['mkdir a b', 'create two folders'],
    ],
  },
  {
    name: 'cp',
    cat: 'File System',
    syntax: 'cp \\[source\\] \\[destination\\]',
    example: 'cp a.txt b.txt',
    explanation: 'copy files',
    what: 'Duplicates files or folders.',
    args: ['source → what to copy', 'destination → where it goes'],
    opts: [
      ['-r', 'copy folders recursively'],
      ['-i', 'ask before overwriting'],
      ['-u', 'copy only when the source is newer or missing'],
    ],
    examples: [['cp a.txt b.txt', 'copy a.txt to b.txt']],
    extra: 'headerless-table',
  },
  {
    name: 'mv',
    cat: 'File System',
    syntax: 'mv \\[source\\] \\[destination\\]',
    example: 'mv a.txt dir',
    explanation: 'move or rename',
    what: 'Moves or renames files.',
    args: ['source → item to move', 'destination → new place or name'],
    opts: [
      ['-i', 'confirm overwrite'],
      ['-n', 'never overwrite'],
    ],
    examples: [['mv a.txt dir', 'move a.txt into dir']],
    extra: 'header-table',
  },
  {
    name: 'rm',
    cat: 'File System',
    syntax: 'rm \\[target\\]',
    example: 'rm old.txt',
    explanation: 'delete files',
    what: 'Removes files or folders permanently.',
    args: ['target → what to remove'],
    hint: true,
    opts: [
      ['-r', 'recurse into folders'],
      ['-f', 'never prompt'],
      ['-i', 'prompt each time'],
    ],
    examples: [['rm old.txt', 'delete old.txt']],
    extra: 'header-table',
  },
  {
    name: 'ln',
    cat: 'File System',
    syntax: 'ln \\[target\\] \\[link\\]',
    example: 'ln -s real alias',
    explanation: 'make links',
    what: 'Creates hard or symbolic links.',
    args: ['target → existing item', 'link → new name'],
    opts: [['-s', 'symbolic link']],
    examples: [
      ['ln data data-hard', 'hard link'],
      ['ln -s data data-soft', 'symbolic link'],
    ],
  },
  {
    name: 'df',
    cat: 'General',
    syntax: 'df',
    example: 'df',
    explanation: 'disk space',
    what: 'Free space per mounted disk.',
    examples: [['df', 'show disk usage']],
  },
  {
    name: 'free',
    cat: 'General',
    syntax: 'free',
    example: 'free',
    explanation: 'memory usage',
    what: 'Shows RAM and swap.',
    examples: [['free', 'show memory']],
  },
  {
    name: 'exit',
    cat: 'General',
    syntax: 'exit',
    example: 'exit',
    explanation: 'leave the shell',
    what: 'Ends the session.',
    examples: [['exit', 'close this shell']],
  },
  {
    name: 'type',
    cat: 'General',
    syntax: 'type \\[command\\]',
    example: 'type ls',
    explanation: 'how a name resolves',
    what: 'Tells you if a name is a builtin, alias or file.',
    args: ['command → name to look up'],
    examples: [['type ls', 'resolve ls']],
  },
  {
    name: 'which',
    cat: 'General',
    syntax: 'which \\[command\\]',
    example: 'which ls',
    explanation: 'locate an executable',
    what: 'Prints the path of a program.',
    args: ['command → program name'],
    examples: [['which ls', 'path of ls']],
  },
];

function cmdPage(c: Cmd): string {
  const body: string[] = [
    `# ${c.name}`,
    '',
    `Category: ${c.cat}`,
    `Example: ${c.example}`,
    `Explanation: ${c.explanation}`,
    `Syntax: ${c.syntax}`,
    '',
    '## 📌 What it does',
    '',
    c.what,
    '',
    '---',
    '',
    '## ⚙️ Basic Syntax',
    '',
    c.syntax,
    '',
  ];
  if (c.args) {
    body.push('---', '', '## 🧩 Arguments', '');
    if (c.hint) body.push('(Inputs the command takes.)', '');
    body.push(...c.args.map((a) => `- ${a}`), '');
  }
  if (c.opts) {
    body.push(
      '---',
      '',
      `## ${c.optsHeading ?? '🔧 Common Options (Flags)'}`,
      '',
      '| Option | Meaning |',
      '| --- | --- |',
      ...c.opts.map(([a, b]) => `| ${a} | ${b} |`),
      '',
    );
  }
  body.push(
    '---',
    '',
    '## 💡 Examples',
    '',
    '```bash',
    ...c.examples.map(([a, b]) => (b ? `${a} = "${b}"` : a)),
    '```',
    '',
  );
  if (c.extra === 'headerless-table') {
    body.push(
      '| cp one two  | Copy one to two, replacing two if it exists. |',
      '| --- | --- |',
      '| cp -r d1 d2  | Copy folder d1 into d2. |',
      '| cp -u big small | Only copy newer\nfiles into the destination. |',
      '',
    );
  }
  if (c.extra === 'header-table') {
    body.push(
      '| Command | Results |',
      '| --- | --- |',
      `| \`${c.name} one\` | Runs *${c.name}* on **one**. |`,
      `| \`${c.name} -i one\` | Same, but with a prompt. |`,
      '',
    );
  }
  return body.join('\n');
}

const cmdRows = [
  ['Commands', 'Category', 'Syntax', 'Example', 'Explanation', 'Used In'],
  ...cmds.map((c) => [
    c.name,
    c.cat,
    c.syntax,
    c.example,
    c.explanation,
    c.name === 'ls' ? `Ghost Lab (${enc(`${ROOT}/${DB.labs}/Ghost Lab ${id('ghost')}.md`)})` : '',
  ]),
];
put(`${ROOT}/${DB.commands} ${dbId.commands}.csv`, csv(cmdRows));
put(`${ROOT}/${DB.commands} ${dbId.commands}_all.csv`, csv(cmdRows));
for (const c of cmds) put(pagePath('commands', c.name), cmdPage(c));
put(
  pagePath('commands', 'Command Template'),
  '# Command Template\n\n## 📌 What it does\n\n(A simple explanation.)\n\n---\n\n## ⚙️ Basic Syntax\n\ncommand [options] [arguments]\n\n---\n\n## 💡 Examples\n\n```bash\ncommand example\n```\n',
);

// ---------- concepts ----------
const SECTIONS = [
  '🧠 What is it?',
  '⚙️ How it works (Step-by-step)',
  '🧩 Key Components',
  '🔁 Example / Walkthrough',
  '💡 Why it matters',
  '⚔️ Security Relevance',
  '🛠️ Tools / Commands Related',
  '🔗 Related Concepts',
  '⚠️ Common Mistakes / Misconceptions',
  '🧠 Intuition (VERY IMPORTANT)',
  '📚 Source / Where I learned this',
  '🔥 Difficulty Level',
  '❓ Questions I still have',
];
const cmdLink = (n: string) =>
  `${n} (${enc(`${ROOT}/${DB.commands}/${n} ${id('commands' + n)}.md`)})`;
const conceptPage = (
  name: string,
  relCmds: string[],
  bodies: Record<string, string>,
  relProp: string,
) => {
  const parts = [
    `# ${name}`,
    '',
    'Category: Linux',
    'Difficulty: Easy',
    ...(relProp ? [`Related Commands: ${relProp}`] : []),
    'Tags: Foundations',
    '',
  ];
  for (const s of SECTIONS) parts.push(`## ${s}`, '', bodies[s] ?? '- ', '', '---', '');
  return parts.join('\n').replace(/\n---\n$/, '\n');
};
const tree = conceptPage(
  'Directory Tree',
  ['pwd', 'cd'],
  {
    [SECTIONS[0]!]: 'Folders nest inside one another like branches.',
    [SECTIONS[1]!]:
      '| / | the top of everything |\n| --- | --- |\n| /etc | settings |\n| /var/log | logs |',
    [SECTIONS[6]!]: '- cd\n- pwd\n- awk',
    [SECTIONS[9]!]: '> "A tree you can walk."\n> ',
    [SECTIONS[12]!]: '- Who can read /etc?\n- Where do logs rotate?',
  },
  `${cmdLink('pwd')}, ${cmdLink('cd')}`,
);
const globs = conceptPage(
  'Globs',
  [],
  {
    [SECTIONS[0]!]: 'Patterns that expand to file names.',
    [SECTIONS[2]!]:
      '| * | any run of characters |\n| --- | --- |\n| ? | one character |\n| [[:digit:]] | any digit |\n\nExamples\n\n| *.txt | every text file |\n| --- | --- |',
    [SECTIONS[6]!]: '- cp\n- ls',
    [SECTIONS[12]!]: '-',
  },
  '',
);
const conceptRows = [
  ['Name', 'Category', 'Difficulty', 'Tags', 'Related Commands'],
  ['Directory Tree', 'Linux', 'Easy', 'Foundations', `${cmdLink('pwd')}, ${cmdLink('cd')}`],
  ['Globs', 'Linux', 'Easy', 'Foundations', ''],
];
put(`${ROOT}/${DB.concepts} ${dbId.concepts}.csv`, csv(conceptRows));
put(`${ROOT}/${DB.concepts} ${dbId.concepts}_all.csv`, csv(conceptRows));
put(pagePath('concepts', 'Directory Tree'), tree);
put(pagePath('concepts', 'Globs'), globs);
put(
  pagePath('concepts', 'Cyber Concepts Template'),
  [
    '# Cyber Concepts Template',
    '',
    ...SECTIONS.flatMap((s) => [`## ${s}`, '', '(fill me in)', '', '---', '']),
  ].join('\n'),
);

// ---------- labs (empty), projects, log ----------
const labHeader = [['Name', 'Platform', 'Status', 'Difficulty', 'Commands Used', 'Skills Used']];
put(`${ROOT}/${DB.labs} ${dbId.labs}.csv`, csv(labHeader));
put(`${ROOT}/${DB.labs} ${dbId.labs}_all.csv`, csv(labHeader));
put(
  pagePath('labs', 'Labs Template'),
  '# Labs Template\n\n## 🎯 Goal\n\n(What was the challenge?)\n\n## 🔍 Process\n\n(Steps)\n',
);
put(
  `${ROOT}/${DB.projects} ${dbId.projects}.csv`,
  csv([
    ['Name', 'Type', 'Status', 'Skills Used'],
    ['Home Dashboard', 'Script', 'In progress', 'Bash, Globs'],
  ]),
);
put(
  `${ROOT}/${DB.projects} ${dbId.projects}_all.csv`,
  csv([
    ['Name', 'Type', 'Status', 'Skills Used'],
    ['Home Dashboard', 'Script', 'In progress', 'Bash, Globs'],
  ]),
);
put(
  pagePath('projects', 'Home Dashboard'),
  '# Home Dashboard\n\nStatus: In progress\nType: Script\n',
);
const logRow = [
  ['Name', 'Date', 'Topics Covered', 'Time Spent', 'Key Takeaway'],
  [
    'June 3, 2026',
    'June 3, 2026',
    'Folders and paging',
    '~1.5 hours',
    'Everything hangs off one root',
  ],
];
put(`${ROOT}/${DB.log} ${dbId.log}.csv`, csv(logRow));
put(`${ROOT}/${DB.log} ${dbId.log}_all.csv`, csv(logRow));
put(
  pagePath('log', 'June 3, 2026'),
  '# June 3, 2026\n\nDate: June 3, 2026\nKey Takeaway: Everything hangs off one root\nTime Spent: ~1.5 hours\nTopics Covered: Folders and paging\n\n## 📚 What I learned\n\n- less\n- Directory Tree\n- tar\n\n## ⚡ Key insight\n\n- One root\n\n## ❓ Questions\n\n- Why so many bin folders?\n\n## 🔁 Review later\n\n-\n',
);
put(
  pagePath('log', 'Learning Log Template'),
  '# Learning Log Template\n\n## 📚 What I learned\n\n- \n',
);

// ---------- hub page ----------
put(
  `${ROOT} ${id('hub')}.md`,
  [
    `# ${ROOT}`,
    '',
    '> 🛡️ **[ LAB HQ ]** | STATUS: `ACTIVE` | MODE: `LEARNING`',
    '> ',
    '',
    '---',
    '',
    '## ⚡ QUICK NAV',
    '',
    `[💻 Commands](https://www.notion.so/${dbId.commands})  ·  [📚 Concepts](https://www.notion.so/${dbId.concepts})`,
    '',
    ...Object.entries(DB).flatMap(([k, v]) => [
      `## ${v}`,
      '',
      `[${v}](${enc(`${ROOT}/${v} ${dbId[k]!}.csv`)})`,
      '',
    ]),
    '',
  ].join('\n'),
);

// ---------- loose pages under a parent ----------
const P = 'Study Club';
const parentId = id('parent');
const loose = (rel: string, title: string, body: string) =>
  put(`${P}/${rel}${title} ${id(P + rel + title)}.md`, `# ${title}\n\n${body}\n`);
put(`${P} ${parentId}.md`, `# ${P}\n\nLinks to everything below.\n`);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
loose(
  '',
  'Linux Cheat Sheet',
  [
    '## Files',
    '',
    '<aside>\n💡 Tab completes names.\n</aside>',
    '',
    '<details>\n<summary>Hidden tips</summary>\nUse `ls -a` for dotfiles.\n</details>',
    '',
    '![diagram](Linux%20Cheat%20Sheet/diagram.png)',
    '',
    '| Task | Command |',
    '| --- | --- |',
    '| list | `ls \\[flags\\]` |',
  ].join('\n'),
);
put(`${P}/Linux Cheat Sheet/diagram.png`, PNG);
loose(
  '',
  'Network Cheat Sheet',
  '## Ports\n\n| Port | Service |\n| --- | --- |\n| 22 | ssh |\n| 53 | dns |\n\n```bash\nping -c 3 example.test\n```',
);
loose('', 'Windows Cheat Sheet', '## Basics\n\n- `dir` lists files\n- `cd` changes folder');
loose(
  '',
  'SSH Configuration',
  '## Config file\n\n```text\nHost lab\n  HostName 192.0.2.10\n  User student\n```\n\nSave as `~/.ssh/config`.',
);
loose('', 'Local DNS Setup Guide (macOS)', '## Steps\n\n1. Edit `/etc/hosts`\n2. Flush the cache');
loose(
  '',
  'Local DNS Setup Guide (Windows)',
  '## Steps\n\n1. Edit the hosts file as admin\n2. Run `ipconfig /flushdns`',
);
loose('', 'CTF Notes', '## Overview\n\nSee the sub-pages.');
loose('CTF Notes/', 'Web Notes', '## Ideas\n\n- view source\n- check cookies');
loose('CTF Notes/', 'Notes', '## Scratch\n\nduplicate title #1');
loose('', 'Notes', '## Scratch\n\nduplicate title #2');
loose(
  '',
  'Helper Scripts',
  '```bash\n#!/usr/bin/env bash\nfor f in *.log; do\n  gzip "$f"\ndone\n```',
);

export function main() {
  console.log(`wrote synthetic export to ${path.relative(process.cwd(), OUT)}`);
}
main();
