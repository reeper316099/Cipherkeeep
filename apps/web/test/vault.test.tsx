import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecurityCard } from '../src/features/vault/SecurityCard';
import { VaultGate } from '../src/features/vault/VaultGate';
import { renderApp } from './helpers';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('VaultGate', () => {
  it('shows the unlock screen while locked, rejects a wrong passphrase, then opens the app', async () => {
    let locked = true;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/vault/unlock')) {
        const { passphrase } = JSON.parse(String(init?.body)) as { passphrase: string };
        if (passphrase !== 'correct horse battery')
          return json({ error: { code: 'BAD_CREDENTIALS', message: 'Wrong' } }, 401);
        locked = false;
        return json({ ok: true });
      }
      return json({ enabled: true, locked, busy: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderApp(
      <VaultGate>
        <p>the app</p>
      </VaultGate>,
    );
    expect(await screen.findByRole('heading', { name: /is locked/i })).toBeInTheDocument();
    expect(screen.queryByText('the app')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('PASSPHRASE'), 'not it');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not right');
    expect(screen.getByLabelText('PASSPHRASE')).toHaveValue(''); // never kept after a try

    await user.type(screen.getByLabelText('PASSPHRASE'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('the app')).toBeInTheDocument();
  });

  it('asks for a new passphrase when unlocking with a recovery key', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/vault/unlock')) {
          bodies.push(JSON.parse(String(init?.body)));
          return json({ ok: true });
        }
        return json({ enabled: true, locked: true, busy: false });
      }),
    );
    const user = userEvent.setup();
    renderApp(
      <VaultGate>
        <p>the app</p>
      </VaultGate>,
    );
    await user.click(await screen.findByRole('button', { name: /recovery key instead/i }));
    const submit = screen.getByRole('button', { name: /set new passphrase/i });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('RECOVERY KEY'), 'abcd-efgh');
    await user.type(screen.getByLabelText(/NEW PASSPHRASE/), 'a brand new one');
    await user.click(submit);
    await screen.findByText('the app');
    expect(bodies).toEqual([{ recoveryKey: 'abcd-efgh', newPassphrase: 'a brand new one' }]);
  });
});

describe('SecurityCard', () => {
  it('warns about unrecoverable data, enables encryption, and shows the recovery key once', async () => {
    let enabled = false;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/vault/enable')) {
        enabled = true;
        expect(JSON.parse(String(init?.body))).toEqual({
          passphrase: 'correct horse battery',
          deleteOldBackups: true,
        });
        return json({ recoveryKey: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789' });
      }
      return json({ enabled, locked: false, busy: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderApp(<SecurityCard />);
    await user.click(await screen.findByRole('button', { name: /encrypt my library/i }));
    expect(screen.getByText(/cannot be recovered/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^PASSPHRASE/), 'correct horse battery');
    await user.type(screen.getByLabelText('REPEAT PASSPHRASE'), 'something else entirely');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('differ');

    await user.clear(screen.getByLabelText('REPEAT PASSPHRASE'));
    await user.type(screen.getByLabelText('REPEAT PASSPHRASE'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789')).toBeInTheDocument();
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeDisabled(); // must confirm it was stored
    await user.click(screen.getByLabelText(/stored my recovery key/i));
    await user.click(done);
    await waitFor(() => expect(screen.queryByText(/ABCD-EFGH/)).not.toBeInTheDocument());
    expect(await screen.findByText(/Encryption is on/)).toBeInTheDocument();
  });
});
