/**
 * All SQL touching `crm_user`. Explicit, parameterised, no ORM.
 *
 * Every function takes its `Db` explicitly so the same code serves the app pool,
 * a transaction client, seeds and the disposable test database.
 */
import { Pool, type PoolClient } from 'pg';
import type { Db } from '@/server/db/types';
import { beginTransaction, commitTransaction, rollbackTransaction } from '@/server/db/transaction';
import type { Role } from '@/server/authz/permissions';
import { hashPassword } from '@/server/auth/password';
import { toPublicUser, type PublicUser, type UserRow } from './dto';

const USER_COLUMNS =
  'id, display_name, email, password_hash, role, is_active, created_at, updated_at';

/** The one place email normalisation is defined. Mirrored by a DB CHECK. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class LastActiveAdminError extends Error {
  constructor() {
    super('This is the last active admin. Promote or activate another admin first.');
    this.name = 'LastActiveAdminError';
  }
}

export class DuplicateEmailError extends Error {
  constructor() {
    super('That email address is already in use.');
    this.name = 'DuplicateEmailError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM crm_user WHERE email = $1`,
    [normaliseEmail(email)],
  );
  return rows[0] ?? null;
}

export async function findUserById(db: Db, id: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM crm_user WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listUsers(db: Db): Promise<PublicUser[]> {
  const { rows } = await db.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM crm_user ORDER BY is_active DESC, display_name ASC`,
  );
  return rows.map(toPublicUser);
}

export interface CreateUserInput {
  displayName: string;
  email: string;
  password: string;
  role: Role;
  isActive?: boolean;
}

export async function createUser(db: Db, input: CreateUserInput): Promise<PublicUser> {
  const passwordHash = await hashPassword(input.password);
  try {
    const { rows } = await db.query<UserRow>(
      `INSERT INTO crm_user (display_name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${USER_COLUMNS}`,
      [
        input.displayName.trim(),
        normaliseEmail(input.email),
        passwordHash,
        input.role,
        input.isActive ?? true,
      ],
    );
    return toPublicUser(rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateEmailError();
    throw error;
  }
}

/**
 * Creates the user only if the email is free. Used by the rerunnable dev seed;
 * an existing row is left completely untouched (no password reset).
 */
export async function createUserIfAbsent(
  db: Db,
  input: CreateUserInput,
): Promise<{ created: boolean; user: PublicUser }> {
  const existing = await findUserByEmail(db, input.email);
  if (existing) return { created: false, user: toPublicUser(existing) };

  try {
    return { created: true, user: await createUser(db, input) };
  } catch (error) {
    // Lost a race against a concurrent seed - the existing row still wins.
    if (error instanceof DuplicateEmailError) {
      const row = await findUserByEmail(db, input.email);
      if (row) return { created: false, user: toPublicUser(row) };
    }
    throw error;
  }
}

/**
 * Runs `work` in a transaction that holds a write lock on every ADMIN row, then
 * refuses to commit if the result would leave zero active admins.
 *
 * Locking before counting is what makes this safe when two admins deactivate
 * each other at the same moment.
 */
async function withLastAdminGuard<T>(db: Db, work: (tx: Db) => Promise<T>): Promise<T> {
  // Client also exposes .connect(), so the check must be on the concrete type.
  const isPool = db instanceof Pool;
  const client: Db = isPool ? await db.connect() : db;

  try {
    await client.query('BEGIN');
    await client.query("SELECT id FROM crm_user WHERE role = 'ADMIN' FOR UPDATE");

    const result = await work(client);

    const { rows } = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM crm_user WHERE role = 'ADMIN' AND is_active = true",
    );
    if (Number(rows[0].count) === 0) {
      await client.query('ROLLBACK');
      throw new LastActiveAdminError();
    }

    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (!(error instanceof LastActiveAdminError)) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    if (isPool) (client as PoolClient).release();
  }
}

export async function setUserRole(db: Db, id: string, role: Role): Promise<PublicUser> {
  return withLastAdminGuard(db, async (tx) => {
    const { rows } = await tx.query<UserRow>(
      `UPDATE crm_user SET role = $2, updated_at = now() WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, role],
    );
    if (!rows[0]) throw new Error('User not found.');
    return toPublicUser(rows[0]);
  });
}

export async function setUserActive(db: Db, id: string, isActive: boolean): Promise<PublicUser> {
  return withLastAdminGuard(db, async (tx) => {
    const { rows } = await tx.query<UserRow>(
      `UPDATE crm_user SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, isActive],
    );
    if (!rows[0]) throw new Error('User not found.');

    // Deactivating a user must also end their live sessions immediately.
    if (!isActive) {
      await tx.query(
        'UPDATE crm_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
        [id],
      );
    }
    return toPublicUser(rows[0]);
  });
}

/**
 * Replaces the user's password and revokes every other live session they hold,
 * in one transaction: a password change is how a user locks out someone who
 * learned the old one, so a session that person already holds must not survive
 * it. The session making the change (`keepSessionId`) stays signed in.
 */
export async function changeUserPassword(
  db: Db,
  userId: string,
  newPassword: string,
  keepSessionId: string,
): Promise<{ revokedSessions: number }> {
  // Hashed before the transaction opens so no row is locked during argon2.
  const passwordHash = await hashPassword(newPassword);
  const { client, release } = await beginTransaction(db);

  try {
    const { rowCount } = await client.query(
      'UPDATE crm_user SET password_hash = $2, updated_at = now() WHERE id = $1',
      [userId, passwordHash],
    );
    if (rowCount !== 1) throw new Error('User not found.');

    const revoked = await client.query(
      `UPDATE crm_session SET revoked_at = now()
        WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
      [userId, keepSessionId],
    );

    await commitTransaction(client);
    return { revokedSessions: revoked.rowCount ?? 0 };
  } catch (error) {
    await rollbackTransaction(client);
    throw error;
  } finally {
    release();
  }
}

export async function countActiveAdmins(db: Db): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM crm_user WHERE role = 'ADMIN' AND is_active = true",
  );
  return Number(rows[0].count);
}
