import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';
import { createUser } from '../../src/server/users/repository';
import { createContact, addPhoneChannel } from '../../src/server/crm/contacts/repository';
import { createAccount } from '../../src/server/crm/accounts/repository';
import { createProductCategory, createSourceCampaign } from '../../src/server/crm/catalog/repository';
import { createLead, listLeads } from '../../src/server/crm/leads/repository';
import { uniqueToken } from './setup/db';

/**
 * Lead text search (Phase 2).
 *
 * The search term must match the available CRM fields literally and
 * case-insensitively; a term with no matches returns zero rows. Row scope
 * still applies to search results.
 */
describe('lead search', () => {
  let database: DisposableDatabase;
  let client: Client;

  let repAId: string;
  let repBId: string;
  let managerId: string;

  let sourceId: string;
  let campaignId: string;
  let categoryId: string;
  let accountId: string;

  let contactId: string;

  const manager = { userId: '', role: 'SALES_MANAGER' as const };
  const repA = { userId: '', role: 'SALES_REP' as const };
  const repB = { userId: '', role: 'SALES_REP' as const };

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);

    repAId = (
      await createUser(client, {
        displayName: 'Search Rep Alpha',
        email: uniqueToken('search-a') + '@test.com',
        password: 'Password123!',
        role: 'SALES_REP',
      })
    ).id;
    repBId = (
      await createUser(client, {
        displayName: 'Search Rep Bravo',
        email: uniqueToken('search-b') + '@test.com',
        password: 'Password123!',
        role: 'SALES_REP',
      })
    ).id;
    managerId = (
      await createUser(client, {
        displayName: 'Search Manager',
        email: uniqueToken('search-m') + '@test.com',
        password: 'Password123!',
        role: 'SALES_MANAGER',
      })
    ).id;
    manager.userId = managerId;
    repA.userId = repAId;
    repB.userId = repBId;

    const { rows: sourceRows } = await client.query<{ id: string }>(
      `SELECT id FROM crm_source WHERE code = 'facebook'`,
    );
    sourceId = sourceRows[0].id;
    campaignId = (await createSourceCampaign(client, { sourceId, code: uniqueToken('camp'), name: 'Ramadan Implant Offer' })).id;
    categoryId = (await createProductCategory(client, { code: uniqueToken('cat'), name: 'Implants' })).id;
    accountId = (await createAccount(client, { name: 'Nile Smile Clinic' })).id;

    contactId = (await createContact(client, { fullName: 'Dr. Nour El Din' })).id;
    await addPhoneChannel(client, { contactId, phone: '01012345678' });

    // Rep A's lead, fully populated.
    await createLead(client, {
      sourceId,
      campaignId,
      contactId,
      accountId,
      productCategoryId: categoryId,
      note: null,
      ownerUserId: repAId,
    });

    // Rep B's lead: a different contact, no account, no campaign.
    const otherContact = await createContact(client, { fullName: 'Dr. Layla Hassan' });
    await addPhoneChannel(client, { contactId: otherContact.id, phone: '01198765432' });
    await createLead(client, {
      sourceId,
      campaignId: null,
      contactId: otherContact.id,
      accountId: null,
      productCategoryId: null,
      note: null,
      ownerUserId: repBId,
    });
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  async function search(
    actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
    term: string,
  ) {
    const result = await listLeads(client, actor, { search: term, archiveFilter: 'all' });
    return result;
  }

  it('matches the contact name, case-insensitively and partially', async () => {
    const byName = await search(manager, 'nour el');
    expect(byName.leads.map((l) => l.contactName)).toContain('Dr. Nour El Din');
    expect(byName.total).toBeGreaterThanOrEqual(1);
  });

  it('matches a phone number substring of the stored E.164 value', async () => {
    const byPhone = await search(manager, '0123456');
    expect(byPhone.leads.map((l) => l.contactId)).toContain(contactId);
  });

  it('matches the account / clinic name', async () => {
    const byAccount = await search(manager, 'nile smile');
    expect(byAccount.leads.map((l) => l.accountName)).toContain('Nile Smile Clinic');
  });

  it('matches the source name', async () => {
    const bySource = await search(manager, 'facebook');
    expect(bySource.total).toBeGreaterThanOrEqual(2);
  });

  it('matches the campaign name', async () => {
    const byCampaign = await search(manager, 'ramadan implant');
    expect(byCampaign.leads.length).toBeGreaterThanOrEqual(1);
    expect(byCampaign.leads.every((l) => l.campaignId === campaignId)).toBe(true);
  });

  it('matches the product category name', async () => {
    const byCategory = await search(manager, 'implants');
    expect(byCategory.leads.length).toBeGreaterThanOrEqual(1);
  });

  it('matches the owner display name', async () => {
    const byOwner = await search(manager, 'rep bravo');
    expect(byOwner.leads.every((l) => l.ownerUserId === repBId)).toBe(true);
  });

  it('matches the lead reference id prefix', async () => {
    const all = await listLeads(client, manager, { archiveFilter: 'all', limit: 1 });
    const reference = all.leads[0].id.slice(0, 8);
    const byReference = await search(manager, reference);
    expect(byReference.leads.map((l) => l.id)).toContain(all.leads[0].id);
  });

  it('returns zero rows for a term with no matches', async () => {
    const none = await search(manager, 'zzz-no-such-thing');
    expect(none.total).toBe(0);
    expect(none.leads).toHaveLength(0);
  });

  it('treats LIKE wildcards in the term as literals', async () => {
    // An unescaped '%' would match every row; escaped it matches only rows that
    // literally contain a percent sign - of which there are none.
    const wildcard = await search(manager, '%');
    expect(wildcard.total).toBe(0);
  });

  it('keeps row scope: a rep never sees another rep leads in search results', async () => {
    const repAView = await search(repA, 'layla');
    expect(repAView.total).toBe(0);

    const repBView = await search(repB, 'nour');
    expect(repBView.total).toBe(0);

    const repAOwn = await search(repA, 'nour');
    expect(repAOwn.total).toBeGreaterThanOrEqual(1);
  });
});
