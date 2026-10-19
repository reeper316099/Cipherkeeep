import { describe, expect, it } from 'vitest';
import {
  classifyRisk,
  detectPlaceholders,
  extractWikiLinks,
  headingKey,
  mapDifficulty,
  normalizeBody,
  parseCommandPage,
  parseConceptPage,
  parseLogEntry,
  parseNotionDate,
  parseNotionPage,
  parseRelationCell,
  parseTables,
  parseTimeSpent,
  repairTables,
  splitExampleLine,
  splitNotionName,
  splitSections,
  unescapeAll,
} from '../src/index.ts';

describe('names', () => {
  it('splits ids, extensions and the _all duplicate', () => {
    expect(splitNotionName('ls 32df3e3018aa80d89e90dddec81b898b.md')).toMatchObject({
      title: 'ls',
      id: '32df3e3018aa80d89e90dddec81b898b',
      ext: '.md',
      all: false,
    });
    expect(
      splitNotionName('📚 Cyber Concepts 32cf3e3018aa8051999ed048cba85e91_all.csv'),
    ).toMatchObject({
      title: '📚 Cyber Concepts',
      ext: '.csv',
      all: true,
    });
    expect(splitNotionName('No id here.md')).toMatchObject({ title: 'No id here', id: undefined });
  });
  it('builds emoji-free heading keys', () => {
    expect(headingKey('🧠 Intuition (VERY IMPORTANT)')).toBe('intuition-very-important');
    expect(headingKey('🔧 Common Options (Flags)')).toBe('common-options-flags');
  });
});

describe('time and dates', () => {
  it.each([
    ['~1.5 hours', 90],
    ['1 hr', 60],
    ['45 mins', 45],
    ['2h 30m', 150],
    ['1:30', 90],
    ['half an hour', 30],
    ['an hour and 15 minutes', 75],
    ['about 2 hrs', 120],
  ])('parses %s', (raw, mins) => expect(parseTimeSpent(raw)).toBe(mins));
  it('returns null for unknown text', () => {
    expect(parseTimeSpent('a while')).toBeNull();
    expect(parseTimeSpent('')).toBeNull();
  });
  it.each([
    ['March 24, 2026', '2026-03-24'],
    ['2026-03-24', '2026-03-24'],
    ['24 Mar 2026', '2026-03-24'],
    ['03/24/2026', '2026-03-24'],
    ['@March 24, 2026 → March 25, 2026', '2026-03-24'],
  ])('parses date %s', (raw, iso) => expect(parseNotionDate(raw)).toBe(iso));
  it('rejects impossible dates', () => expect(parseNotionDate('February 31, 2026')).toBeNull());
});

describe('relations', () => {
  it('parses title + path pairs, including titles with commas', () => {
    const r = parseRelationCell(
      'pwd (Dash/%F0%9F%92%BB%20Commands/pwd%2032df3e3018aa804783b1f8a9de1e33c1.md), a, b (x/b%2032df3e3018aa803c957dd5c1468647de.md)',
    );
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ title: 'pwd', id: '32df3e3018aa804783b1f8a9de1e33c1' });
    expect(r[1]).toMatchObject({ title: 'a, b', id: '32df3e3018aa803c957dd5c1468647de' });
  });
  it('falls back to plain titles', () => {
    expect(parseRelationCell('ls, cd').map((x) => x.title)).toEqual(['ls', 'cd']);
    expect(parseRelationCell('')).toEqual([]);
  });
});

describe('markdown helpers', () => {
  it('splits properties from the body only when expected', () => {
    const text =
      '# ls\n\nCategory: File System\nSyntax: ls \\[flags\\]\n\n## 📌 What it does\n\nlists\n';
    const p = parseNotionPage(text, true);
    expect(p.title).toBe('ls');
    expect(p.props).toEqual({ Category: 'File System', Syntax: 'ls \\[flags\\]' });
    expect(p.body.startsWith('## 📌 What it does')).toBe(true);
    const loose = parseNotionPage('# Page\n\nNote: not a property\n\ntext', false);
    expect(loose.props).toEqual({});
    expect(loose.body).toContain('Note: not a property');
  });
  it('unescapes brackets but never inside code', () => {
    expect(normalizeBody('use \\[flags\\] here\n\n```\necho \\[x\\]\n```')).toBe(
      'use [flags] here\n\n```\necho \\[x\\]\n```',
    );
    expect(unescapeAll('ls \\[flags\\] \\*')).toBe('ls [flags] *');
  });
  it('converts callouts and toggles without losing content', () => {
    const md = normalizeBody(
      '<aside>\n💡 Remember this\n</aside>\n\n<details><summary>More</summary>\nhidden text\n</details>',
    );
    expect(md).toContain('> [!TIP]');
    expect(md).toContain('> Remember this');
    expect(md).toContain('> **▸ More**');
    expect(md).toContain('> hidden text');
  });
  it('repairs table rows broken by a newline in a cell, but not inside code', () => {
    expect(repairTables('| a | b\nc |\n| d | e |')).toBe('| a | b c |\n| d | e |');
    expect(repairTables('```\n| not\ntable\n```')).toBe('```\n| not\ntable\n```');
  });
  it('splits sections and parses tables', () => {
    const { sections, preamble } = splitSections(
      'intro\n\n## A\n\none\n\n---\n\n## 🧠 B\n\n```\n## not heading\n```',
    );
    expect(preamble).toBe('intro');
    expect(sections.map((s) => s.key)).toEqual(['a', 'b']);
    expect(sections[0]!.markdown).toBe('one');
    expect(parseTables('| a | b |\n| --- | --- |\n| `x\\|y` | z |')[0]!.rows).toEqual([
      ['a', 'b'],
      ['`x|y`', 'z'],
    ]);
  });
});

describe('command parsing', () => {
  it('splits cmd = "desc" on the first = "', () => {
    expect(splitExampleLine('ls -al ~ = "lists all"')).toEqual({
      command: 'ls -al ~',
      description: 'lists all',
    });
    expect(splitExampleLine('echo a = "b" = "c"')).toEqual({
      command: 'echo a',
      description: 'b" = "c',
    });
    expect(splitExampleLine('plain command')).toEqual({
      command: 'plain command',
      description: '',
    });
    expect(splitExampleLine('')).toBeNull();
  });
  it('detects placeholders but not glob classes', () => {
    expect(detectPlaceholders('ls [flags] <target> {ip} [[:upper:]]* [!abc]')).toEqual([
      'flags',
      'target',
      'ip',
    ]);
  });
  it('classifies risk', () => {
    expect(classifyRisk('rm', [])).toBe('destructive');
    expect(classifyRisk('mv', [])).toBe('caution');
    expect(classifyRisk('ls', [])).toBe('safe');
    expect(classifyRisk('find', ['find . -exec rm -rf {} +'])).toBe('destructive');
  });
  it('maps a full page into structured fields', () => {
    const body = [
      '## 📌 What it does',
      '',
      'Shows things',
      '',
      '---',
      '',
      '## 🧩 Arguments',
      '',
      '(Inputs the command takes.)',
      '',
      '- target → thing to show',
      '',
      '---',
      '',
      '## 🔧 Common Options (Flags)',
      '',
      '| Option | Meaning |',
      '| --- | --- |',
      '| -a | all |',
      '| -l | long |',
      '',
      '---',
      '',
      '## 💡 Examples',
      '',
      '```bash',
      'show -a x = "all of x"',
      '```',
      '',
      '| `show -l y` | Long y |',
      '| --- | --- |',
      '| `show -a z` | All z |',
      '',
      '## 🧪 Extra',
      '',
      'kept',
    ].join('\n');
    const r = parseCommandPage({
      name: 'show',
      category: 'General',
      body,
      props: { Syntax: 'show \\[flags\\] \\[target\\]', Example: 'show -a', Explanation: 'shows' },
    });
    const i = r.input as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(i.syntax).toBe('show [flags] [target]');
    expect(i.arguments).toEqual([{ name: 'target', meaning: 'thing to show' }]);
    expect(i.options).toEqual([
      { flag: '-a', meaning: 'all' },
      { flag: '-l', meaning: 'long' },
    ]);
    expect(i.examples.map((e: { command: string }) => e.command)).toEqual([
      'show -a',
      'show -a x',
      'show -l y',
      'show -a z',
    ]);
    expect(i.placeholders).toEqual(['flags', 'target']);
    expect(i.notes).toContain('## 🧪 Extra');
    expect(i.extras.droppedTemplateHints).toEqual(['(Inputs the command takes.)']);
    expect(r.warnings.join()).toContain('unrecognised');
  });
});

describe('concept and log parsing', () => {
  it('keeps every section, counts real open questions, maps difficulty', () => {
    const body =
      '## 🧠 What is it?\n\ntext\n\n---\n\n## 🛠️ Tools / Commands Related\n\n- cp\n- find\n\n---\n\n## ❓ Questions I still have\n\n- one?\n- \n- two?\n\n## 🎁 Custom\n\nmine';
    const r = parseConceptPage({ name: 'X', difficulty: 'Beginner', body });
    expect((r.input.sections as unknown[]).length).toBe(4);
    expect(r.input.questionsOpen).toBe(2);
    expect(r.input.difficulty).toBe('Easy');
    expect(r.commandMentions).toEqual(['cp', 'find']);
    expect(mapDifficulty('Advanced')).toBe('Hard');
  });
  it('parses log dates and time', () => {
    const r = parseLogEntry({
      name: 'March 24, 2026',
      date: 'March 24, 2026',
      timeSpent: '~1.5 hours',
      topics: 'A, B',
      body: '## 📚 What I learned\n\n- less\n- df',
    });
    expect(r.input).toMatchObject({
      date: '2026-03-24',
      timeSpentMin: 90,
      timeSpentRaw: '~1.5 hours',
      topics: ['A', 'B'],
    });
    expect(r.learned).toEqual(['less', 'df']);
  });
});

describe('wiki links', () => {
  it('extracts links but ignores code and glob classes', () => {
    const md =
      'See [[Wildcards]] and [[cmd:ls]] and [[Note|alias]] `[[code]]` [[:alpha:]] [[:upper:]]*\n```\n[[fenced]]\n```';
    expect(extractWikiLinks(md).map((l) => [l.kind, l.target, l.alias])).toEqual([
      [undefined, 'Wildcards', undefined],
      ['cmd', 'ls', undefined],
      [undefined, 'Note', 'alias'],
    ]);
  });
});
