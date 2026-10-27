/**
 * Meta signs every webhook delivery with the app secret: the header
 * `X-Hub-Signature-256: sha256=<hex>` is an HMAC-SHA256 of the exact request
 * bytes. Anyone can find the webhook URL, so a delivery whose signature does
 * not match is refused before anything reads it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function isValidMetaSignature(rawBody: Buffer, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  // A malformed hex string decodes short; the length check also keeps
  // timingSafeEqual from throwing.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Compares two secrets without leaking how much of them matched. */
export function sameSecret(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
