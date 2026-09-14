import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { createHash } from 'node:crypto';
import { connectTestDb, uniqueEmail, TEST_PASSWORD } from './setup/db';
import { createUser, setUserActive } from '../../src/server/users/repository';
import {
  createSession,
  generateSessionToken,
  hashSessionToken,
  resolveSession,
  revokeAllSessionsForUser,
  revokeSession,
} from '../../src/server/auth/session';

async function makeUser(db: Client, prefix: string, role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP') {
  return createUser(db, {
    displayName: `${prefix} User`,
    email: uniqueEmail(prefix),
    password: TEST_PASSWORD,
    role,
  });
}

describe('session lifecycle', () => {
  let db: Client;

  beforeAll(async () => {
    db = await connectTestDb();
  });

  afterAll(async () => {
    await db.end();
  });

  it('issues a high-entropy opaque token', () => {
    const token = generateSessionToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32); // 256 bits
    expect(token).not.toBe(generateSessionToken());
  });

  it('persists only the SHA-256 hash of the token, never the token', async () => {
    const user = await makeUser(db, 'session.store', 'SALES_REP');
    const session = await createSession(db, user.id);

    const { rows } = await db.query<{ token_hash: Buffer }>(
      'SELECT token_hash FROM crm_session WHERE id = $1',
      [session.sessionId],
    );

    expect(rows[0].token_hash).toHaveLength(32);
    expect(rows[0].token_hash.equals(createHash('sha256').update(session.token).digest())).toBe(true);

    // The raw token appears nowhere in the row.
    const { rows: raw } = await db.query<{ row: string }>(
      'SELECT crm_session::text AS row FROM crm_session WHERE id = $1',
      [session.sessionId],
    );
    expect(raw[0].row).not.toContain(session.token);
  });

  it('resolves a valid session to its user', async () => {
    const user = await makeUser(db, 'session.valid', 'SALES_MANAGER');
    const session = await createSession(db, user.id);

    const resolved = await resolveSession(db, session.token);
    expect(resolved?.user.id).toBe(user.id);
    expect(resolved?.role).toBe('SALES_MANAGER');
    expect(resolved?.sessionId).toBe(session.sessionId);
  });

  it('rejects an unknown token', async () => {
    expect(await resolveSession(db, generateSessionToken())).toBeNull();
    expect(await resolveSession(db, '')).toBeNull();
  });

  it('rejects a revoked session and cannot be replayed', async () => {
    const user = await makeUser(db, 'session.revoked', 'SALES_REP');
    const session = await createSession(db, user.id);

    expect(await resolveSession(db, session.token)).not.toBeNull();
    expect(await revokeSession(db, session.token)).toBe(true);
    expect(await resolveSession(db, session.token)).toBeNull();

    // Replaying the same token later still fails.
    expect(await resolveSession(db, session.token)).toBeNull();
    // Revoking again reports that nothing live was revoked.
    expect(await revokeSession(db, session.token)).toBe(false);
  });

  it('rejects an expired session', async () => {
    const user = await makeUser(db, 'session.expired', 'SALES_REP');
    const session = await createSession(db, user.id, { ttlHours: 1 });

    expect(await resolveSession(db, session.token)).not.toBeNull();

    // Rather than sleeping, rewrite the row into a session that was legitimately
    // issued in the past and has since lapsed: created_at < expires_at < now().
    // The crm_session_expiry_after_creation invariant still holds.
    await db.query(
      `UPDATE crm_session
          SET created_at = now() - interval '2 hours',
              expires_at = now() - interval '1 hour'
        WHERE id = $1`,
      [session.sessionId],
    );

    expect(await resolveSession(db, session.token)).toBeNull();
  });

  it('stops resolving a live session once the user is deactivated', async () => {
    const user = await makeUser(db, 'session.deactivated', 'SALES_REP');
    const session = await createSession(db, user.id);
    expect(await resolveSession(db, session.token)).not.toBeNull();

    await setUserActive(db, user.id, false);

    expect(await resolveSession(db, session.token)).toBeNull();
  });

  it('refuses to resolve a session for a user deactivated directly in SQL', async () => {
    const user = await makeUser(db, 'session.sqldeact', 'SALES_REP');
    const session = await createSession(db, user.id);

    // Bypasses the repository entirely: the join condition is the real guard.
    await db.query('UPDATE crm_user SET is_active = false WHERE id = $1', [user.id]);

    expect(await resolveSession(db, session.token)).toBeNull();
  });

  it('revokes every live session for a user at once', async () => {
    const user = await makeUser(db, 'session.bulk', 'SALES_REP');
    const first = await createSession(db, user.id);
    const second = await createSession(db, user.id);

    expect(await revokeAllSessionsForUser(db, user.id)).toBe(2);
    expect(await resolveSession(db, first.token)).toBeNull();
    expect(await resolveSession(db, second.token)).toBeNull();
  });

  it('enforces the token hash shape in the database', async () => {
    const user = await makeUser(db, 'session.shape', 'SALES_REP');

    await expect(
      db.query(
        `INSERT INTO crm_session (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '1 hour')`,
        [user.id, Buffer.from('too-short')],
      ),
    ).rejects.toThrow(/crm_session_token_hash_len/);
  });

  it('refuses a session that expires no later than it was created', async () => {
    const user = await makeUser(db, 'session.window', 'SALES_REP');

    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    // Zero-length and negative lifetimes are both unrepresentable. Killing a
    // session immediately is revoked_at's job, not a collapsed window.
    for (const expiresAt of [createdAt, new Date(createdAt.getTime() - 1_000)]) {
      await expect(
        db.query(
          `INSERT INTO crm_session (user_id, token_hash, created_at, expires_at)
           VALUES ($1, sha256($2::bytea), $3, $4)`,
          [user.id, Buffer.from(generateSessionToken()), createdAt, expiresAt],
        ),
      ).rejects.toThrow(/crm_session_expiry_after_creation/);
    }
  });

  it('hashes a token deterministically', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token).equals(hashSessionToken(token))).toBe(true);
    expect(hashSessionToken(token).equals(hashSessionToken(generateSessionToken()))).toBe(false);
  });
});
