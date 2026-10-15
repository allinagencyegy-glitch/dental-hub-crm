import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';
import { createUser } from '../../src/server/users/repository';
import { createContact } from '../../src/server/crm/contacts/repository';
import { createAccount, listAccounts } from '../../src/server/crm/accounts/repository';
import { createLead, findLeadById } from '../../src/server/crm/leads/repository';
import { linkLeadToAccountUseCase } from '../../src/server/crm/leads/service';
import { uniqueToken } from './setup/db';

/**
 * Account / clinic linking workflow (Phase 5).
 *
 * The contact <-> account relationship stays many-to-many (crm_account_contact);
 * the lead's account_id is the clinic this inquiry is tracked against.
 */
describe('lead account / clinic linking', () => {
  let database: DisposableDatabase;
  let client: Client;

  let repAId: string;
  let repBId: string;
  let sourceId: string;

  const repA = { userId: '', role: 'SALES_REP' as const };
  const repB = { userId: '', role: 'SALES_REP' as const };

  async function newLead(ownerUserId: string) {
    const contact = await createContact(client, {
      fullName: uniqueToken('doc'),
      email: uniqueToken('doc') + '@test.com',
    });
    const lead = await createLead(client, {
      sourceId,
      campaignId: null,
      contactId: contact.id,
      accountId: null,
      productCategoryId: null,
      note: null,
      ownerUserId,
    });
    return { lead, contactId: contact.id };
  }

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);

    repAId = (
      await createUser(client, {
        displayName: 'Link Rep Alpha',
        email: uniqueToken('link-a') + '@test.com',
        password: 'Password123!',
        role: 'SALES_REP',
      })
    ).id;
    repBId = (
      await createUser(client, {
        displayName: 'Link Rep Bravo',
        email: uniqueToken('link-b') + '@test.com',
        password: 'Password123!',
        role: 'SALES_REP',
      })
    ).id;
    repA.userId = repAId;
    repB.userId = repBId;

    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM crm_source WHERE code = 'website'`,
    );
    sourceId = rows[0].id;
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  it('links a lead to an existing clinic and records the contact link', async () => {
    const { lead, contactId } = await newLead(repAId);
    const clinic = await createAccount(client, { name: 'Cairo Dental Center' });

    const result = await linkLeadToAccountUseCase(repA, lead.id, { accountId: clinic.id }, client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const updated = await findLeadById(client, lead.id, repA);
    expect(updated?.accountId).toBe(clinic.id);

    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM crm_account_contact WHERE account_id = $1 AND contact_id = $2`,
      [clinic.id, contactId],
    );
    expect(rows[0].count).toBe('1');
  });

  it('creates a new clinic when given a name and links the lead to it', async () => {
    const { lead, contactId } = await newLead(repAId);

    const result = await linkLeadToAccountUseCase(repA, lead.id, { newAccountName: '  Sunrise Dental Clinic  ' }, client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const updated = await findLeadById(client, lead.id, repA);
    expect(updated?.accountId).toBe(result.account.id);

    const accounts = await listAccounts(client, { search: 'Sunrise' });
    expect(accounts.map((a) => a.name)).toContain('Sunrise Dental Clinic');

    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM crm_account_contact WHERE account_id = $1 AND contact_id = $2`,
      [result.account.id, contactId],
    );
    expect(rows[0].count).toBe('1');
  });

  it('is idempotent: linking the same clinic twice does not duplicate the contact link', async () => {
    const { lead, contactId } = await newLead(repAId);
    const clinic = await createAccount(client, { name: 'Repeat Link Clinic' });

    const first = await linkLeadToAccountUseCase(repA, lead.id, { accountId: clinic.id }, client);
    const second = await linkLeadToAccountUseCase(repA, lead.id, { accountId: clinic.id }, client);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM crm_account_contact WHERE account_id = $1 AND contact_id = $2`,
      [clinic.id, contactId],
    );
    expect(rows[0].count).toBe('1');
  });

  it('stops a rep from linking a lead they do not own', async () => {
    const { lead } = await newLead(repAId);
    const clinic = await createAccount(client, { name: 'Someone Else Clinic' });

    const result = await linkLeadToAccountUseCase(repB, lead.id, { accountId: clinic.id }, client);
    // Row scope reads absence, not a permission error.
    expect(result).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('rejects a request with neither an account nor a name', async () => {
    const { lead } = await newLead(repAId);
    const result = await linkLeadToAccountUseCase(repA, lead.id, {}, client);
    expect(result).toMatchObject({ ok: false, error: 'VALIDATION' });
  });

  it('rejects an account that does not exist', async () => {
    const { lead } = await newLead(repAId);
    const result = await linkLeadToAccountUseCase(
      repA,
      lead.id,
      { accountId: '00000000-0000-0000-0000-000000000000' },
      client,
    );
    expect(result).toMatchObject({ ok: false, error: 'ACCOUNT_NOT_FOUND' });
  });
});
