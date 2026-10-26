import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import type { Client } from 'pg';
import { connectTestDb, uniqueEmail, TEST_PASSWORD } from './setup/db';
import { HttpClient, cookieAttributes } from './setup/http';
import { createUser } from '../../src/server/users/repository';
import type { PublicUser } from '../../src/server/users/dto';

/** `next start` runs in production mode, so the __Host- prefix is in force. */
const SESSION_COOKIE = '__Host-dental_hub_session';

function client() {
  return new HttpClient(inject('baseUrl'));
}

async function signIn(email: string, password = TEST_PASSWORD) {
  const http = client();
  const response = await http.submitForm('/login', { email, password });
  return { http, response };
}

describe('HTTP acceptance', () => {
  let db: Client;
  let admin: PublicUser;
  let manager: PublicUser;
  let rep: PublicUser;
  let inactive: PublicUser;

  beforeAll(async () => {
    db = await connectTestDb();

    admin = await createUser(db, {
      displayName: 'Http Admin',
      email: uniqueEmail('http.admin'),
      password: TEST_PASSWORD,
      role: 'ADMIN',
    });
    manager = await createUser(db, {
      displayName: 'Http Manager',
      email: uniqueEmail('http.manager'),
      password: TEST_PASSWORD,
      role: 'SALES_MANAGER',
    });
    rep = await createUser(db, {
      displayName: 'Http Rep',
      email: uniqueEmail('http.rep'),
      password: TEST_PASSWORD,
      role: 'SALES_REP',
    });
    inactive = await createUser(db, {
      displayName: 'Http Inactive',
      email: uniqueEmail('http.inactive'),
      password: TEST_PASSWORD,
      role: 'SALES_REP',
      isActive: false,
    });
  });

  afterAll(async () => {
    await db.end();
  });

  describe('unauthenticated access', () => {
    it('refuses /crm and redirects to the login page', async () => {
      const response = await client().get('/crm');

      expect(response.status).toBe(307);
      expect(response.location).toContain('/login');
      expect(response.body).not.toContain('Http Admin');
    });

    it('refuses user administration', async () => {
      const response = await client().get('/crm/settings/users');

      expect(response.status).toBe(307);
      expect(response.location).toContain('/login');
    });

    it('serves the login page', async () => {
      const response = await client().get('/login');

      expect(response.status).toBe(200);
      expect(response.body).toContain('Dental Hub CRM');
      expect(response.body).toContain('src="/brand/dental-hub-logo.png"');
    });

    it('serves the brand artwork without a session, so the login page shows the logo', async () => {
      for (const path of ['/brand/dental-hub-logo.png', '/brand/dental-hub-mark.png']) {
        const response = await client().get(path);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
      }
    });
  });

  describe('login', () => {
    it('rejects a wrong password and issues no session', async () => {
      const { http, response } = await signIn(admin.email, 'definitely-not-the-password');

      expect(response.setCookie.some((c) => c.startsWith(SESSION_COOKIE))).toBe(false);
      expect(http.cookie(SESSION_COOKIE)).toBeUndefined();
      expect(response.body).toContain('Invalid email or password.');
    });

    it('rejects an unknown email and issues no session', async () => {
      const { http, response } = await signIn('nobody.here@dentalhub.test');

      expect(response.setCookie.some((c) => c.startsWith(SESSION_COOKIE))).toBe(false);
      expect(http.cookie(SESSION_COOKIE)).toBeUndefined();
      expect(response.body).toContain('Invalid email or password.');
    });

    it('rejects a deactivated user even with the correct password', async () => {
      const { http, response } = await signIn(inactive.email);

      expect(response.setCookie.some((c) => c.startsWith(SESSION_COOKIE))).toBe(false);
      expect(http.cookie(SESSION_COOKIE)).toBeUndefined();
      expect(response.body).toContain('Invalid email or password.');

      // And no session row was created for them.
      const { rows } = await db.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM crm_session WHERE user_id = $1',
        [inactive.id],
      );
      expect(rows[0].count).toBe('0');
    });

    it('does not reveal which part of the credentials was wrong', async () => {
      const unknown = await signIn('no.such.person@dentalhub.test');
      const wrongPassword = await signIn(admin.email, 'wrong-password');
      const deactivated = await signIn(inactive.email);

      const message = 'Invalid email or password.';
      expect(unknown.response.body).toContain(message);
      expect(wrongPassword.response.body).toContain(message);
      expect(deactivated.response.body).toContain(message);
    });

    it('issues a hardened session cookie on success', async () => {
      const { response } = await signIn(admin.email);

      expect(response.status).toBe(303);
      expect(response.location).toBe('/crm');

      const raw = response.setCookie.find((c) => c.startsWith(SESSION_COOKIE));
      expect(raw).toBeDefined();

      const cookie = cookieAttributes(raw as string);
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.sameSite?.toLowerCase()).toBe('lax');
      expect(cookie.secure).toBe(true); // production build
      expect(cookie.path).toBe('/');

      // The cookie carries an opaque token and nothing about the user.
      expect(cookie.value).not.toContain(admin.id);
      expect(cookie.value).not.toContain(admin.email);
      expect(cookie.value).not.toContain('ADMIN');
      expect(Buffer.from(cookie.value, 'base64url')).toHaveLength(32);
    });

    it('stores only a hash of the issued token', async () => {
      const { response } = await signIn(rep.email);
      const raw = response.setCookie.find((c) => c.startsWith(SESSION_COOKIE)) as string;
      const cookie = cookieAttributes(raw);

      const { rows } = await db.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM crm_session WHERE token_hash = sha256($1::bytea)',
        [Buffer.from(cookie.value, 'utf8')],
      );
      expect(rows[0].count).toBe('1');
    });
  });

  describe('authenticated access', () => {
    it('serves /crm to a signed-in user', async () => {
      const { http } = await signIn(rep.email);
      const response = await http.get('/crm');

      expect(response.status).toBe(200);
      expect(response.body).toContain('Http Rep');
    });

    it('lets an ADMIN reach user administration', async () => {
      const { http } = await signIn(admin.email);
      const response = await http.get('/crm/settings/users');

      expect(response.status).toBe(200);
      expect(response.body).toContain('Add a user');
    });

    it('refuses user administration to SALES_MANAGER', async () => {
      const { http } = await signIn(manager.email);
      const response = await http.get('/crm/settings/users');

      expect(response.status).toBe(307);
      expect(response.location).toContain('/crm/forbidden');
    });

    it('refuses user administration to SALES_REP', async () => {
      const { http } = await signIn(rep.email);
      const response = await http.get('/crm/settings/users');

      expect(response.status).toBe(307);
      expect(response.location).toContain('/crm/forbidden');
    });

    it('lets a SALES_MANAGER keep the product catalogue', async () => {
      const { http } = await signIn(manager.email);
      const response = await http.get('/crm/settings/products');

      expect(response.status).toBe(200);
      expect(response.body).toContain('Add a product');
    });

    it('refuses the product catalogue to SALES_REP', async () => {
      const { http } = await signIn(rep.email);
      const response = await http.get('/crm/settings/products');

      expect(response.status).toBe(307);
      expect(response.location).toContain('/crm/forbidden');
      expect((await http.get('/crm')).body).not.toContain('href="/crm/settings/products"');
    });

    it('does not leak the user directory to a non-admin', async () => {
      const { http } = await signIn(rep.email);
      const response = await http.get('/crm');

      expect(response.body).not.toContain(admin.email);
      expect(response.body).not.toContain('Http Manager');
    });
  });

  describe('logout and revocation', () => {
    it('revokes the session and rejects a replayed cookie', async () => {
      const { http } = await signIn(manager.email);
      const captured = http.cookie(SESSION_COOKIE);
      expect(captured).toBeDefined();

      expect((await http.get('/crm')).status).toBe(200);

      // The sign-out control is a real form in the shell.
      const logout = await http.submitForm('/crm', {});
      expect(logout.status).toBe(303);
      expect(logout.location).toBe('/login');

      // The session row is revoked server-side, not merely forgotten.
      const { rows } = await db.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM crm_session ' +
          'WHERE token_hash = sha256($1::bytea) AND revoked_at IS NOT NULL',
        [Buffer.from(captured as string, 'utf8')],
      );
      expect(rows[0].count).toBe('1');

      // Replaying the captured cookie gets nothing.
      const replay = client();
      replay.setCookieManually(SESSION_COOKIE, captured as string);
      const afterLogout = await replay.get('/crm');
      expect(afterLogout.status).toBe(307);
      expect(afterLogout.location).toContain('/login');
    });

    it('rejects a session revoked directly in the database', async () => {
      const { http } = await signIn(rep.email);
      const token = http.cookie(SESSION_COOKIE) as string;
      expect((await http.get('/crm')).status).toBe(200);

      await db.query(
        'UPDATE crm_session SET revoked_at = now() WHERE token_hash = sha256($1::bytea)',
        [Buffer.from(token, 'utf8')],
      );

      const response = await http.get('/crm');
      expect(response.status).toBe(307);
      expect(response.location).toContain('/login');
    });

    it('rejects an expired session', async () => {
      const { http } = await signIn(rep.email);
      const token = http.cookie(SESSION_COOKIE) as string;

      // A session legitimately issued in the past that has since lapsed:
      // created_at < expires_at < now(), so the database invariant still holds.
      await db.query(
        `UPDATE crm_session
            SET created_at = now() - interval '2 hours',
                expires_at = now() - interval '1 hour'
          WHERE token_hash = sha256($1::bytea)`,
        [Buffer.from(token, 'utf8')],
      );

      const response = await http.get('/crm');
      expect(response.status).toBe(307);
      expect(response.location).toContain('/login');
    });

    it('stops a live session the moment the user is deactivated', async () => {
      const victim = await createUser(db, {
        displayName: 'Http Soon Inactive',
        email: uniqueEmail('http.soon'),
        password: TEST_PASSWORD,
        role: 'SALES_REP',
      });

      const { http } = await signIn(victim.email);
      expect((await http.get('/crm')).status).toBe(200);

      await db.query('UPDATE crm_user SET is_active = false WHERE id = $1', [victim.id]);

      const response = await http.get('/crm');
      expect(response.status).toBe(307);
      expect(response.location).toContain('/login');
    });
  });

  describe('secret exposure over HTTP', () => {
    const FORBIDDEN = [
      '$argon2',
      'password_hash',
      'passwordHash',
      'token_hash',
      'tokenHash',
      'postgresql://',
      TEST_PASSWORD,
    ];

    function assertClean(label: string, body: string) {
      for (const needle of FORBIDDEN) {
        expect(body, label + ' leaked ' + needle).not.toContain(needle);
      }
    }

    it('never returns a password hash or connection string in any HTML response', async () => {
      const { http } = await signIn(admin.email);

      for (const path of ['/crm', '/crm/settings/users', '/crm/forbidden']) {
        assertClean('HTML ' + path, (await http.get(path)).body);
      }
      assertClean('HTML /login', (await client().get('/login')).body);
    });

    it('never returns a password hash in the RSC payload', async () => {
      const { http } = await signIn(admin.email);

      for (const path of ['/crm', '/crm/settings/users']) {
        assertClean('RSC ' + path, (await http.rsc(path)).body);
      }
    });

    it('never returns the session token in a response body', async () => {
      const { http } = await signIn(admin.email);
      const token = http.cookie(SESSION_COOKIE) as string;

      for (const path of ['/crm', '/crm/settings/users']) {
        expect((await http.get(path)).body).not.toContain(token);
        expect((await http.rsc(path)).body).not.toContain(token);
      }
    });

    it('exposes no database credentials through the health endpoint', async () => {
      const response = await client().get('/api/health');

      expect(response.status).toBe(200);
      const payload = JSON.parse(response.body) as {
        status: string;
        checks: { database: { connected: boolean; migrationsApplied: number } };
      };

      expect(payload.status).toBe('ok');
      expect(payload.checks.database.connected).toBe(true);
      expect(payload.checks.database.migrationsApplied).toBeGreaterThan(0);
      assertClean('health', response.body);
    });

    it('carries no All In Studio or M1 vocabulary in the product shell', async () => {
      const { http } = await signIn(admin.email);
      const shell = (await http.get('/crm')).body;
      const login = (await client().get('/login')).body;

      for (const banned of ['All In Studio', 'Governed Front Door', 'Sample Clinic Account']) {
        expect(shell + login).not.toContain(banned);
      }
    });
  });
});
