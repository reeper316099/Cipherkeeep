import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Palette } from '../src/components/Palette';
import { CommandDetail } from '../src/features/commands/CommandDetail';
import { useUI } from '../src/lib/store';
import { makeCommand, mockApi, renderApp } from './helpers';

beforeEach(() => {
  useUI.getState().clearValues();
  useUI.setState({ toasts: [] });
});

describe('CommandDetail', () => {
  it('shows syntax, flags and examples with a risk badge', () => {
    mockApi({});
    renderApp(<CommandDetail cmd={makeCommand()} />);
    expect(screen.getByRole('heading', { name: 'nmap' })).toBeInTheDocument();
    expect(screen.getByText('caution')).toHaveClass('risk-caution');
    expect(screen.getByText('-sV')).toBeInTheDocument();
    expect(screen.getByText('detect versions')).toBeInTheDocument();
  });

  it('fills a placeholder once and updates every example and copy action', async () => {
    mockApi({});
    const user = userEvent.setup();
    renderApp(<CommandDetail cmd={makeCommand()} />);
    const bar = screen.getByLabelText('Fill in placeholders');
    await user.type(within(bar).getByPlaceholderText('<target>'), '10.0.0.5');
    expect(screen.getAllByText('10.0.0.5').length).toBeGreaterThanOrEqual(3); // syntax + both examples
    await user.click(screen.getByRole('button', { name: 'Copy example: nmap -sV <target>' }));
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe('nmap -sV 10.0.0.5'),
    );
    await user.click(screen.getByRole('button', { name: /^Copy example\s*C$/ }));
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe('nmap -sV 10.0.0.5'),
    );
  });

  it('masks and never stores sensitive placeholders', async () => {
    mockApi({});
    const user = userEvent.setup();
    renderApp(
      <CommandDetail
        cmd={makeCommand({
          syntax: 'login <password>',
          examples: [{ command: 'login <password>', description: '' }],
          placeholders: ['password'],
        })}
      />,
    );
    const input = screen.getByPlaceholderText('<password>');
    expect(input).toHaveAttribute('type', 'password');
    await user.type(input, 'hunter2');
    expect(sessionStorage.getItem('ck.placeholders') ?? '').not.toContain('hunter2');
  });

  it('changes mastery through the API', async () => {
    const fetchMock = mockApi({});
    const user = userEvent.setup();
    renderApp(<CommandDetail cmd={makeCommand()} />);
    await user.click(screen.getByRole('button', { name: /3 · Mastered/ }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ mastery: 3 });
    });
  });
});

describe('Palette', () => {
  const nmap = makeCommand();
  const routes = {
    '/search': {
      hits: [
        {
          type: 'commands',
          id: nmap.id,
          title: 'nmap',
          category: 'Networking',
          score: 9,
          highlight: '',
        },
      ],
      facets: { commands: 1 },
    },
    '/commands': { items: [nmap], total: 1, limit: 500, offset: 0 },
    '/settings': {
      theme: 'dark',
      accent: '#38e8c6',
      density: 'comfortable',
      storeFlagsInLabs: false,
      blurSensitive: false,
      vimMode: false,
      backupKeep: 20,
      backupIntervalHours: 6,
    },
  };

  it('Enter copies the primary example with remembered placeholder values', async () => {
    mockApi(routes);
    useUI.getState().setValue('target', '192.0.2.7');
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderApp(<Palette onClose={onClose} />);
    await user.type(screen.getByRole('combobox'), 'nmap');
    await screen.findByRole('option', { name: /nmap/ });
    await user.keyboard('{Enter}');
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe('nmap -sV 192.0.2.7'),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('is keyboard navigable and closes on Escape', async () => {
    mockApi(routes);
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderApp(<Palette onClose={onClose} />);
    const box = screen.getByRole('combobox');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await user.type(box, '{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
