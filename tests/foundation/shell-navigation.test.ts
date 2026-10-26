import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import type { Client } from 'pg';
import { connectTestDb, uniqueEmail, TEST_PASSWORD } from './setup/db';
import { HttpClient } from './setup/http';
import { createUser } from '../../src/server/users/repository';
import type { PublicUser } from '../../src/server/users/dto';

/**
 * The navigation of the CRM shell.
 *
 * The shell is the only way into the product below the desktop breakpoint, so
 * the navigation and the sign-out control must be in the rendered document at
 * every width, and exactly one entry may claim to be the current page.
 */

interface ShellLink {
  href: string;
  current: boolean;
}

/** The links of a rendered document, with the accessibility state of each. */
function links(body: string): ShellLink[] {
  return [...body.matchAll(/<a\b([^>]*)>/g)].map((match) => {
    const attributes = match[1];
    return {
      href: /href="([^"]*)"/.exec(attributes)?.[1] ?? '',
      current: /aria-current="page"/.test(attributes),
    };
  });
}

function currentLinks(body: string): ShellLink[] {
  return links(body).filter((link) => link.current);
}

describe('shell navigation', () => {
  let db: Client;
  let admin: PublicUser;

  beforeAll(async () => {
    db = await connectTestDb();

    admin = await createUser(db, {
      displayName: 'Shell Admin',
      email: uniqueEmail('shell.admin'),
      password: TEST_PASSWORD,
      role: 'ADMIN',
    });
  });

  afterAll(async () => {
    await db.end();
  });

  async function signedIn(): Promise<HttpClient> {
    const http = new HttpClient(inject('baseUrl'));
    const response = await http.submitForm('/login', {
      email: admin.email,
      password: TEST_PASSWORD,
    });
    expect(response.status).toBe(303);
    return http;
  }

  it('opens the navigation on narrow screens from a header menu button', async () => {
    const http = await signedIn();
    const body = (await http.get('/crm')).body;

    expect(body).toContain('aria-label="Open navigation menu"');
    expect(body).toContain('aria-expanded="false"');
    expect(body).toContain('aria-controls="mobile-nav-drawer"');
  });

  it('renders every destination the role may reach', async () => {
    const http = await signedIn();
    const hrefs = links((await http.get('/crm')).body).map((link) => link.href);

    expect(hrefs).toContain('/crm');
    expect(hrefs).toContain('/crm/leads');
    expect(hrefs).toContain('/crm/opportunities');
    expect(hrefs).toContain('/crm/followups');
    expect(hrefs).toContain('/crm/pipeline');
    expect(hrefs).toContain('/crm/settings/users');
    expect(hrefs).toContain('/crm/settings/products');
  });

  it('keeps the sign-out control in the document', async () => {
    const http = await signedIn();
    const body = (await http.get('/crm')).body;

    expect(body).toContain('Sign out');
  });

  it('serves no mock-data preview pages', async () => {
    const http = await signedIn();

    for (const path of ['/crm/ui-preview', '/crm/ui-preview/leads', '/crm/ui-preview/pipeline']) {
      expect((await http.get(path)).status).toBe(404);
    }
  });

  it('marks exactly the current page', async () => {
    const http = await signedIn();

    const home = currentLinks((await http.get('/crm')).body);
    expect(home).toHaveLength(1);
    expect(home[0].href).toBe('/crm');

    // A page below the CRM root does not leave Home looking current.
    const users = currentLinks((await http.get('/crm/settings/users')).body);
    expect(users).toHaveLength(1);
    expect(users[0].href).toBe('/crm/settings/users');
  });
});
