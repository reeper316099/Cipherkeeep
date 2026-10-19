import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { Dashboard, Heatmap } from '../src/features/dashboard/Dashboard';
import { QuestionsPage } from '../src/features/questions/QuestionsPage';
import { StudyPage } from '../src/features/study/StudyPage';
import { buildHeatGrid, levelFor } from '../src/lib/heatmap';
import { nextIntervalLabel, suggestRating, summarize } from '../src/lib/study';
import { mockApi, renderApp } from './helpers';

const srs = { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0 };

describe('study helpers', () => {
  it('previews the next interval for each rating', () => {
    expect([
      nextIntervalLabel(srs, 'again'),
      nextIntervalLabel(srs, 'good'),
      nextIntervalLabel(srs, 'easy'),
    ]).toEqual(['10m', '1d', '3d']);
    const learned = { ...srs, reps: 2, intervalDays: 15, lastAt: 'x' };
    expect(nextIntervalLabel(learned, 'good')).toBe('1mo');
  });
  it('suggests a rating from a typed answer and summarises a session', () => {
    expect(suggestRating(true)).toBe('good');
    expect(suggestRating(false)).toBe('again');
    const s = summarize(
      [{ rating: 'good' }, { rating: 'again' }, { rating: 'easy' }, { rating: 'hard' }],
      90_000,
    );
    expect(s).toMatchObject({ total: 4, accuracy: 75, ms: 90_000 });
    expect(s.byRating).toEqual({ again: 1, hard: 1, good: 1, easy: 1 });
    expect(summarize([], 0).accuracy).toBe(0);
  });
});

describe('heatmap grid', () => {
  it('lays out Monday-first week columns, flags out-of-range cells, and scales levels to the busiest day', () => {
    const g = buildHeatGrid({ '2026-06-03': 8, '2026-06-04': 1 }, '2026-06-03', '2026-06-10');
    expect(g[0]!.map((c) => c.date)[0]).toBe('2026-06-01');
    expect(g[0]!.filter((c) => c.inRange).map((c) => c.date)).toEqual([
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
      '2026-06-06',
      '2026-06-07',
    ]);
    expect(g[0]![2]).toMatchObject({ date: '2026-06-03', count: 8, level: 4 });
    expect(g[0]![3]).toMatchObject({ count: 1, level: 1 });
    expect(g.every((c) => c.length === 7)).toBe(true);
    expect(levelFor(0, 10)).toBe(0);
    expect(levelFor(5, 0)).toBe(0);
  });
});

const card = {
  entityId: 'c1',
  collection: 'commands',
  type: 'task',
  title: 'ls',
  kind: 'type',
  prompt: 'Type the command: long list of home',
  answer: 'ls -al ~',
  expected: ['ls -al ~'],
};
const stats = { due: 0, newAvailable: 1, reviewedToday: 0, retention30d: null, newPerDay: 10 };

describe('StudyPage', () => {
  it('runs a typed card: tolerant check, keyboard rating, saved answer, then a summary', async () => {
    const fetchMock = mockApi({
      '/study/stats': stats,
      '/study/queue': { items: [{ card, isNew: true, srs }], due: 0, newAvailable: 1, newToday: 0 },
      '/study/answer': { srs: { ...srs, reps: 1, intervalDays: 1 }, mastery: 1 },
    });
    const user = userEvent.setup();
    renderApp(
      <Routes>
        <Route path="/study" element={<StudyPage />} />
      </Routes>,
      '/study',
    );
    await user.click(await screen.findByRole('button', { name: /Start review/ }));
    expect(await screen.findByText('Type the command: long list of home')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Your answer'), 'ls  -la ~');
    await user.keyboard('{Enter}');
    expect(await screen.findByText('✓ Correct')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Good/ })).toHaveClass('suggested');
    await user.keyboard('{Enter}'); // accept the suggested rating
    expect(await screen.findByText('Session complete')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([u]) => String(u).includes('/study/answer'));
    expect(JSON.parse((post![1] as RequestInit).body as string)).toMatchObject({
      id: 'c1',
      collection: 'commands',
      rating: 'good',
      cardType: 'task',
    });
  });

  it('keeps a failed card in the session and offers manual ratings with 1–4', async () => {
    const reveal = {
      ...card,
      type: 'name',
      kind: 'reveal',
      prompt: 'What does `ls` do?',
      answer: 'list entries',
      expected: undefined,
    };
    const fetchMock = mockApi({
      '/study/stats': stats,
      '/study/queue': {
        items: [{ card: reveal, isNew: false, srs }],
        due: 1,
        newAvailable: 0,
        newToday: 0,
      },
      '/study/answer': { srs: { ...srs, lapses: 1 }, mastery: 1 },
    });
    const user = userEvent.setup();
    renderApp(
      <Routes>
        <Route path="/study" element={<StudyPage />} />
      </Routes>,
      '/study',
    );
    await user.click(await screen.findByRole('button', { name: /Start review/ }));
    expect(screen.queryByText('list entries')).toBeNull(); // hidden until revealed
    await user.keyboard(' ');
    expect(await screen.findByText('list entries')).toBeInTheDocument();
    await user.keyboard('1'); // again
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([u]) => String(u).includes('/study/answer')),
      ).toHaveLength(1),
    );
    expect(await screen.findByRole('heading', { name: 'What does ls do?' })).toBeInTheDocument(); // came back for another try
    expect(screen.queryByText('Session complete')).toBeNull();
    expect(screen.queryByText('list entries')).toBeNull(); // hidden again
  });

  it('explains when nothing is due', async () => {
    mockApi({ '/study/stats': { ...stats, newAvailable: 0 } });
    renderApp(
      <Routes>
        <Route path="/study" element={<StudyPage />} />
      </Routes>,
      '/study',
    );
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start review/ })).toBeDisabled();
  });
});

const overview = {
  banner: {
    name: 'HQ',
    status: 'ACTIVE',
    mode: 'LEARNING',
    threat: {
      level: 'MODERATE',
      score: 25,
      daysSinceActivity: 2,
      streak: 0,
      overdue: 0,
      explanation: 'MODERATE (score 25): 2 day(s) since last activity.',
    },
  },
  counts: { commands: 3, concepts: 1, labs: 1, projects: 1, log: 0, notes: 0, snippets: 0 },
  kpis: {
    commandsMastered: 1,
    commandsTotal: 3,
    conceptsStudied: 1,
    conceptsConfident: 0,
    labsCompleted: 1,
    labsTotal: 1,
    activeProjects: 1,
  },
  mastery: [1, 1, 0, 1],
  labs: {
    byPlatform: { Bandit: { total: 1, completed: 1 } },
    byStatus: { Completed: 1 },
    byDifficulty: { Easy: 1 },
  },
  timePerWeek: [{ week: '2026-06-01', minutes: 90 }],
  streak: { current: 3, longest: 5 },
  heatmap: { from: '2026-05-01', to: '2026-06-03', days: { '2026-06-03': 4, '2026-06-02': 1 } },
  study: {
    due: 7,
    overdue: 0,
    newAvailable: 2,
    newToday: 0,
    reviewedToday: 3,
    reviews30d: 3,
    retention30d: 100,
    newPerDay: 10,
  },
  skillMap: [
    {
      name: 'Linux',
      weight: 1,
      score: 42,
      trend: 5,
      parts: { concepts: 10, commands: 10, labs: 10, recency: 5 },
      counts: { concepts: 1, commands: 1, labs: 1 },
    },
    {
      name: 'Networking',
      weight: 1,
      score: 8,
      trend: -3,
      parts: { concepts: 3, commands: 3, labs: 0, recency: 2 },
      counts: { concepts: 1, commands: 0, labs: 0 },
    },
  ],
  skillTrend: [],
  recommendations: [
    {
      id: 'review',
      kind: 'review',
      title: 'Review 7 due cards',
      why: 'Spaced repetition brings cards back just before you would forget them.',
      route: '/study',
      priority: 100,
    },
  ],
  recent: [
    {
      ts: '2026-06-03T10:00:00.000Z',
      type: 'study',
      collection: 'commands',
      id: 'c1',
      title: 'ls',
    },
  ],
};

describe('Dashboard', () => {
  it('shows the live banner with an explained threat level, KPIs, due count and reasoned recommendations', async () => {
    mockApi({
      '/stats/overview': overview,
      '/settings': { theme: 'dark', accent: '#38e8c6', density: 'comfortable' },
    });
    renderApp(<Dashboard />);
    const banner = await screen.findByLabelText('Status banner');
    expect(banner).toHaveTextContent('STATUS: ACTIVE');
    expect(banner).toHaveTextContent('THREAT LEVEL: MODERATE');
    expect(screen.getByLabelText(/Threat level MODERATE/)).toHaveAttribute(
      'title',
      expect.stringContaining('score 25'),
    );
    expect(screen.getByRole('link', { name: 'Start review' })).toHaveAttribute('href', '/study');
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText(/3-day streak/)).toBeInTheDocument();
    expect(screen.getByText('Commands mastered')).toBeInTheDocument();
    expect(screen.getByText('Review 7 due cards')).toBeInTheDocument();
    expect(screen.getByText(/just before you would forget/)).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Linux score' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    );
    expect(screen.getByText('▲5')).toBeInTheDocument();
    expect(screen.getByText('▼3')).toBeInTheDocument();
  });

  it('renders a heatmap with an accessible summary and per-day titles', () => {
    const { container } = renderApp(<Heatmap heat={overview.heatmap} />);
    expect(screen.getByRole('img', { name: /5 actions on 2 days/ })).toBeInTheDocument();
    expect(container.querySelector('[title="Jun 3: 4 actions"]')).not.toBeNull();
    expect(container.querySelector('.heat-cell.l4')).not.toBeNull();
  });
});

describe('QuestionsPage', () => {
  it('lists open questions by concept and marks one answered', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/questions'))
        return new Response(
          JSON.stringify([
            {
              conceptId: 'k1',
              concept: 'Directory Tree',
              text: 'Who can read /etc?',
              line: 0,
              done: false,
            },
          ]),
        );
      if (u.includes('/concepts/k1') && init?.method === 'PATCH')
        return new Response(JSON.stringify({ id: 'k1' }));
      if (u.includes('/concepts/k1'))
        return new Response(
          JSON.stringify({
            id: 'k1',
            sections: [{ key: 'questions-i-still-have', markdown: '- Who can read /etc?' }],
          }),
        );
      return new Response(JSON.stringify({ items: [], total: 0 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderApp(<QuestionsPage />);
    expect(await screen.findByRole('link', { name: 'Directory Tree' })).toHaveAttribute(
      'href',
      '/concepts/k1',
    );
    await user.click(screen.getByRole('checkbox', { name: 'Who can read /etc?' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, i]) => (i as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeTruthy();
      const body = JSON.parse((patch![1] as RequestInit).body as string);
      expect(body.sections[0].markdown).toBe('- [x] Who can read /etc?');
      expect(body.questionsOpen).toBe(0);
    });
  });
});
