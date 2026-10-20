import { randomBytes, scrypt, type ScryptOptions } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { EncryptionError, atomicWriteJson, openRaw, sealRaw } from '@cipherkeep/jsonstore';
import { AppError } from './util.ts';

/**
 * Key management for optional encryption at rest.
 *
 * A random 256-bit master key encrypts the data. It is stored wrapped (AES-256-GCM) under two independent
 * key-encryption keys: one derived from the passphrase and one from a generated recovery key, both with scrypt.
 * Changing the passphrase re-wraps the master key, so no data is rewritten. `vault.json` holds only salts,
 * KDF cost and the two wrapped keys; it contains nothing that identifies your content.
 */
export const VAULT_FILE = 'vault.json';
export const MIN_PASSPHRASE = 10;

const Kdf = z.object({
  algo: z.literal('scrypt'),
  N: z
    .number()
    .int()
    .min(1024)
    .max(2 ** 20),
  r: z.number().int().min(1).max(16),
  p: z.number().int().min(1).max(4),
});
export type KdfParams = z.infer<typeof Kdf>;
const Wrap = z.object({ salt: z.string(), wrap: z.string() });
const VaultSchema = z.object({
  version: z.literal(1),
  kdf: Kdf,
  passphrase: Wrap,
  recovery: Wrap,
  createdAt: z.string(),
});
type VaultData = z.infer<typeof VaultSchema>;

export const DEFAULT_KDF: KdfParams = { algo: 'scrypt', N: 2 ** 15, r: 8, p: 1 };

function derive(secret: string, salt: Buffer, kdf: KdfParams): Promise<Buffer> {
  const opts: ScryptOptions = { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 };
  return new Promise((resolve, reject) =>
    scrypt(secret.normalize('NFKC'), salt, 32, opts, (e, k) => (e ? reject(e) : resolve(k))),
  );
}

// Crockford base32: no I, L, O, U, so a hand-copied key is hard to misread.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateRecoveryKey(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join('-');
}

/** Tolerant of case, spaces, dashes and the usual look-alike letters. */
export function normalizeRecoveryKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

const bad = () => new AppError(401, 'BAD_CREDENTIALS', 'Wrong passphrase or recovery key');

export interface Unlocked {
  key: Buffer;
}

export class Vault {
  constructor(
    private readonly dataDir: string,
    private readonly kdf: KdfParams = DEFAULT_KDF,
  ) {}

  get file(): string {
    return path.join(this.dataDir, VAULT_FILE);
  }

  async isEnabled(): Promise<boolean> {
    try {
      await fs.access(this.file);
      return true;
    } catch {
      return false;
    }
  }

  private async read(): Promise<VaultData> {
    try {
      return VaultSchema.parse(JSON.parse(await fs.readFile(this.file, 'utf8')));
    } catch (e) {
      throw new AppError(500, 'VAULT_DAMAGED', `vault.json is unreadable: ${(e as Error).message}`);
    }
  }

  private async wrap(key: Buffer, secret: string, params: KdfParams) {
    const salt = randomBytes(16);
    const kek = await derive(secret, salt, params);
    return { salt: salt.toString('base64'), wrap: sealRaw(kek, key).toString('base64') };
  }

  private async unwrap(w: { salt: string; wrap: string }, secret: string, params: KdfParams) {
    const kek = await derive(secret, Buffer.from(w.salt, 'base64'), params);
    try {
      return openRaw(kek, Buffer.from(w.wrap, 'base64'));
    } catch (e) {
      if (e instanceof EncryptionError) throw bad();
      throw e;
    }
  }

  static checkPassphrase(passphrase: string): void {
    if (passphrase.normalize('NFKC').length < MIN_PASSPHRASE)
      throw new AppError(400, 'WEAK_PASSPHRASE', `Use at least ${MIN_PASSPHRASE} characters`);
  }

  /** Create a vault with a fresh master key. Returns the key and the one-time recovery key. */
  async create(passphrase: string): Promise<{ key: Buffer; recoveryKey: string }> {
    Vault.checkPassphrase(passphrase);
    if (await this.isEnabled()) throw new AppError(409, 'ALREADY_ENABLED', 'Already enabled');
    const key = randomBytes(32);
    const recoveryKey = generateRecoveryKey();
    const data: VaultData = {
      version: 1,
      kdf: this.kdf,
      passphrase: await this.wrap(key, passphrase, this.kdf),
      recovery: await this.wrap(key, normalizeRecoveryKey(recoveryKey), this.kdf),
      createdAt: new Date().toISOString(),
    };
    await atomicWriteJson(this.file, data);
    return { key, recoveryKey };
  }

  async unlockWithPassphrase(passphrase: string): Promise<Buffer> {
    const v = await this.read();
    return this.unwrap(v.passphrase, passphrase, v.kdf);
  }

  async unlockWithRecoveryKey(recoveryKey: string): Promise<Buffer> {
    const v = await this.read();
    return this.unwrap(v.recovery, normalizeRecoveryKey(recoveryKey), v.kdf);
  }

  /** Re-wrap the master key under a new passphrase (the data is untouched). */
  async setPassphrase(key: Buffer, passphrase: string): Promise<void> {
    Vault.checkPassphrase(passphrase);
    const v = await this.read();
    await atomicWriteJson(this.file, { ...v, passphrase: await this.wrap(key, passphrase, v.kdf) });
  }

  /** Replace the recovery key; the old one stops working. */
  async newRecoveryKey(key: Buffer): Promise<string> {
    const v = await this.read();
    const recoveryKey = generateRecoveryKey();
    await atomicWriteJson(this.file, {
      ...v,
      recovery: await this.wrap(key, normalizeRecoveryKey(recoveryKey), v.kdf),
    });
    return recoveryKey;
  }

  async remove(): Promise<void> {
    await fs.rm(this.file, { force: true });
  }
}

/** Slows down guessing: 5 free tries, then 1 s doubling to 30 s. */
export class AttemptLimiter {
  private failures = 0;
  private until = 0;
  check(): void {
    const wait = this.until - Date.now();
    if (wait > 0)
      throw new AppError(429, 'TOO_MANY_ATTEMPTS', `Try again in ${Math.ceil(wait / 1000)} s`);
  }
  fail(): void {
    this.failures++;
    if (this.failures > 5)
      this.until = Date.now() + Math.min(30_000, 1000 * 2 ** (this.failures - 6));
  }
  ok(): void {
    this.failures = 0;
    this.until = 0;
  }
}
