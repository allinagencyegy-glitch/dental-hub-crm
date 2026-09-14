/**
 * Opaque, database-backed sessions.
 *
 * The cookie carries 256 bits of randomness and nothing else - no user id, no
 * role, no expiry claim. There is therefore no authentication state to trust
 * from the browser, and no signing secret that could leak.
 *
 * Only SHA-256(token) is persisted, so a dump of `crm_session` yields no usable
 * credential.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '@/server/db/types';
import type { Role } from '@/server/authz/permissions';
import { toPublicUser, type PublicUser, type UserRow } from '@/server/users/dto';

export const SESSION_TOKEN_BYTES = 32;
const DEFAULT_SESSION_TTL_HOURS = 12;

export function sessionTtlHours(): number {
  const raw = process.env.SESSION_TTL_HOURS;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SESSION_TTL_HOURS;
}

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export interface IssuedSession {
  sessionId: string;
  /** Raw token. Goes into the Set-Cookie header and is never persisted. */
  token: string;
  expiresAt: Date;
}

export interface AuthenticatedSession {
  sessionId: string;
  expiresAt: Date;
  user: PublicUser;
  role: Role;
}

export async function createSession(
  db: Db,
  userId: string,
  options: { ttlHours?: number; expiresAt?: Date } = {},
): Promise<IssuedSession> {
  const token = generateSessionToken();
  const expiresAt =
    options.expiresAt ??
    new Date(Date.now() + (options.ttlHours ?? sessionTtlHours()) * 60 * 60 * 1000);

  const { rows } = await db.query<{ id: string; expires_at: Date }>(
    `INSERT INTO crm_session (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, expires_at`,
    [userId, hashSessionToken(token), expiresAt],
  );

  return { sessionId: rows[0].id, token, expiresAt: rows[0].expires_at };
}

/**
 * The authoritative check. A session resolves only if it exists, has not been
 * revoked, has not expired, AND still belongs to an active user - all evaluated
 * server-side on every request.
 */
export async function resolveSession(db: Db, token: string): Promise<AuthenticatedSession | null> {
  if (!token) return null;

  const { rows } = await db.query<UserRow & { session_id: string; session_expires_at: Date }>(
    `SELECT s.id AS session_id,
            s.expires_at AS session_expires_at,
            u.id, u.display_name, u.email, u.password_hash,
            u.role, u.is_active, u.created_at, u.updated_at
       FROM crm_session s
       JOIN crm_user u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.is_active = true`,
    [hashSessionToken(token)],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    sessionId: row.session_id,
    expiresAt: row.session_expires_at,
    user: toPublicUser(row),
    role: row.role,
  };
}

/** Returns true if a live session was revoked by this call. */
export async function revokeSession(db: Db, token: string): Promise<boolean> {
  if (!token) return false;
  const { rowCount } = await db.query(
    'UPDATE crm_session SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashSessionToken(token)],
  );
  return (rowCount ?? 0) > 0;
}

export async function revokeAllSessionsForUser(db: Db, userId: string): Promise<number> {
  const { rowCount } = await db.query(
    'UPDATE crm_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  return rowCount ?? 0;
}

/** Housekeeping helper; not wired to a scheduler in Foundation v0. */
export async function deleteExpiredSessions(db: Db): Promise<number> {
  const { rowCount } = await db.query('DELETE FROM crm_session WHERE expires_at <= now()');
  return rowCount ?? 0;
}
