import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import type { Client } from 'pg';
import { connectTestDb, uniqueEmail, TEST_PASSWORD } from './setup/db';
import { HttpClient, parseHiddenFields, type HttpResponse } from './setup/http';
import { changeUserPassword, createUser, findUserById } from '../../src/server/users/repository';
import { createSession, resolveSession } from '../../src/server/auth/session';
import { verifyPassword } from '../../src/server/auth/password';
import type { PublicUser } from '../../src/server/users/dto';

const SESSION_COOKIE = '__Host-dental_hub_session';
const PASSWORD_PATH = '/crm/settings/password';
const NEW_PASSWORD = 'BrandNewSecret!2026';

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

/**
 * Posts only the change-password form. The page also renders the shell's
 * sign-out form, and posting both sets of hidden fields would sign out instead.
 */
async function submitPasswordForm(
  http: HttpClient,
  values: { currentPassword: string; newPassword: string; confirmPassword?: string },
  options: { forgeSession?: boolean } = {},
): Promise<HttpResponse> {
  const page = await http.get(PASSWORD_PATH);
  expect(page.status).toBe(200);

  const form = [...page.body.matchAll(/<form\b[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((html) => html.includes('name="currentPassword"'));
  if (!form) throw new Error('The change-password form was not rendered.');

  const body = new FormData();
  for (const [name, value] of Object.entries(parseHiddenFields(form))) body.set(name, value);
  body.set('currentPassword', values.currentPassword);
  body.set('newPassword', values.newPassword);
  body.set('confirmPassword', values.confirmPassword ?? values.newPassword);

  // A cookie that resolves to no session gets past Proxy (which only checks the
  // cookie is present), so the request reaches the action's own check.
  if (options.forgeSession) http.setCookieManually(SESSION_COOKIE, 'not-a-real-session-token');
  return http.request(PASSWORD_PATH, { method: 'POST', body });
}

async function passwordHash(db: Client, userId: string): Promise<string> {
  const user = await findUserById(db, userId);
  return user!.password_hash;
}

describe('change password (repository)', () => {
  let db: Client;

  beforeAll(async () => {
    db = await connectTestDb();
  });

  afterAll(async () => {
    await db.end();
  });

  it('replaces the hash and revokes every other live session', async () => {
    const user = await createUser(db, {
      displayName: 'Repo Password',
      email: uniqueEmail('password.repo'),
      password: TEST_PASSWORD,
      role: 'SALES_REP',
    });
    const kept = await createSession(db, user.id);
    const other = await createSession(db, user.id);

    const result = await changeUserPassword(db, user.id, NEW_PASSWORD, kept.sessionId);

    expect(result.revokedSessions).toBe(1);
    expect(await resolveSession(db, kept.token)).not.toBeNull();
    expect(await resolveSession(db, other.token)).toBeNull();

    const hash = await passwordHash(db, user.id);
    expect(await verifyPassword(hash, NEW_PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, TEST_PASSWORD)).toBe(false);
  });

  it("leaves other users' sessions alone", async () => {
    const [changer, bystander] = await Promise.all(
      ['password.changer', 'password.bystander'].map((prefix) =>
        createUser(db, {
          displayName: prefix,
          email: uniqueEmail(prefix),
          password: TEST_PASSWORD,
          role: 'SALES_REP',
        }),
      ),
    );
    const kept = await createSession(db, changer.id);
    const bystanderSession = await createSession(db, bystander.id);

    await changeUserPassword(db, changer.id, NEW_PASSWORD, kept.sessionId);

    expect(await resolveSession(db, bystanderSession.token)).not.toBeNull();
  });

  it('refuses an unknown user', async () => {
    await expect(
      changeUserPassword(db, '00000000-0000-4000-8000-000000000000', NEW_PASSWORD, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow('User not found.');
  });
});

describe('change password (HTTP)', () => {
  let db: Client;
  let rep: PublicUser;

  beforeAll(async () => {
    db = await connectTestDb();
  });

  afterAll(async () => {
    await db.end();
  });

  async function freshRep(prefix: string): Promise<PublicUser> {
    return createUser(db, {
      displayName: 'Password Rep',
      email: uniqueEmail(prefix),
      password: TEST_PASSWORD,
      role: 'SALES_REP',
    });
  }

  it('sends a visitor with no session to the login page', async () => {
    const response = await new HttpClient(inject('baseUrl')).get(PASSWORD_PATH);

    expect(response.status).toBe(307);
    expect(response.location).toContain('/login');
  });

  it('is linked from the shell for every role, not only admins', async () => {
    rep = await freshRep('password.nav');
    const http = await signedIn(rep.email);

    const body = (await http.get('/crm')).body;
    expect(body).toContain(`href="${PASSWORD_PATH}"`);
    expect(body).not.toContain('href="/crm/settings/users"');
  });

  it('changes the password, keeps this session, and ends every other one', async () => {
    rep = await freshRep('password.change');
    const http = await signedIn(rep.email);
    const elsewhere = await signedIn(rep.email);

    const response = await submitPasswordForm(http, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain('Password changed.');

    // The session that made the change is still signed in...
    expect((await http.get('/crm')).status).toBe(200);
    // ...and the one on the other device is not.
    const other = await elsewhere.get('/crm');
    expect(other.status).toBe(307);
    expect(other.location).toContain('/login');

    // Only the new password signs in now.
    expect((await signIn(rep.email)).response.body).toContain('Invalid email or password.');
    expect((await signIn(rep.email, NEW_PASSWORD)).response.status).toBe(303);
  });

  it('refuses a wrong current password and changes nothing', async () => {
    rep = await freshRep('password.wrong');
    const http = await signedIn(rep.email);
    const elsewhere = await signedIn(rep.email);
    const before = await passwordHash(db, rep.id);

    const response = await submitPasswordForm(http, {
      currentPassword: 'not-my-password',
      newPassword: NEW_PASSWORD,
    });

    expect(response.body).toContain('Your current password is incorrect.');
    expect(await passwordHash(db, rep.id)).toBe(before);
    expect((await elsewhere.get('/crm')).status).toBe(200);
  });

  it.each([
    {
      name: 'a new password shorter than 12 characters',
      values: { currentPassword: TEST_PASSWORD, newPassword: 'short1!' },
      message: 'New password must be at least 12 characters.',
    },
    {
      name: 'a confirmation that does not match',
      values: { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: `${NEW_PASSWORD}x` },
      message: 'The new passwords do not match.',
    },
    {
      name: 'a new password equal to the current one',
      values: { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD },
      message: 'The new password must be different from the current one.',
    },
  ])('refuses $name', async ({ values, message }) => {
    rep = await freshRep('password.invalid');
    const http = await signedIn(rep.email);
    const before = await passwordHash(db, rep.id);

    const response = await submitPasswordForm(http, values);

    expect(response.body).toContain(message);
    expect(await passwordHash(db, rep.id)).toBe(before);
  });

  it('refuses the action itself when it is called without a valid session', async () => {
    rep = await freshRep('password.nosession');
    const http = await signedIn(rep.email);
    const before = await passwordHash(db, rep.id);

    const response = await submitPasswordForm(
      http,
      { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD },
      { forgeSession: true },
    );

    // assertPermission throws "Not authenticated." before anything is read.
    expect(response.status).toBe(500);
    expect(response.body).not.toContain('Password changed.');
    expect(await passwordHash(db, rep.id)).toBe(before);
    expect(response.setCookie.some((c) => c.startsWith(SESSION_COOKIE))).toBe(false);
  });
});
