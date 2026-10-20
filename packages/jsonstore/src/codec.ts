import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { atomicWriteFile, stableStringify } from './atomic.ts';
import { JsonStoreError } from './errors.ts';

/**
 * At-rest encoding for everything the store writes. The default codec is the identity; an
 * AES-256-GCM codec encrypts each file on its own (fresh random IV per write).
 *
 * File format: 8-byte magic `CKENC1B\0`, 12-byte IV, 16-byte GCM tag, ciphertext.
 * Line format (for append-only logs): `CKENC1:` + base64(IV | tag | ciphertext).
 */
export const BYTES_MAGIC = Buffer.from('CKENC1B\0', 'latin1');
export const LINE_PREFIX = 'CKENC1:';
const IV_LEN = 12;
const TAG_LEN = 16;

export interface Codec {
  readonly encrypting: boolean;
  /** Plain bytes → bytes to put on disk. */
  encode(data: Uint8Array): Buffer;
  /** Bytes read from disk → plain bytes. Plain (unencrypted) input passes through when a key is held. */
  decode(raw: Uint8Array): Buffer;
  encodeText(text: string): Buffer;
  decodeText(raw: Uint8Array): string;
  encodeLine(text: string): string;
  decodeLine(line: string): string;
}

export function isEncrypted(raw: Uint8Array): boolean {
  return raw.length >= BYTES_MAGIC.length && Buffer.from(raw.subarray(0, 8)).equals(BYTES_MAGIC);
}
export const isEncryptedLine = (line: string): boolean => line.startsWith(LINE_PREFIX);

/** `ENCRYPTED`: data is encrypted and no key is loaded. `DECRYPT_FAILED`: wrong key or damaged data. */
export class EncryptionError extends JsonStoreError {
  constructor(code: 'ENCRYPTED' | 'DECRYPT_FAILED', file?: string) {
    super(
      code === 'ENCRYPTED'
        ? 'Data is encrypted and the store is locked'
        : 'Could not decrypt data (wrong key or damaged file)',
      code,
      file,
    );
    this.name = 'EncryptionError';
  }
}

/** AES-256-GCM seal: IV | tag | ciphertext. */
export function sealRaw(key: Uint8Array, plain: Uint8Array): Buffer {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

/** Inverse of sealRaw; throws EncryptionError('DECRYPT_FAILED') on a wrong key or any tampering. */
export function openRaw(key: Uint8Array, blob: Uint8Array): Buffer {
  if (blob.length < IV_LEN + TAG_LEN) throw new EncryptionError('DECRYPT_FAILED');
  const b = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  try {
    const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, IV_LEN));
    d.setAuthTag(b.subarray(IV_LEN, IV_LEN + TAG_LEN));
    return Buffer.concat([d.update(b.subarray(IV_LEN + TAG_LEN)), d.final()]);
  } catch {
    throw new EncryptionError('DECRYPT_FAILED');
  }
}

abstract class BaseCodec implements Codec {
  abstract readonly encrypting: boolean;
  abstract encode(data: Uint8Array): Buffer;
  abstract decode(raw: Uint8Array): Buffer;
  abstract encodeLine(text: string): string;
  abstract decodeLine(line: string): string;
  encodeText(text: string): Buffer {
    return this.encode(Buffer.from(text, 'utf8'));
  }
  decodeText(raw: Uint8Array): string {
    return this.decode(raw).toString('utf8');
  }
}

export class PlainCodec extends BaseCodec {
  readonly encrypting = false;
  encode(data: Uint8Array): Buffer {
    return Buffer.from(data);
  }
  decode(raw: Uint8Array): Buffer {
    if (isEncrypted(raw)) throw new EncryptionError('ENCRYPTED');
    return Buffer.from(raw);
  }
  encodeLine(text: string): string {
    return text;
  }
  decodeLine(line: string): string {
    if (isEncryptedLine(line)) throw new EncryptionError('ENCRYPTED');
    return line;
  }
}

export class AesGcmCodec extends BaseCodec {
  readonly encrypting = true;
  private readonly key: Buffer;
  constructor(key: Uint8Array) {
    super();
    if (key.length !== 32) throw new Error('AES-256 key must be 32 bytes');
    this.key = Buffer.from(key);
  }
  encode(data: Uint8Array): Buffer {
    return Buffer.concat([BYTES_MAGIC, sealRaw(this.key, data)]);
  }
  decode(raw: Uint8Array): Buffer {
    if (!isEncrypted(raw)) return Buffer.from(raw); // not yet migrated
    return openRaw(this.key, raw.subarray(BYTES_MAGIC.length));
  }
  encodeLine(text: string): string {
    return LINE_PREFIX + sealRaw(this.key, Buffer.from(text, 'utf8')).toString('base64');
  }
  decodeLine(line: string): string {
    if (!isEncryptedLine(line)) return line;
    return openRaw(this.key, Buffer.from(line.slice(LINE_PREFIX.length), 'base64')).toString(
      'utf8',
    );
  }
}

/** A codec that can be swapped at runtime (enable/disable encryption) while everything keeps one reference. */
export class CodecHolder extends BaseCodec {
  constructor(private inner: Codec = new PlainCodec()) {
    super();
  }
  get encrypting(): boolean {
    return this.inner.encrypting;
  }
  set(codec: Codec): void {
    this.inner = codec;
  }
  encode(data: Uint8Array): Buffer {
    return this.inner.encode(data);
  }
  decode(raw: Uint8Array): Buffer {
    return this.inner.decode(raw);
  }
  encodeLine(text: string): string {
    return this.inner.encodeLine(text);
  }
  decodeLine(line: string): string {
    return this.inner.decodeLine(line);
  }
}

export async function readDecoded(codec: Codec, file: string): Promise<Buffer> {
  return codec.decode(await fs.readFile(file));
}
export async function readTextDecoded(codec: Codec, file: string): Promise<string> {
  return codec.decodeText(await fs.readFile(file));
}
export async function writeEncoded(
  codec: Codec,
  file: string,
  data: string | Uint8Array,
): Promise<void> {
  await atomicWriteFile(
    file,
    codec.encode(typeof data === 'string' ? Buffer.from(data, 'utf8') : data),
  );
}
export async function writeJsonEncoded(codec: Codec, file: string, value: unknown): Promise<void> {
  await writeEncoded(codec, file, stableStringify(value));
}
