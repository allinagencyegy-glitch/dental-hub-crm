import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { ZodError } from 'zod';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';
import { verifyPassword } from '../../src/server/auth/password';
import { AdminAlreadyExistsError, createBootstrapAdmin } from '../../src/server/users/bootstrap';
import {
  DuplicateEmailError,
  createUser,
  findUserByEmail,
} from '../../src/server/users/repository';
import { TEST_PASSWORD, uniqueEmail } from './setup/db';

/**
 * `npm run admin:create`: the first admin on an empty production database.
 *
 * Runs in its own database because "no admin exists yet" cannot be arranged in
 * the shared one, which other files fill with admins.
 */
describe('first admin bootstrap', () => {
  let database: DisposableDatabase;
  let db: Client;

  async function connect(): Promise<Client> {
    const client = new Client({ connectionString: database.url });
    await client.connect();
    return client;
  }

  beforeAll(async () => {
    database = await createDisposableDatabase();
    db = await connect();
    await runMigrations(db);
  });

  afterAll(async () => {
    await db?.end();
    if (database) await dropDisposableDatabase(database);
  });

  beforeEach(async () => {
    await db.query('DELETE FROM crm_user');
  });

  async function adminCount(): Promise<number> {
    const { rows } = await db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM crm_user WHERE role = 'ADMIN'",
    );
    return Number(rows[0].count);
  }

  it('creates an active admin who can sign in with the chosen password', async () => {
    const email = uniqueEmail('First.Admin');
    const user = await createBootstrapAdmin(db, {
      displayName: '  Clinic Owner ',
      email: `  ${email.toUpperCase()} `,
      password: TEST_PASSWORD,
    });

    expect(user).toMatchObject({
      displayName: 'Clinic Owner',
      email: email.toLowerCase(),
      role: 'ADMIN',
      isActive: true,
    });
    const row = await findUserByEmail(db, email);
    expect(row).not.toBeNull();
    expect(await verifyPassword(row!.password_hash, TEST_PASSWORD)).toBe(true);
  });

  it('refuses while an active admin exists, and creates nothing', async () => {
    await createBootstrapAdmin(db, {
      displayName: 'Owner',
      email: uniqueEmail('owner'),
      password: TEST_PASSWORD,
    });

    await expect(
      createBootstrapAdmin(db, {
        displayName: 'Second',
        email: uniqueEmail('second'),
        password: TEST_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(AdminAlreadyExistsError);
    expect(await adminCount()).toBe(1);
  });

  it('does not count an inactive admin or other roles as an existing admin', async () => {
    await createUser(db, {
      displayName: 'Former Admin',
      email: uniqueEmail('former'),
      password: TEST_PASSWORD,
      role: 'ADMIN',
      isActive: false,
    });
    await createUser(db, {
      displayName: 'Manager',
      email: uniqueEmail('manager'),
      password: TEST_PASSWORD,
      role: 'SALES_MANAGER',
    });

    const user = await createBootstrapAdmin(db, {
      displayName: 'New Owner',
      email: uniqueEmail('new-owner'),
      password: TEST_PASSWORD,
    });
    expect(user.role).toBe('ADMIN');
  });

  it('creates another admin with force, for when every admin is locked out', async () => {
    await createBootstrapAdmin(db, {
      displayName: 'Owner',
      email: uniqueEmail('owner'),
      password: TEST_PASSWORD,
    });

    await createBootstrapAdmin(
      db,
      { displayName: 'Recovery', email: uniqueEmail('recovery'), password: TEST_PASSWORD },
      { force: true },
    );
    expect(await adminCount()).toBe(2);
  });

  it('rejects a password shorter than 12 characters, a bad email and a blank name', async () => {
    const valid = { displayName: 'Owner', email: uniqueEmail('owner'), password: TEST_PASSWORD };

    await expect(createBootstrapAdmin(db, { ...valid, password: 'short-pw-11' })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(createBootstrapAdmin(db, { ...valid, email: 'not-an-email' })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(createBootstrapAdmin(db, { ...valid, displayName: '   ' })).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(await adminCount()).toBe(0);
  });

  it('reports a taken email and leaves the existing account alone', async () => {
    const email = uniqueEmail('taken');
    const rep = await createUser(db, {
      displayName: 'Rep',
      email,
      password: TEST_PASSWORD,
      role: 'SALES_REP',
    });

    await expect(
      createBootstrapAdmin(db, { displayName: 'Owner', email, password: 'Another-Password-1' }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
    const row = await findUserByEmail(db, email);
    expect(row).toMatchObject({ id: rep.id, role: 'SALES_REP' });
    expect(await verifyPassword(row!.password_hash, TEST_PASSWORD)).toBe(true);
  });

  it('lets only one of two simultaneous first runs succeed', async () => {
    const other = await connect();
    try {
      const results = await Promise.allSettled([
        createBootstrapAdmin(db, { displayName: 'A', email: uniqueEmail('a'), password: TEST_PASSWORD }),
        createBootstrapAdmin(other, { displayName: 'B', email: uniqueEmail('b'), password: TEST_PASSWORD }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(AdminAlreadyExistsError);
      expect(await adminCount()).toBe(1);
    } finally {
      await other.end();
    }
  });
});
