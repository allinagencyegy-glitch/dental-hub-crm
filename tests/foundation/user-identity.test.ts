import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connectTestDb, uniqueEmail, TEST_PASSWORD } from './setup/db';
import { hashPassword, verifyPassword } from '../../src/server/auth/password';
import {
  DuplicateEmailError,
  createUser,
  createUserIfAbsent,
  findUserByEmail,
  normaliseEmail,
} from '../../src/server/users/repository';

describe('user identity', () => {
  let db: Client;

  beforeAll(async () => {
    db = await connectTestDb();
  });

  afterAll(async () => {
    await db.end();
  });

  it('stores email normalised to lowercase and trimmed', async () => {
    const email = uniqueEmail('Mixed.Case');
    const user = await createUser(db, {
      displayName: 'Mixed Case',
      email: `  ${email.toUpperCase()}  `,
      password: TEST_PASSWORD,
      role: 'SALES_REP',
    });

    expect(user.email).toBe(email.toLowerCase());

    const { rows } = await db.query<{ email: string }>(
      'SELECT email FROM crm_user WHERE id = $1',
      [user.id],
    );
    expect(rows[0].email).toBe(email.toLowerCase());
  });

  it('treats differently-cased addresses as the same account', async () => {
    const email = uniqueEmail('unique.check');

    await createUser(db, {
      displayName: 'First Claim',
      email,
      password: TEST_PASSWORD,
      role: 'SALES_REP',
    });

    await expect(
      createUser(db, {
        displayName: 'Second Claim',
        email: email.toUpperCase(),
        password: TEST_PASSWORD,
        role: 'SALES_REP',
      }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);

    // ...and lookup is case-insensitive in the same way.
    const found = await findUserByEmail(db, email.toUpperCase());
    expect(found?.display_name).toBe('First Claim');
  });

  it('refuses a non-normalised address at the database level', async () => {
    await expect(
      db.query(
        `INSERT INTO crm_user (display_name, email, password_hash, role)
         VALUES ('Raw Insert', 'NOT@NORMALISED.test', '$argon2id$fake', 'SALES_REP')`,
      ),
    ).rejects.toThrow(/crm_user_email_normalised/);
  });

  it('never stores the password in plaintext', async () => {
    const email = uniqueEmail('hashing');
    const user = await createUser(db, {
      displayName: 'Hash Check',
      email,
      password: TEST_PASSWORD,
      role: 'SALES_REP',
    });

    const { rows } = await db.query<{ password_hash: string }>(
      'SELECT password_hash FROM crm_user WHERE id = $1',
      [user.id],
    );
    const stored = rows[0].password_hash;

    expect(stored).not.toBe(TEST_PASSWORD);
    expect(stored).not.toContain(TEST_PASSWORD);
    expect(stored.startsWith('$argon2id$v=19$')).toBe(true);

    // And the DTO returned to callers carries no hash field at all.
    expect(Object.keys(user)).not.toContain('passwordHash');
    expect(JSON.stringify(user)).not.toContain('$argon2');
  });

  it('rejects a plaintext password_hash at the database level', async () => {
    await expect(
      db.query(
        `INSERT INTO crm_user (display_name, email, password_hash, role)
         VALUES ('Plaintext', $1, $2, 'SALES_REP')`,
        [uniqueEmail('plaintext'), 'hunter2'],
      ),
    ).rejects.toThrow(/crm_user_password_hashed/);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const encoded = await hashPassword(TEST_PASSWORD);
    expect(await verifyPassword(encoded, TEST_PASSWORD)).toBe(true);
    expect(await verifyPassword(encoded, 'not-the-password')).toBe(false);
    expect(await verifyPassword('not-even-a-hash', TEST_PASSWORD)).toBe(false);
  });

  it('produces a distinct hash per user for an identical password', async () => {
    const a = await hashPassword(TEST_PASSWORD);
    const b = await hashPassword(TEST_PASSWORD);
    expect(a).not.toBe(b); // per-password salt
  });

  it('rejects an unknown role', async () => {
    await expect(
      db.query(
        `INSERT INTO crm_user (display_name, email, password_hash, role)
         VALUES ('Bad Role', $1, '$argon2id$fake', 'SUPER_ADMIN')`,
        [uniqueEmail('bad.role')],
      ),
    ).rejects.toThrow(/crm_user_role_known/);
  });

  it('normalises consistently in application code and SQL', () => {
    expect(normaliseEmail('  Person@Example.TEST ')).toBe('person@example.test');
  });

  it('leaves an existing account untouched when the seed helper re-runs', async () => {
    const email = uniqueEmail('rerun');

    const first = await createUserIfAbsent(db, {
      displayName: 'Seeded Operator',
      email,
      password: TEST_PASSWORD,
      role: 'SALES_MANAGER',
    });
    expect(first.created).toBe(true);

    const { rows: before } = await db.query<{ password_hash: string; updated_at: Date }>(
      'SELECT password_hash, updated_at FROM crm_user WHERE id = $1',
      [first.user.id],
    );

    const second = await createUserIfAbsent(db, {
      displayName: 'Renamed Operator',
      email,
      password: 'AnEntirelyDifferentPassword!99',
      role: 'ADMIN',
    });
    expect(second.created).toBe(false);

    const { rows: after } = await db.query<{ password_hash: string; updated_at: Date }>(
      'SELECT password_hash, updated_at FROM crm_user WHERE id = $1',
      [first.user.id],
    );

    // Non-destructive: no password reset, no role change, no touch.
    expect(after[0].password_hash).toBe(before[0].password_hash);
    expect(after[0].updated_at.getTime()).toBe(before[0].updated_at.getTime());
    expect(second.user.role).toBe('SALES_MANAGER');
  });
});
