import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';
import { createUser, setUserTeamLeader } from '../../src/server/users/repository';
import { createContact } from '../../src/server/crm/contacts/repository';
import { createLead } from '../../src/server/crm/leads/repository';
import { qualifyLeadUseCase, type Actor } from '../../src/server/crm/opportunities/service';
import { createQuotationUseCase, transitionQuotationUseCase } from '../../src/server/crm/quotations/service';
import { listCustomers } from '../../src/server/crm/customers/repository';
import { uniqueToken } from './setup/db';

/**
 * The customers page: everyone with a won deal, read from the deals
 * themselves, inside the actor's row scope.
 */
describe('customers list', () => {
  let database: DisposableDatabase;
  let client: Client;
  let sourceId: string;
  const categoryId = new Map<string, string>();

  const manager: Actor = { userId: '', role: 'SALES_MANAGER' };
  const leader: Actor = { userId: '', role: 'SALES_TEAM_LEADER' };
  const teamRep: Actor = { userId: '', role: 'SALES_REP' };
  const otherRep: Actor = { userId: '', role: 'SALES_REP' };

  async function customer(name: string, phone?: string) {
    const contact = await createContact(client, { fullName: name });
    if (phone) {
      await client.query(
        `INSERT INTO crm_contact_channel (contact_id, channel_type, value) VALUES ($1, 'PHONE', $2)`,
        [contact.id, phone],
      );
    }
    return contact.id;
  }

  /** An opportunity for `contactId` owned by `owner`, won on `wonOn` unless it stays open. */
  async function deal(
    owner: Actor,
    contactId: string,
    options: { wonOn?: string; estimate?: number; accepted?: number; category?: string } = {},
  ) {
    const lead = await createLead(client, {
      sourceId,
      campaignId: null,
      contactId,
      accountId: null,
      productCategoryId: options.category ? categoryId.get(options.category)! : null,
      note: null,
      ownerUserId: owner.userId,
    });
    const qualified = await qualifyLeadUseCase(manager, lead.id, {}, client);
    if (!qualified.ok) throw new Error(`setup failed: ${qualified.error}`);
    const id = qualified.opportunity.id;

    if (options.estimate !== undefined) {
      await client.query(`UPDATE crm_opportunity SET estimated_value = $2 WHERE id = $1`, [id, options.estimate]);
    }
    if (options.accepted !== undefined) {
      const created = await createQuotationUseCase(
        manager,
        id,
        { items: [{ description: 'Dental unit', quantity: 1, unitPrice: options.accepted }] },
        client,
      );
      if (!created.ok) throw new Error('setup failed');
      for (const step of ['SENT', 'ACCEPTED'] as const) {
        const moved = await transitionQuotationUseCase(manager, created.quotation.id, step, client);
        if (!moved.ok) throw new Error('setup failed');
      }
    }
    if (options.wonOn) {
      await client.query(`UPDATE crm_opportunity SET stage = 'WON', won_at = $2 WHERE id = $1`, [id, options.wonOn]);
    }
    return id;
  }

  let halaLatestDeal: string;

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);

    const mkUser = async (name: string, role: Actor['role']) =>
      (await createUser(client, { displayName: name, email: `${uniqueToken(role)}@test.com`, password: 'Password123!', role })).id;
    manager.userId = await mkUser('Customers Manager', 'SALES_MANAGER');
    leader.userId = await mkUser('Customers Leader', 'SALES_TEAM_LEADER');
    teamRep.userId = await mkUser('Team Rep', 'SALES_REP');
    otherRep.userId = await mkUser('Other Rep', 'SALES_REP');
    await setUserTeamLeader(client, teamRep.userId, leader.userId);

    const { rows } = await client.query<{ id: string }>(`SELECT id FROM crm_source WHERE code = 'whatsapp'`);
    sourceId = rows[0].id;
    const { rows: categories } = await client.query<{ id: string; code: string }>(`SELECT id, code FROM crm_product_category`);
    for (const row of categories) categoryId.set(row.code, row.id);

    // Dr Hala bought twice: from the team rep, then from the other rep, and
    // has one deal still open with the team rep.
    const hala = await customer('Dr Hala', '+201001112223');
    await deal(teamRep, hala, { wonOn: '2026-03-01', accepted: 120_000, estimate: 999, category: 'dental_units' });
    halaLatestDeal = await deal(otherRep, hala, { wonOn: '2026-09-01', estimate: 30_000, category: 'autoclaves' });
    await deal(teamRep, hala);

    // Dr Karim bought from the leader, with no value recorded.
    const karim = await customer('Dr Karim');
    await deal(leader, karim, { wonOn: '2026-06-01', category: 'dental_units' });

    // Dr Lamia only has an open deal: not a customer yet.
    const lamia = await customer('Dr Lamia');
    await deal(teamRep, lamia, { estimate: 50_000 });
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  it('lists everyone with a won deal, most recent purchase first', async () => {
    const { customers, summary } = await listCustomers(client, manager);

    expect(customers.map((row) => row.name)).toEqual(['Dr Hala', 'Dr Karim']);
    expect(summary).toEqual({ customers: 2, purchases: 3, totalValue: 150_000, purchasesWithoutValue: 1 });
  });

  it('values a won deal at its accepted quotation, else its estimate', async () => {
    const { customers } = await listCustomers(client, manager);
    const hala = customers.find((row) => row.name === 'Dr Hala')!;
    const karim = customers.find((row) => row.name === 'Dr Karim')!;

    expect(hala.purchases).toBe(2);
    expect(hala.totalValue).toBe(150_000);
    expect(hala.purchasesWithoutValue).toBe(0);
    expect(karim.totalValue).toBeNull();
    expect(karim.purchasesWithoutValue).toBe(1);
  });

  it('links to the latest purchase and names its owner, phone and what was bought', async () => {
    const { customers } = await listCustomers(client, manager);
    const hala = customers.find((row) => row.name === 'Dr Hala')!;

    expect(hala.lastOpportunityId).toBe(halaLatestDeal);
    expect(hala.ownerName).toBe('Other Rep');
    expect(hala.phone).toBe('+201001112223');
    expect(hala.lastPurchaseAt.toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(hala.categories.map((category) => category.code).sort()).toEqual(['autoclaves', 'dental_units']);
    expect(hala.openDeals).toBe(1);
  });

  it('keeps a rep to the deals they won', async () => {
    const team = await listCustomers(client, teamRep);
    expect(team.customers.map((row) => row.name)).toEqual(['Dr Hala']);
    expect(team.customers[0].purchases).toBe(1);
    expect(team.customers[0].totalValue).toBe(120_000);
    expect(team.customers[0].ownerName).toBe('Team Rep');
    expect(team.summary.customers).toBe(1);

    const other = await listCustomers(client, otherRep);
    expect(other.customers.map((row) => row.name)).toEqual(['Dr Hala']);
    expect(other.customers[0].totalValue).toBe(30_000);
    // The open deal belongs to the team rep, outside this rep's scope.
    expect(other.customers[0].openDeals).toBe(0);
  });

  it('shows a team leader their own and their team’s customers', async () => {
    const { customers } = await listCustomers(client, leader);
    expect(customers.map((row) => row.name).sort()).toEqual(['Dr Hala', 'Dr Karim']);
    expect(customers.find((row) => row.name === 'Dr Hala')!.purchases).toBe(1);
  });

  it('filters by owner and searches by name or phone', async () => {
    const byOwner = await listCustomers(client, manager, { ownerUserId: leader.userId });
    expect(byOwner.customers.map((row) => row.name)).toEqual(['Dr Karim']);
    expect(byOwner.summary.customers).toBe(1);

    const byPhone = await listCustomers(client, manager, { search: '1001112223' });
    expect(byPhone.customers.map((row) => row.name)).toEqual(['Dr Hala']);

    const byName = await listCustomers(client, manager, { search: 'karim' });
    expect(byName.customers.map((row) => row.name)).toEqual(['Dr Karim']);
    expect(byName.summary.purchases).toBe(1);
  });

  it('pages without changing the summary', async () => {
    const { customers, summary } = await listCustomers(client, manager, { limit: 1, offset: 1 });
    expect(customers.map((row) => row.name)).toEqual(['Dr Karim']);
    expect(summary.customers).toBe(2);
  });
});
