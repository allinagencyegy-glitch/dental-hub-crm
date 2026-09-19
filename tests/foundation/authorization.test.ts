import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { uniqueEmail, TEST_PASSWORD } from './setup/db';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';
import { PERMISSIONS, ROLES, can, isRole, permissionsFor } from '../../src/server/authz/permissions';
import {
  LastActiveAdminError,
  countActiveAdmins,
  createUser,
  setUserActive,
  setUserRole,
} from '../../src/server/users/repository';

describe('role permissions', () => {
  it('grants ADMIN full foundation administration', () => {
    expect(can('ADMIN', 'crm:access')).toBe(true);
    expect(can('ADMIN', 'users:read')).toBe(true);
    expect(can('ADMIN', 'users:manage')).toBe(true);
  });

  it('grants SALES_MANAGER and SALES_REP authenticated CRM access only', () => {
    for (const role of ['SALES_MANAGER', 'SALES_REP'] as const) {
      expect(can(role, 'crm:access')).toBe(true);
      expect(can(role, 'users:read')).toBe(false);
      expect(can(role, 'users:manage')).toBe(false);
    }
  });

  it('defines exactly the three foundation roles', () => {
    expect([...ROLES]).toEqual(['ADMIN', 'SALES_MANAGER', 'SALES_REP']);
    expect(isRole('ADMIN')).toBe(true);
    expect(isRole('SUPER_ADMIN')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it('encodes no sales-domain permissions for deferred slices', () => {
    const deferred = ['pipeline', 'quotation', 'task', 'won', 'lost'];
    for (const permission of PERMISSIONS) {
      for (const term of deferred) {
        expect(permission.toLowerCase()).not.toContain(term);
      }
    }
  });

  it('gives every role a defined permission set', () => {
    for (const role of ROLES) {
      expect(Array.isArray(permissionsFor(role))).toBe(true);
    }
  });
});

describe('last active admin protection', () => {
  // These assertions depend on the global admin population, so they get a
  // private database rather than sharing one with the HTTP tier.
  let database: DisposableDatabase;
  let db: Client;

  beforeAll(async () => {
    database = await createDisposableDatabase();
    db = new Client({ connectionString: database.url });
    await db.connect();
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.end();
    await dropDisposableDatabase(database);
  });

  async function makeAdmin(prefix: string) {
    return createUser(db, {
      displayName: `${prefix} Admin`,
      email: uniqueEmail(prefix),
      password: TEST_PASSWORD,
      role: 'ADMIN',
    });
  }

  it('refuses to deactivate the last active admin', async () => {
    const admin = await makeAdmin('only.admin');
    expect(await countActiveAdmins(db)).toBe(1);

    await expect(setUserActive(db, admin.id, false)).rejects.toBeInstanceOf(LastActiveAdminError);

    // The account is genuinely untouched, not merely reported as failed.
    const { rows } = await db.query<{ is_active: boolean }>(
      'SELECT is_active FROM crm_user WHERE id = $1',
      [admin.id],
    );
    expect(rows[0].is_active).toBe(true);
    expect(await countActiveAdmins(db)).toBe(1);
  });

  it('refuses to demote the last active admin', async () => {
    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM crm_user WHERE role = 'ADMIN' AND is_active = true",
    );
    expect(rows).toHaveLength(1);

    await expect(setUserRole(db, rows[0].id, 'SALES_REP')).rejects.toBeInstanceOf(
      LastActiveAdminError,
    );

    const { rows: after } = await db.query<{ role: string }>(
      'SELECT role FROM crm_user WHERE id = $1',
      [rows[0].id],
    );
    expect(after[0].role).toBe('ADMIN');
  });

  it('allows deactivating an admin once another active admin exists', async () => {
    const second = await makeAdmin('second.admin');
    expect(await countActiveAdmins(db)).toBe(2);

    const updated = await setUserActive(db, second.id, false);
    expect(updated.isActive).toBe(false);
    expect(await countActiveAdmins(db)).toBe(1);
  });

  it('allows demoting an admin once another active admin exists', async () => {
    const third = await makeAdmin('third.admin');
    expect(await countActiveAdmins(db)).toBe(2);

    const updated = await setUserRole(db, third.id, 'SALES_MANAGER');
    expect(updated.role).toBe('SALES_MANAGER');
    expect(await countActiveAdmins(db)).toBe(1);
  });

  it('does not count a deactivated admin as an active admin', async () => {
    const spare = await makeAdmin('spare.admin');
    await setUserActive(db, spare.id, false);
    expect(await countActiveAdmins(db)).toBe(1);

    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM crm_user WHERE role = 'ADMIN' AND is_active = true",
    );
    await expect(setUserActive(db, rows[0].id, false)).rejects.toBeInstanceOf(LastActiveAdminError);
  });

  it('revokes live sessions when a user is deactivated', async () => {
    const extraAdmin = await makeAdmin('revoker.admin');
    const target = await createUser(db, {
      displayName: 'Session Holder',
      email: uniqueEmail('revoker.target'),
      password: TEST_PASSWORD,
      role: 'SALES_REP',
    });

    await db.query(
      `INSERT INTO crm_session (user_id, token_hash, expires_at)
       VALUES ($1, sha256($2::bytea), now() + interval '1 hour')`,
      [target.id, Buffer.from('a-token')],
    );

    await setUserActive(db, target.id, false);

    const { rows } = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM crm_session WHERE user_id = $1 AND revoked_at IS NULL',
      [target.id],
    );
    expect(rows[0].count).toBe('0');

    await setUserRole(db, extraAdmin.id, 'SALES_REP').catch(() => {});
  });
});
