import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/** Everything the API needs from the server lifecycle to manage encryption at rest. */
export interface VaultControls {
  status(): { enabled: boolean; locked: boolean; busy: boolean };
  busy(): boolean;
  unlock(a: { passphrase?: string; recoveryKey?: string; newPassphrase?: string }): Promise<void>;
  lock(): Promise<void>;
  enable(a: { passphrase: string; deleteOldBackups: boolean }): Promise<{ recoveryKey: string }>;
  disable(a: { passphrase: string }): Promise<void>;
  changePassphrase(a: { current: string; next: string }): Promise<void>;
  newRecoveryKey(a: { passphrase: string }): Promise<{ recoveryKey: string }>;
}

const Pass = z.string().min(1).max(1024);

/** Registers the routes that make sense in the current state (locked: status + unlock; open: the rest). */
export function registerVaultRoutes(
  api: FastifyInstance,
  v: VaultControls,
  mode: 'locked' | 'open',
): void {
  api.get('/vault', async () => v.status());
  if (mode === 'locked') {
    api.post('/vault/unlock', async (req, reply) => {
      const b = z
        .object({
          passphrase: Pass.optional(),
          recoveryKey: Pass.optional(),
          newPassphrase: Pass.optional(),
        })
        .refine((x) => !!x.passphrase !== !!x.recoveryKey, 'Give a passphrase or a recovery key')
        .parse(req.body);
      await v.unlock(b);
      return reply.status(200).send({ ok: true });
    });
    return;
  }
  api.post('/vault/enable', async (req) => {
    const b = z
      .object({ passphrase: Pass, deleteOldBackups: z.boolean().default(true) })
      .parse(req.body);
    return v.enable(b);
  });
  api.post('/vault/disable', async (req) => {
    await v.disable(z.object({ passphrase: Pass }).parse(req.body));
    return { ok: true };
  });
  api.post('/vault/change-passphrase', async (req) => {
    await v.changePassphrase(z.object({ current: Pass, next: Pass }).parse(req.body));
    return { ok: true };
  });
  api.post('/vault/recovery-key', async (req) =>
    v.newRecoveryKey(z.object({ passphrase: Pass }).parse(req.body)),
  );
  api.post('/vault/lock', async () => {
    await v.lock();
    return { ok: true };
  });
}
