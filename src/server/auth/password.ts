/**
 * Password hashing. argon2id with OWASP-aligned parameters.
 *
 * The encoded hash is self-describing ("$argon2id$v=19$m=...,t=...,p=..."), so
 * parameters can be raised later and rehash-on-login added without a migration.
 */
import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

// @node-rs/argon2 exposes Algorithm as an ambient const enum, which cannot be
// imported under `isolatedModules`. 2 === Algorithm.Argon2id.
const ARGON2ID = 2;

const HASH_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, HASH_OPTIONS);
}

export async function verifyPassword(encodedHash: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(encodedHash, plaintext);
  } catch {
    // A malformed or truncated hash is a failed verification, never a crash.
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns roughly the same CPU as a real verification so that "no such email" and
 * "wrong password" are not distinguishable by response time.
 */
export async function verifyAgainstDummyHash(plaintext: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  await verifyPassword(await dummyHash, plaintext);
  return false;
}
