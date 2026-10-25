import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import type { Client } from 'pg';
import { connectTestDb, uniqueEmail, TEST_PASSWORD } from './setup/db';
import { HttpClient } from './setup/http';
import { createUser } from '../../src/server/users/repository';
import type { PublicUser } from '../../src/server/users/dto';
import {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MINUTES,
  clearLoginAttempts,
  deleteExpiredLoginThrottles,
  reserveLoginAttempt,
} from '../../src/server/auth/login-throttle';

const SESSION_COOKIE = '__Host-dental_hub_session';
const TOO_MANY = 'Too many sign-in attempts.';

async function signIn(email: string, password = TEST_PASSWORD) {
  const http = new HttpClient(inject('baseUrl'));
  const response = await http.submitForm('/login', { email, password });
  return { http, response };
}

/** Moves an email's window into the past, as if `minutes` had elapsed. */
async function ageWindow(db: Client, email: string, minutes: number) {
  await db.query(
    `UPDATE crm_login_throttle
        SET window_started_at = window_started_at - make_interval(mins => $2)
      WHERE email = $1`,
    [email, minutes],
  );
}

describe('login throttle (repository)', () => {
  let db: Client;

  beforeAll(async () => {
    db = await connectTestDb();
  });

  afterAll(async () => {
    await db.end();
  });

  it('allows the first LOGIN_MAX_ATTEMPTS attempts and refuses the next', async () => {
    const email = uniqueEmail('throttle.limit');

    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      expect(await reserveLoginAttempt(db, email)).toEqual({ allowed: true });
    }

    const refused = await reserveLoginAttempt(db, email);
    expect(refused.allowed).toBe(false);
    if (refused.allowed) return;

    const { rows } = await db.query<{ window_started_at: Date }>(
      'SELECT window_started_at FROM crm_login_throttle WHERE email = $1',
      [email],
    );
    expect(refused.retryAt.getTime()).toBe(
      rows[0].window_started_at.getTime() + LOGIN_WINDOW_MINUTES * 60 * 1000,
    );
  });

  it('counts parallel attempts atomically', async () => {
    const email = uniqueEmail('throttle.parallel');
    const clients = await Promise.all(Array.from({ length: 4 }, () => connectTestDb()));

    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => reserveLoginAttempt(clients[i % clients.length], email)),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(LOGIN_MAX_ATTEMPTS);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it('shares one counter across case and surrounding whitespace', async () => {
    const email = uniqueEmail('throttle.case');

    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      await reserveLoginAttempt(db, i % 2 === 0 ? email.toUpperCase() : `  ${email} `);
    }

    expect((await reserveLoginAttempt(db, email)).allowed).toBe(false);
  });

  it('starts a fresh window once the old one has expired', async () => {
    const email = uniqueEmail('throttle.expiry');
    for (let i = 0; i <= LOGIN_MAX_ATTEMPTS; i += 1) await reserveLoginAttempt(db, email);
    expect((await reserveLoginAttempt(db, email)).allowed).toBe(false);

    await ageWindow(db, email, LOGIN_WINDOW_MINUTES);

    expect(await reserveLoginAttempt(db, email)).toEqual({ allowed: true });
    const { rows } = await db.query<{ attempts: number }>(
      'SELECT attempts FROM crm_login_throttle WHERE email = $1',
      [email],
    );
    expect(rows[0].attempts).toBe(1);
  });

  it('clears the counter', async () => {
    const email = uniqueEmail('throttle.clear');
    for (let i = 0; i <= LOGIN_MAX_ATTEMPTS; i += 1) await reserveLoginAttempt(db, email);

    await clearLoginAttempts(db, email.toUpperCase());

    expect(await reserveLoginAttempt(db, email)).toEqual({ allowed: true });
  });

  it('housekeeping deletes only expired windows', async () => {
    const expired = uniqueEmail('throttle.sweep.old');
    const live = uniqueEmail('throttle.sweep.live');
    await reserveLoginAttempt(db, expired);
    await reserveLoginAttempt(db, live);
    await ageWindow(db, expired, LOGIN_WINDOW_MINUTES + 1);

    expect(await deleteExpiredLoginThrottles(db)).toBeGreaterThanOrEqual(1);

    const { rows } = await db.query<{ email: string }>(
      'SELECT email FROM crm_login_throttle WHERE email = ANY($1)',
      [[expired, live]],
    );
    expect(rows.map((r) => r.email)).toEqual([live]);
  });

  it('rejects an email that was not normalised', async () => {
    await expect(
      db.query('INSERT INTO crm_login_throttle (email, attempts) VALUES ($1, 1)', ['Mixed@Case.test']),
    ).rejects.toThrow(/crm_login_throttle_email_normalised/);
  });
});

describe('login throttle (HTTP)', () => {
  let db: Client;
  let user: PublicUser;

  beforeAll(async () => {
    db = await connectTestDb();
    user = await createUser(db, {
      displayName: 'Throttle User',
      email: uniqueEmail('throttle.http'),
      password: TEST_PASSWORD,
      role: 'SALES_REP',
    });
  });

  afterAll(async () => {
    await db.end();
  });

  it('refuses even the correct password once the attempts run out, and issues no session', async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      const { response } = await signIn(user.email, 'wrong-password');
      expect(response.body).toContain('Invalid email or password.');
    }

    const { http, response } = await signIn(user.email);

    expect(response.body).toContain(TOO_MANY);
    expect(response.body).toContain(`Try again in ${LOGIN_WINDOW_MINUTES} minutes.`);
    expect(response.setCookie.some((c) => c.startsWith(SESSION_COOKIE))).toBe(false);
    expect(http.cookie(SESSION_COOKIE)).toBeUndefined();

    const { rows } = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM crm_session WHERE user_id = $1',
      [user.id],
    );
    expect(rows[0].count).toBe('0');
  });

  it('lets the user sign in again once the window has passed', async () => {
    await ageWindow(db, user.email, LOGIN_WINDOW_MINUTES);

    const { response } = await signIn(user.email);

    expect(response.status).toBe(303);
    expect(response.location).toBe('/crm');
  });

  it('resets the count after a successful sign-in', async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS - 1; i += 1) await signIn(user.email, 'wrong-password');
    expect((await signIn(user.email)).response.status).toBe(303);

    for (let i = 0; i < LOGIN_MAX_ATTEMPTS - 1; i += 1) await signIn(user.email, 'wrong-password');
    const { response } = await signIn(user.email);

    expect(response.status).toBe(303);
  });

  it('locks an unknown email with the same message, so a lockout reveals nothing', async () => {
    const unknown = uniqueEmail('throttle.nobody');
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      const { response } = await signIn(unknown);
      expect(response.body).toContain('Invalid email or password.');
    }

    const { response } = await signIn(unknown);
    expect(response.body).toContain(TOO_MANY);
  });
});
