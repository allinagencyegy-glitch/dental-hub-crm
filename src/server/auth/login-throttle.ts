/**
 * Per-email sign-in throttling, backed by `crm_login_throttle`.
 *
 * Every attempt is reserved before the password is verified: one atomic upsert
 * increments the counter and returns it, so parallel guesses cannot all read
 * "under the limit" before any of them is recorded. A successful sign-in clears
 * the counter, which makes the limit effectively "failures in a row".
 *
 * Unknown emails are throttled exactly like real ones, so a lockout is never an
 * account-existence oracle.
 */
import type { Db } from '@/server/db/types';
import { normaliseEmail } from '@/server/users/repository';

/** Attempts allowed per email within one window. The next one is refused. */
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MINUTES = 15;

export type LoginAttemptReservation =
  | { allowed: true }
  | { allowed: false; retryAt: Date };

/**
 * Counts one sign-in attempt for `email`. A window older than
 * LOGIN_WINDOW_MINUTES restarts at this attempt.
 */
export async function reserveLoginAttempt(db: Db, email: string): Promise<LoginAttemptReservation> {
  const { rows } = await db.query<{ attempts: number; window_started_at: Date }>(
    `INSERT INTO crm_login_throttle AS t (email, attempts, window_started_at)
     VALUES ($1, 1, now())
     ON CONFLICT (email) DO UPDATE SET
       attempts = CASE WHEN t.window_started_at <= now() - make_interval(mins => $2)
                       THEN 1 ELSE t.attempts + 1 END,
       window_started_at = CASE WHEN t.window_started_at <= now() - make_interval(mins => $2)
                                THEN now() ELSE t.window_started_at END
     RETURNING attempts, window_started_at`,
    [normaliseEmail(email), LOGIN_WINDOW_MINUTES],
  );

  const { attempts, window_started_at: windowStartedAt } = rows[0];
  if (attempts <= LOGIN_MAX_ATTEMPTS) return { allowed: true };

  return {
    allowed: false,
    retryAt: new Date(windowStartedAt.getTime() + LOGIN_WINDOW_MINUTES * 60 * 1000),
  };
}

/** Called after a successful sign-in. */
export async function clearLoginAttempts(db: Db, email: string): Promise<void> {
  await db.query('DELETE FROM crm_login_throttle WHERE email = $1', [normaliseEmail(email)]);
}

/** Housekeeping helper, like deleteExpiredSessions; not wired to a scheduler. */
export async function deleteExpiredLoginThrottles(db: Db): Promise<number> {
  const { rowCount } = await db.query(
    'DELETE FROM crm_login_throttle WHERE window_started_at <= now() - make_interval(mins => $1)',
    [LOGIN_WINDOW_MINUTES],
  );
  return rowCount ?? 0;
}
