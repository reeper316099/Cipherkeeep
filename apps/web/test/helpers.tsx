import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { Command } from '@cipherkeep/shared';

export function makeCommand(over: Partial<Command> = {}): Command {
  return {
    id: '01HZZZZZZZZZZZZZZZZZZZZZZ1',
    title: 'nmap',
    slug: 'nmap',
    category: 'Networking',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    favorite: false,
    archived: false,
    links: [],
    extras: {},
    name: 'nmap',
    platforms: ['any'],
    whatItDoes: 'Scans hosts',
    syntax: 'nmap [flags] <target>',
    explanation: 'port scanner',
    arguments: [],
    options: [{ flag: '-sV', meaning: 'version detection' }],
    examples: [
      { command: 'nmap -sV <target>', description: 'detect versions' },
      { command: 'nmap -p {port} <target>', description: 'one port' },
    ],
    placeholders: ['flags', 'target', 'port'],
    risk: 'caution',
    notes: '',
    mastery: 1,
    practiceCount: 2,
    srs: { ease: 2.5, intervalDays: 0 },
    ...over,
  } as Command;
}

/** Fetch stub keyed by path substring → JSON body. */
export function mockApi(routes: Record<string, unknown>) {
  const fn = vi.fn(async (url: string, _init?: RequestInit) => {
    const hit = Object.entries(routes).find(([k]) => String(url).includes(k));
    const body = hit ? hit[1] : { items: [], total: 0, limit: 500, offset: 0 };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function renderApp(ui: ReactElement, route = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
