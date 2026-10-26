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
import {
  createQuotationUseCase,
  listQuotationIndexUseCase,
  reviseQuotationUseCase,
  transitionQuotationUseCase,
} from '../../src/server/crm/quotations/service';
import type { QuotationStatus } from '../../src/server/crm/quotations/status';
import { uniqueToken } from './setup/db';

/**
 * The quotations page: every current quotation in the actor's scope, with
 * tab counts and values that cover the whole scope rather than the page.
 */
describe('quotations list', () => {
  let database: DisposableDatabase;
  let client: Client;
  let sourceId: string;

  const manager: Actor = { userId: '', role: 'SALES_MANAGER' };
  const leader: Actor = { userId: '', role: 'SALES_TEAM_LEADER' };
  const teamRep: Actor = { userId: '', role: 'SALES_REP' };
  const otherRep: Actor = { userId: '', role: 'SALES_REP' };

  /** A quotation worth `amount` on a fresh deal for `owner`, moved to `status`. */
  async function quotation(
    owner: Actor,
    customer: string,
    amount: number,
    status: QuotationStatus,
    options: { phone?: string; validUntil?: string } = {},
  ) {
    const contact = await createContact(client, { fullName: customer });
    if (options.phone) {
      await client.query(
        `INSERT INTO crm_contact_channel (contact_id, channel_type, value) VALUES ($1, 'PHONE', $2)`,
        [contact.id, options.phone],
      );
    }
    const lead = await createLead(client, {
      sourceId,
      campaignId: null,
      contactId: contact.id,
      accountId: null,
      productCategoryId: null,
      note: null,
      ownerUserId: owner.userId,
    });
    const qualified = await qualifyLeadUseCase(manager, lead.id, {}, client);
    if (!qualified.ok) throw new Error(`setup failed: ${qualified.error}`);

    const created = await createQuotationUseCase(
      owner,
      qualified.opportunity.id,
      {
        items: [{ description: 'Dental unit', quantity: 1, unitPrice: amount }],
        validUntil: options.validUntil ?? null,
      },
      client,
    );
    if (!created.ok) throw new Error(`setup failed: ${created.message}`);

    const path: QuotationStatus[] =
      status === 'DRAFT' ? [] : status === 'SENT' ? ['SENT'] : status === 'EXPIRED' ? ['EXPIRED'] : ['SENT', status];
    for (const step of path) {
      const moved = await transitionQuotationUseCase(manager, created.quotation.id, step, client);
      if (!moved.ok) throw new Error(`setup failed: ${moved.message}`);
    }
    return created.quotation;
  }

  let revisedOriginal: string;
  let revision: string;

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);

    const mkUser = async (name: string, role: Actor['role']) =>
      (await createUser(client, { displayName: name, email: `${uniqueToken(role)}@test.com`, password: 'Password123!', role })).id;
    manager.userId = await mkUser('List Manager', 'SALES_MANAGER');
    leader.userId = await mkUser('List Leader', 'SALES_TEAM_LEADER');
    teamRep.userId = await mkUser('Team Rep', 'SALES_REP');
    otherRep.userId = await mkUser('Other Rep', 'SALES_REP');
    await setUserTeamLeader(client, teamRep.userId, leader.userId);

    const { rows } = await client.query<{ id: string }>(`SELECT id FROM crm_source WHERE code = 'whatsapp'`);
    sourceId = rows[0].id;

    const past = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await quotation(teamRep, 'Dr Hala Clinic', 100_000, 'SENT', { phone: '+201001112223', validUntil: past });
    await quotation(teamRep, 'Dr Karim', 50_000, 'DRAFT');
    await quotation(teamRep, 'Dr Lamia', 80_000, 'ACCEPTED', { validUntil: past });
    await quotation(leader, 'Dr Leader Own', 20_000, 'REJECTED');
    await quotation(otherRep, 'Dr Outsider', 70_000, 'SENT');
    await quotation(otherRep, 'Dr Expired', 10_000, 'EXPIRED');

    // A sent offer replaced by a revision shows once, at the revision.
    const original = await quotation(otherRep, 'Dr Revised', 30_000, 'SENT');
    const revised = await reviseQuotationUseCase(otherRep, original.id, client);
    if (!revised.ok) throw new Error('setup failed');
    revisedOriginal = original.id;
    revision = revised.quotation.id;
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  it('shows a manager every current quotation with counts and values per status', async () => {
    const { quotations, total, counts } = await listQuotationIndexUseCase(manager, { limit: 2 }, client);

    expect(quotations).toHaveLength(2);
    expect(total).toBe(7);
    expect(counts).toEqual({
      ALL: { count: 7, value: 360_000 },
      DRAFT: { count: 2, value: 80_000 },
      SENT: { count: 2, value: 170_000 },
      ACCEPTED: { count: 1, value: 80_000 },
      REJECTED: { count: 1, value: 20_000 },
      EXPIRED: { count: 1, value: 10_000 },
    });
  });

  it('leaves out a quotation that a revision replaced', async () => {
    const { quotations } = await listQuotationIndexUseCase(manager, { search: 'Dr Revised' }, client);

    expect(quotations.map((row) => row.id)).toEqual([revision]);
    expect(quotations[0].version).toBe(2);
    expect(quotations[0].status).toBe('DRAFT');
    expect(quotations.map((row) => row.id)).not.toContain(revisedOriginal);
  });

  it('keeps a rep to their own quotations', async () => {
    const { quotations, counts } = await listQuotationIndexUseCase(teamRep, {}, client);

    expect(quotations.map((row) => row.contactName).sort()).toEqual(['Dr Hala Clinic', 'Dr Karim', 'Dr Lamia']);
    expect(counts.ALL).toEqual({ count: 3, value: 230_000 });
  });

  it('shows a team leader their own and their team’s quotations', async () => {
    const { quotations } = await listQuotationIndexUseCase(leader, {}, client);

    expect(quotations.map((row) => row.contactName).sort()).toEqual([
      'Dr Hala Clinic',
      'Dr Karim',
      'Dr Lamia',
      'Dr Leader Own',
    ]);
  });

  it('gives a team leader nothing when filtering by someone outside the team', async () => {
    const { quotations, total } = await listQuotationIndexUseCase(leader, { ownerUserId: otherRep.userId }, client);

    expect(quotations).toEqual([]);
    expect(total).toBe(0);
  });

  it('filters by status and by owner, counting within the owner filter', async () => {
    const sent = await listQuotationIndexUseCase(manager, { status: 'SENT' }, client);
    expect(sent.total).toBe(2);
    expect(sent.quotations.every((row) => row.status === 'SENT')).toBe(true);

    const byOwner = await listQuotationIndexUseCase(manager, { ownerUserId: otherRep.userId }, client);
    expect(byOwner.counts.ALL.count).toBe(3);
    expect(byOwner.quotations.every((row) => row.ownerName === 'Other Rep')).toBe(true);
  });

  it('searches by quote number, customer and phone', async () => {
    const { quotations: all } = await listQuotationIndexUseCase(manager, { limit: 100 }, client);
    const karim = all.find((row) => row.contactName === 'Dr Karim')!;

    const byNumber = await listQuotationIndexUseCase(manager, { search: karim.quoteNumber }, client);
    expect(byNumber.quotations.map((row) => row.id)).toEqual([karim.id]);

    const byName = await listQuotationIndexUseCase(manager, { search: 'hala' }, client);
    expect(byName.quotations.map((row) => row.contactName)).toEqual(['Dr Hala Clinic']);
    expect(byName.counts.ALL.count).toBe(1);

    const byPhone = await listQuotationIndexUseCase(manager, { search: '1001112223' }, client);
    expect(byPhone.quotations.map((row) => row.contactName)).toEqual(['Dr Hala Clinic']);
  });

  it('flags an open quotation whose validity has passed, not a decided one', async () => {
    const { quotations } = await listQuotationIndexUseCase(manager, { limit: 100 }, client);
    const byName = new Map(quotations.map((row) => [row.contactName, row]));

    expect(byName.get('Dr Hala Clinic')!.pastValidity).toBe(true);
    expect(byName.get('Dr Lamia')!.pastValidity).toBe(false);
    expect(byName.get('Dr Karim')!.pastValidity).toBe(false);
  });
});
