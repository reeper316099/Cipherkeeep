import { describe, expect, it } from 'vitest';
import { fillPlaceholders, detectPlaceholders } from '@cipherkeep/shared';
import { filterCommands, primaryExample } from '../src/lib/commandFilters';
import {
  draftFrom,
  draftToPayload,
  textToArgs,
  textToExamples,
  textToOptions,
} from '../src/lib/commandForm';
import { hexToRgb, luminance, onAccent, resolveTheme, applyTheme } from '../src/lib/theme';
import { isSensitiveName, useUI } from '../src/lib/store';
import { makeCommand } from './helpers';

describe('placeholder fill-in', () => {
  it('replaces only filled tokens, in all three bracket styles', () => {
    expect(
      fillPlaceholders('nmap -p {port} <target> [flags]', { target: '10.0.0.5', port: '22' }),
    ).toBe('nmap -p 22 10.0.0.5 [flags]');
    expect(fillPlaceholders('ls [[:upper:]]*', { upper: 'x' })).toBe('ls [[:upper:]]*');
    expect(fillPlaceholders('echo <a> <a>', { a: 'x' })).toBe('echo x x');
    expect(fillPlaceholders('echo <a>', { a: '' })).toBe('echo <a>');
  });
  it('detects the same names the server stored', () => {
    expect(detectPlaceholders(makeCommand().syntax)).toEqual(['flags', 'target']);
  });
});

describe('filterCommands', () => {
  const a = makeCommand({
    id: 'a',
    name: 'ls',
    category: 'File System',
    risk: 'safe',
    mastery: 0,
    platforms: ['linux'],
  });
  const b = makeCommand({
    id: 'b',
    name: 'rm',
    category: 'File System',
    risk: 'destructive',
    mastery: 3,
    favorite: true,
    platforms: ['any'],
  });
  const c = makeCommand({ id: 'c', name: 'old', archived: true });
  const none = { category: '', platform: '', risk: '', mastery: '', favorite: false };
  it('hides archived and combines filters', () => {
    expect(filterCommands([a, b, c], none).map((x) => x.id)).toEqual(['a', 'b']);
    expect(filterCommands([a, b], { ...none, risk: 'destructive' }).map((x) => x.id)).toEqual([
      'b',
    ]);
    expect(filterCommands([a, b], { ...none, mastery: '0' }).map((x) => x.id)).toEqual(['a']);
    expect(filterCommands([a, b], { ...none, favorite: true }).map((x) => x.id)).toEqual(['b']);
    expect(filterCommands([a, b], { ...none, platform: 'macos' }).map((x) => x.id)).toEqual(['b']); // 'any' matches everywhere
  });
  it('orders by search rank and drops non-hits', () => {
    expect(filterCommands([a, b], none, new Map([['b', 0]])).map((x) => x.id)).toEqual(['b']);
    expect(
      filterCommands(
        [a, b],
        none,
        new Map([
          ['b', 0],
          ['a', 1],
        ]),
      ).map((x) => x.id),
    ).toEqual(['b', 'a']);
  });
  it('picks the first example as primary, falling back to syntax', () => {
    expect(primaryExample(makeCommand())).toBe('nmap -sV <target>');
    expect(primaryExample(makeCommand({ examples: [] }))).toBe('nmap [flags] <target>');
  });
});

describe('command editor form', () => {
  it('round-trips examples, options and arguments', () => {
    const c = makeCommand({ arguments: [{ name: 'target', meaning: 'host' }] });
    const d = draftFrom(c);
    expect(d.examples).toBe(
      'nmap -sV <target> = "detect versions"\nnmap -p {port} <target> = "one port"',
    );
    const p = draftToPayload(d);
    expect(p.examples).toEqual(c.examples);
    expect(p.options).toEqual(c.options);
    expect(p.arguments).toEqual(c.arguments);
    expect(p.placeholders).toEqual(['flags', 'target', 'port']);
  });
  it('parses loose text and derives risk when left at default', () => {
    expect(textToExamples('a = "b"\n\nc')).toEqual([
      { command: 'a', description: 'b' },
      { command: 'c', description: '' },
    ]);
    expect(textToOptions('-a | all\n-b')).toEqual([
      { flag: '-a', meaning: 'all' },
      { flag: '-b', meaning: '' },
    ]);
    expect(textToArgs('x -> y\nz')).toEqual([
      { name: 'x', meaning: 'y' },
      { name: 'z', meaning: '' },
    ]);
    const d = { ...draftFrom(makeCommand()), name: 'rm', risk: 'safe' as const };
    expect(draftToPayload(d).risk).toBe('destructive');
    expect(draftToPayload({ ...d, risk: 'caution' }).risk).toBe('caution');
  });
});

describe('theme', () => {
  it('picks readable text on any accent (WCAG luminance)', () => {
    expect(onAccent('#fbbf24')).toBe('#04110e');
    expect(onAccent('#1d4ed8')).toBe('#ffffff');
    expect(luminance(hexToRgb('#ffffff')!)).toBeCloseTo(1, 2);
    expect(hexToRgb('nope')).toBeNull();
  });
  it('resolves system theme and applies accent variables', () => {
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    const root = document.createElement('div');
    applyTheme(
      { theme: 'light', accent: '#8b5cf6', density: 'compact', blurSensitive: true },
      root,
    );
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.density).toBe('compact');
    expect(root.style.getPropertyValue('--accent-rgb')).toBe('139 92 246');
    expect(root.classList.contains('blur-sensitive')).toBe(true);
  });
});

describe('placeholder store', () => {
  it('never persists sensitive values to sessionStorage', () => {
    useUI.getState().clearValues();
    useUI.getState().setValue('target', '10.0.0.5');
    useUI.getState().setValue('password', 'hunter2');
    const stored = sessionStorage.getItem('ck.placeholders') ?? '';
    expect(stored).toContain('10.0.0.5');
    expect(stored).not.toContain('hunter2');
    expect(isSensitiveName('api_token')).toBe(true);
    useUI.getState().setSensitive('target', true);
    expect(sessionStorage.getItem('ck.placeholders') ?? '').not.toContain('10.0.0.5');
    useUI.getState().clearValues();
  });
});
