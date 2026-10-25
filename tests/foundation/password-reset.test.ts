import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import type { Client } from 'pg';
import { connectTestDb, uniqueEmail, TEST_PASSWORD } from './setup/db';
import { HttpClient, parseHiddenFields, type HttpResponse } from './setup/http';
import { createUser, findUserById, resetUserPassword } from '../../src/server/users/repository';
import { createSession, resolveSession } from '../../src/server/auth/session';
import { verifyPassword } from '../../src/server/auth/password';
import { LOGIN_MAX_ATTEMPTS, reserveLoginAttempt } from '../../src/server/auth/login-throttle';
import type { Role } from '../../src/server/authz/permissions';
import type { PublicUser } from '../../src/server/users/dto';

const USERS_PATH = '/crm/settings/users';
const NEW_PASSWORD = 'ResetByAdmin!2026';

async function signIn(email: string, password = TEST_PASSWORD) {
  const http = new HttpClient(inject('baseUrl'));
  const response = await http.submitForm('/login', { email, password });
  return { http, response };
}

async function signedIn(email: string, password = TEST_PASSWORD): Promise<HttpClient> {
  const { http, response } = await signIn(email, password);
  expect(response.status).toBe(303);
  return http;
}

/** The hidden fields of the reset-password form on `target`'s row of the users page. */
async function resetFormFields(admin: HttpClient, target: PublicUser): Promise<Record<string, string>> {
  const page = await admin.get(USERS_PATH);
  expect(page.status).toBe(200);

  const form = [...page.body.matchAll(/<form\b[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((html) => html.includes('name="newPassword"') && html.includes(`value="${target.id}"`));
  if (!form) throw new Error(`No reset-password form was rendered for ${target.email}.`);
  return parseHiddenFields(form);
}

async function postReset(
  http: HttpClient,
  fields: Record<string, string>,
  values: { userId?: string; newPassword: string },
): Promise<HttpResponse> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  if (values.userId) body.set('userId', values.userId);
  body.set('newPassword', values.newPassword);
  return http.request(USERS_PATH, { method: 'POST', body });
}

describe('admin password reset', () => {
  let db: Client;

  beforeAll(async () => {
    db = await connectTestDb();
  });

  afterAll(async () => {
    await db.end();
  });

  function makeUser(prefix: string, role: Role): Promise<PublicUser> {
    return createUser(db, {
      displayName: `Reset ${prefix}`,
      email: uniqueEmail(`reset.${prefix}`),
      password: TEST_PASSWORD,
      role,
    });
  }

  async function passwordHash(userId: string): Promise<string> {
    return (await findUserById(db, userId))!.password_hash;
  }

  describe('repository', () => {
    it('replaces the hash and revokes every session the user holds', async () => {
      const user = await makeUser('repo', 'SALES_REP');
      const sessions = await Promise.all([createSession(db, user.id), createSession(db, user.id)]);

      await resetUserPassword(db, user.id, NEW_PASSWORD);

      for (const session of sessions) {
        expect(await resolveSession(db, session.token)).toBeNull();
      }
      const hash = await passwordHash(user.id);
      expect(await verifyPassword(hash, NEW_PASSWORD)).toBe(true);
      expect(await verifyPassword(hash, TEST_PASSWORD)).toBe(false);
    });

    it("leaves other users' sessions alone", async () => {
      const [target, bystander] = await Promise.all([
        makeUser('target', 'SALES_REP'),
        makeUser('bystander', 'SALES_REP'),
      ]);
      const bystanderSession = await createSession(db, bystander.id);

      await resetUserPassword(db, target.id, NEW_PASSWORD);

      expect(await resolveSession(db, bystanderSession.token)).not.toBeNull();
    });

    it('clears the sign-in throttle, so a locked-out user can sign in straight away', async () => {
      const user = await makeUser('throttled', 'SALES_REP');
      for (let i = 0; i <= LOGIN_MAX_ATTEMPTS; i++) await reserveLoginAttempt(db, user.email);
      expect((await reserveLoginAttempt(db, user.email)).allowed).toBe(false);

      await resetUserPassword(db, user.id, NEW_PASSWORD);

      expect((await reserveLoginAttempt(db, user.email)).allowed).toBe(true);
    });

    it('refuses an unknown user', async () => {
      await expect(
        resetUserPassword(db, '00000000-0000-4000-8000-000000000000', NEW_PASSWORD),
      ).rejects.toThrow('User not found.');
    });
  });

  describe('HTTP', () => {
    it('lets an admin set a new password that works at once and ends the old sessions', async () => {
      const admin = await makeUser('admin', 'ADMIN');
      const rep = await makeUser('rep', 'SALES_REP');
      const adminHttp = await signedIn(admin.email);
      const repHttp = await signedIn(rep.email);

      const response = await postReset(adminHttp, await resetFormFields(adminHttp, rep), {
        newPassword: NEW_PASSWORD,
      });

      expect(response.status).toBe(200);
      expect(response.body).toContain(`New password set for ${rep.displayName}.`);

      // The rep's existing session is gone...
      const after = await repHttp.get('/crm');
      expect(after.status).toBe(307);
      expect(after.location).toContain('/login');
      // ...only the new password signs in, and the admin is still signed in.
      expect((await signIn(rep.email)).response.body).toContain('Invalid email or password.');
      expect((await signIn(rep.email, NEW_PASSWORD)).response.status).toBe(303);
      expect((await adminHttp.get('/crm')).status).toBe(200);
    });

    it('offers no reset form on your own row, and the action refuses your own id', async () => {
      const admin = await makeUser('self', 'ADMIN');
      const other = await makeUser('self.other', 'SALES_REP');
      const http = await signedIn(admin.email);

      await expect(resetFormFields(http, admin)).rejects.toThrow('No reset-password form');

      const before = await passwordHash(admin.id);
      const response = await postReset(http, await resetFormFields(http, other), {
        userId: admin.id,
        newPassword: NEW_PASSWORD,
      });

      expect(response.body).toContain('Change your own password from Settings');
      expect(await passwordHash(admin.id)).toBe(before);
    });

    it('refuses a password shorter than 12 characters', async () => {
      const admin = await makeUser('short', 'ADMIN');
      const rep = await makeUser('short.rep', 'SALES_REP');
      const http = await signedIn(admin.email);
      const before = await passwordHash(rep.id);

      const response = await postReset(http, await resetFormFields(http, rep), {
        newPassword: 'short1!',
      });

      expect(response.body).toContain('Password must be at least 12 characters.');
      expect(await passwordHash(rep.id)).toBe(before);
    });

    it.each(['SALES_MANAGER', 'SALES_REP'] as const)(
      'refuses the action for a %s',
      async (role) => {
        const admin = await makeUser(`deny.admin.${role}`, 'ADMIN');
        const target = await makeUser(`deny.target.${role}`, 'SALES_REP');
        const caller = await makeUser(`deny.caller.${role}`, role);
        const fields = await resetFormFields(await signedIn(admin.email), target);
        const before = await passwordHash(target.id);

        // The action reference is the same for everyone; only the session differs.
        const response = await postReset(await signedIn(caller.email), fields, {
          newPassword: NEW_PASSWORD,
        });

        // assertPermission throws "Not authorised." before anything is written.
        expect(response.status).toBe(500);
        expect(response.body).not.toContain('New password set');
        expect(await passwordHash(target.id)).toBe(before);
      },
    );
  });
});
