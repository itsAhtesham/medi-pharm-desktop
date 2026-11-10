import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
} from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { z } from 'zod';
import { databaseInfoSchema, type DatabaseInfo } from '../db/health';
import { backupPassphraseSchema } from '../contracts/backup';

export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const magic = Buffer.from('MPBACK01');
const hex = (bytes: number) => z.string().regex(new RegExp(`^[a-f0-9]{${bytes * 2}}$`));
export const envelopeSchema = z
  .object({
    version: z.literal(1),
    N: z.literal(32768),
    r: z.literal(8),
    p: z.literal(3),
    salt: hex(16),
    nonce: hex(12),
    wrappedKey: hex(32),
    tag: hex(16),
  })
  .strict();
export type KeyEnvelope = z.infer<typeof envelopeSchema>;
const headerSchema = z
  .object({
    format: z.literal(1),
    envelope: envelopeSchema,
    nonce: hex(12),
    payloadBytes: z.number().int().min(1).max(MAX_ARCHIVE_BYTES),
  })
  .strict();
export const manifestSchema = databaseInfoSchema
  .extend({
    format: z.literal(1),
    backupId: z.uuid(),
    appVersion: z.string().max(40),
    sourcePlatform: z.string().max(20),
    startedAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative(),
    size: z.number().int().positive().max(MAX_ARCHIVE_BYTES),
    sha256: hex(32),
  })
  .strict();
export type Manifest = z.infer<typeof manifestSchema>;
export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
function wrappingKey(passphrase: string, salt: string): Promise<Buffer> {
  backupPassphraseSchema.parse(passphrase);
  return new Promise((resolve, reject) =>
    scrypt(
      passphrase,
      Buffer.from(salt, 'hex'),
      32,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
function seal(
  key: Buffer,
  nonce: Buffer,
  plaintext: Buffer,
  aad: Buffer,
): { encrypted: Buffer; tag: Buffer } {
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  return {
    encrypted: Buffer.concat([cipher.update(plaintext), cipher.final()]),
    tag: cipher.getAuthTag(),
  };
}
function open(key: Buffer, nonce: Buffer, ciphertext: Buffer, tag: Buffer, aad: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  // Nothing is written or parsed until final() has authenticated the whole payload.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
const envelopeAad = Buffer.from('MediPharm backup master key v1');
export async function wrapKey(key: Buffer, passphrase: string): Promise<KeyEnvelope> {
  const salt = randomBytes(16).toString('hex');
  const nonce = randomBytes(12);
  const wrapping = await wrappingKey(passphrase, salt);
  try {
    const sealed = seal(wrapping, nonce, key, envelopeAad);
    return {
      version: 1,
      N: 32768,
      r: 8,
      p: 3,
      salt,
      nonce: nonce.toString('hex'),
      wrappedKey: sealed.encrypted.toString('hex'),
      tag: sealed.tag.toString('hex'),
    };
  } finally {
    wrapping.fill(0);
  }
}
export async function unwrapKey(raw: KeyEnvelope, passphrase: string): Promise<Buffer> {
  const envelope = envelopeSchema.parse(raw);
  const wrapping = await wrappingKey(passphrase, envelope.salt);
  try {
    return open(
      wrapping,
      Buffer.from(envelope.nonce, 'hex'),
      Buffer.from(envelope.wrappedKey, 'hex'),
      Buffer.from(envelope.tag, 'hex'),
      envelopeAad,
    );
  } finally {
    wrapping.fill(0);
  }
}
export function readBounded(filename: string, limit = MAX_ARCHIVE_BYTES): Buffer {
  const fd = openSync(filename, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > limit)
      throw new Error('Unsupported file size.');
    const value = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < value.length) {
      const count = readSync(fd, value, offset, value.length - offset, null);
      if (count === 0) throw new Error('File changed while reading.');
      offset += count;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0)
      throw new Error('File changed while reading.');
    return value;
  } finally {
    closeSync(fd);
  }
}
export function encodeArchive(
  database: Buffer,
  info: DatabaseInfo,
  key: Buffer,
  envelope: KeyEnvelope,
  startedAt: number,
  appVersion: string,
): { bytes: Buffer; manifest: Manifest } {
  const manifest = manifestSchema.parse({
    ...info,
    format: 1,
    backupId: randomUUID(),
    appVersion,
    sourcePlatform: process.platform,
    startedAt,
    completedAt: Date.now(),
    size: database.length,
    sha256: sha256(database),
  });
  const metadata = Buffer.from(JSON.stringify(manifest));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(metadata.length);
  const payload = Buffer.concat([length, metadata, database]);
  const nonce = randomBytes(12);
  const header = Buffer.from(
    JSON.stringify(
      headerSchema.parse({
        format: 1,
        envelope,
        nonce: nonce.toString('hex'),
        payloadBytes: payload.length,
      }),
    ),
  );
  const headerLength = Buffer.alloc(4);
  headerLength.writeUInt32BE(header.length);
  const aad = Buffer.concat([magic, headerLength, header]);
  const encrypted = seal(key, nonce, payload, aad);
  const bytes = Buffer.concat([aad, encrypted.encrypted, encrypted.tag]);
  if (bytes.length > MAX_ARCHIVE_BYTES)
    throw new Error('Database exceeds the preview archive size limit.');
  return { bytes, manifest };
}
function parseHeader(bytes: Buffer) {
  if (bytes.length < 28 || bytes.length > MAX_ARCHIVE_BYTES || !bytes.subarray(0, 8).equals(magic))
    throw new Error('Invalid archive.');
  const size = bytes.readUInt32BE(8);
  if (size < 1 || size > 4096 || 12 + size + 16 > bytes.length)
    throw new Error('Invalid header size.');
  const header = headerSchema.parse(JSON.parse(bytes.subarray(12, 12 + size).toString('utf8')));
  if (bytes.length !== 12 + size + header.payloadBytes + 16)
    throw new Error('Archive length mismatch.');
  return { header, offset: 12 + size };
}
export function decodeWithKey(
  bytes: Buffer,
  key: Buffer,
): { database: Buffer; manifest: Manifest; envelope: KeyEnvelope } {
  const { header, offset } = parseHeader(bytes);
  const payload = open(
    key,
    Buffer.from(header.nonce, 'hex'),
    bytes.subarray(offset, -16),
    bytes.subarray(-16),
    bytes.subarray(0, offset),
  );
  if (payload.length < 4) throw new Error('Invalid payload.');
  const size = payload.readUInt32BE(0);
  if (size < 1 || size > 8192 || size + 4 >= payload.length)
    throw new Error('Invalid manifest size.');
  const manifest = manifestSchema.parse(JSON.parse(payload.subarray(4, 4 + size).toString('utf8')));
  const database = payload.subarray(4 + size);
  if (database.length !== manifest.size || sha256(database) !== manifest.sha256)
    throw new Error('Snapshot checksum mismatch.');
  return { database, manifest, envelope: header.envelope };
}
export async function decodeArchive(bytes: Buffer, passphrase: string) {
  const { header } = parseHeader(bytes);
  const key = await unwrapKey(header.envelope, passphrase);
  try {
    return { ...decodeWithKey(bytes, key), key };
  } catch (error) {
    key.fill(0);
    throw error;
  }
}
