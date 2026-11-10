import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// Versioned and bounded: never trust KDF work factors read from a database.
const hashSchema = z
  .object({
    v: z.literal(1),
    algorithm: z.literal('scrypt'),
    N: z.literal(32768),
    r: z.literal(8),
    p: z.literal(3),
    salt: z.string().regex(/^[a-f0-9]{32}$/),
    key: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
function derive(secret: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      secret,
      Buffer.from(salt, 'hex'),
      32,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(secret, salt);
  return JSON.stringify({
    v: 1,
    algorithm: 'scrypt',
    N: 32768,
    r: 8,
    p: 3,
    salt,
    key: key.toString('hex'),
  });
}
export function validateHash(encoded: string): void {
  hashSchema.parse(JSON.parse(encoded));
}
export async function verifySecret(secret: string, encoded: string): Promise<boolean> {
  const value = hashSchema.parse(JSON.parse(encoded));
  return timingSafeEqual(await derive(secret, value.salt), Buffer.from(value.key, 'hex'));
}
