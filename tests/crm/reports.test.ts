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
import { getSalesReport } from '../../src/server/crm/reports/repository';
import { isCalendarDate, resolveReportPeriod } from '../../src/server/crm/reports/period';
import { uniqueToken } from './setup/db';

describe('report periods', () => {
  const now = new Date('2026-10-27T10:00:00Z');

  it('resolves the running and closed periods as Cairo calendar dates', () => {
    expect(resolveReportPeriod('thisMonth', now)).toEqual({ startDate: '2026-10-01', endDate: '2026-10-27' });
    expect(resolveReportPeriod('lastMonth', now)).toEqual({ startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(resolveReportPeriod('thisQuarter', now)).toEqual({ startDate: '2026-10-01', endDate: '2026-10-27' });
    expect(resolveReportPeriod('thisYear', now)).toEqual({ startDate: '2026-01-01', endDate: '2026-10-27' });
    expect(resolveReportPeriod('lastYear', now)).toEqual({ startDate: '2025-01-01', endDate: '2025-12-31' });
  });

  it('reads last month across a year boundary and in a short month', () => {
    expect(resolveReportPeriod('lastMonth', new Date('2026-01-15T10:00:00Z'))).toEqual({
      startDate: '2025-12-01',
      endDate: '2025-12-31',
    });
    expect(resolveReportPeriod('lastMonth', new Date('2028-03-10T10:00:00Z'))).toEqual({
      startDate: '2028-02-01',
      endDate: '2028-02-29',
    });
  });

  it('counts the day in Cairo, not in UTC', () => {
    // 22:30 UTC on 31 October is already 1 November in Cairo.
    expect(resolveReportPeriod('thisMonth', new Date('2026-10-31T22:30:00Z'))).toEqual({
      startDate: '2026-11-01',
      endDate: '2026-11-01',
    });
  });

  it('takes a custom period only as two real dates in order, else this month', () => {
    expect(resolveReportPeriod('custom', now, { startDate: '2026-03-01', endDate: '2026-03-31' })).toEqual({
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });
    const fallback = { startDate: '2026-10-01', endDate: '2026-10-27' };
    expect(resolveReportPeriod('custom', now, { startDate: '2026-03-31', endDate: '2026-03-01' })).toEqual(fallback);
    expect(resolveReportPeriod('custom', now, { startDate: '2026-02-30', endDate: '2026-03-01' })).toEqual(fallback);
    expect(resolveReportPeriod('custom', now, {})).toEqual(fallback);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
  });
});

/**
 * The sales report for October 2026, built from rows whose dates are set
 * explicitly so every count can be checked by hand.
 */
describe('sales report', () => {
  let database: DisposableDatabase;
  let client: Client;
  const october = { startDate: '2026-10-01', endDate: '2026-10-31' };

  const manager: Actor = { userId: '', role: 'SALES_MANAGER' };
  const leader: Actor = { userId: '', role: 'SALES_TEAM_LEADER' };
  const teamRep: Actor = { userId: '', role: 'SALES_REP' };
  const otherRep: Actor = { userId: '', role: 'SALES_REP' };
  const ids = new Map<string, string>();

  async function lead(owner: Actor, createdAt: string, source: string, category: string | null) {
    const contact = await createContact(client, { fullName: uniqueToken('Dr') });
    const created = await createLead(client, {
      sourceId: ids.get(`source:${source}`)!,
      campaignId: null,
      contactId: contact.id,
      accountId: null,
      productCategoryId: category ? ids.get(`category:${category}`)! : null,
      note: null,
      ownerUserId: owner.userId,
    });
    await client.query(`UPDATE crm_lead SET created_at = $2, received_at = $2 WHERE id = $1`, [created.id, createdAt]);
    return created.id;
  }

  async function qualify(leadId: string, createdAt: string) {
    const result = await qualifyLeadUseCase(manager, leadId, {}, client);
    if (!result.ok) throw new Error(`setup failed: ${result.error}`);
    await client.query(`UPDATE crm_opportunity SET created_at = $2 WHERE id = $1`, [result.opportunity.id, createdAt]);
    return result.opportunity.id;
  }

  async function call(owner: Actor, opportunityId: string, completedAt: string, outcome: string) {
    await client.query(
      `INSERT INTO crm_followup (opportunity_id, owner_user_id, action_type, due_at, created_at, completed_at, outcome)
       VALUES ($1, $2, 'CALL', $3, $3, $3, $4)`,
      [opportunityId, owner.userId, completedAt, outcome],
    );
  }

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);

    const mkUser = async (name: string, role: Actor['role']) =>
      (await createUser(client, { displayName: name, email: `${uniqueToken(role)}@test.com`, password: 'Password123!', role })).id;
    manager.userId = await mkUser('Report Manager', 'SALES_MANAGER');
    leader.userId = await mkUser('Report Leader', 'SALES_TEAM_LEADER');
    teamRep.userId = await mkUser('Team Rep', 'SALES_REP');
    otherRep.userId = await mkUser('Other Rep', 'SALES_REP');
    await setUserTeamLeader(client, teamRep.userId, leader.userId);

    for (const row of (await client.query<{ id: string; code: string }>(`SELECT id, code FROM crm_source`)).rows) {
      ids.set(`source:${row.code}`, row.id);
    }
    for (const row of (await client.query<{ id: string; code: string }>(`SELECT id, code FROM crm_product_category`)).rows) {
      ids.set(`category:${row.code}`, row.id);
    }

    // Team rep: two October leads, one won in October for 100,000, two calls.
    const won = await qualify(await lead(teamRep, '2026-10-02T09:00:00Z', 'whatsapp', 'dental_units'), '2026-10-03T09:00:00Z');
    await client.query(
      `UPDATE crm_opportunity SET stage = 'WON', won_at = '2026-10-10T09:00:00Z', estimated_value = 100000 WHERE id = $1`,
      [won],
    );
    await lead(teamRep, '2026-10-05T09:00:00Z', 'facebook', 'autoclaves');
    await call(teamRep, won, '2026-10-04T09:00:00Z', 'NO_ANSWER');
    await call(teamRep, won, '2026-10-06T09:00:00Z', 'ASKING_PRICES');
    // A September lead, and a call at 23:30 Cairo on 30 September: outside it.
    await lead(teamRep, '2026-09-20T09:00:00Z', 'whatsapp', null);
    await call(teamRep, won, '2026-09-30T20:30:00Z', 'BUSY');

    // Other rep: one deal lost in October, one lead disqualified in October.
    const lost = await qualify(await lead(otherRep, '2026-10-07T09:00:00Z', 'whatsapp', 'dental_units'), '2026-10-08T09:00:00Z');
    await client.query(
      `UPDATE crm_opportunity
          SET stage = 'LOST', lost_at = '2026-10-20T09:00:00Z',
              lost_reason_id = (SELECT id FROM crm_outcome_reason WHERE kind = 'lost' AND code = 'price_too_high')
        WHERE id = $1`,
      [lost],
    );
    const dropped = await lead(otherRep, '2026-10-08T09:00:00Z', 'facebook', null);
    await client.query(
      `UPDATE crm_lead
          SET status = 'DISQUALIFIED', disqualified_at = '2026-10-09T09:00:00Z',
              disqualify_reason_id = (SELECT id FROM crm_outcome_reason WHERE kind = 'disqualify' AND code = 'not_interested')
        WHERE id = $1`,
      [dropped],
    );
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  it('reports each person’s month, grouped by team', async () => {
    const { people } = await getSalesReport(client, manager, october);
    const byName = new Map(people.map((row) => [row.displayName, row]));

    expect(people.map((row) => row.displayName)).toEqual(['Team Rep', 'Report Leader', 'Other Rep', 'Report Manager']);
    expect(byName.get('Team Rep')).toMatchObject({
      teamName: 'Report Leader',
      newLeads: 2,
      qualified: 1,
      wins: 1,
      wonValue: 100_000,
      losses: 0,
      callsLogged: 2,
      callsReached: 1,
    });
    expect(byName.get('Report Leader')).toMatchObject({ teamName: 'Report Leader', newLeads: 0, wins: 0 });
    expect(byName.get('Other Rep')).toMatchObject({ teamName: null, newLeads: 2, qualified: 1, wins: 0, losses: 1 });
  });

  it('keeps a rep to their own row and a team leader to their team', async () => {
    const rep = await getSalesReport(client, otherRep, october);
    expect(rep.people.map((row) => row.displayName)).toEqual(['Other Rep']);
    expect(rep.sources.find((row) => row.code === 'whatsapp')).toMatchObject({ leads: 1, qualified: 1, wins: 0 });

    const team = await getSalesReport(client, leader, october);
    expect(team.people.map((row) => row.displayName).sort()).toEqual(['Report Leader', 'Team Rep']);
    expect(team.lostReasons).toEqual([]);
    expect(team.outcomes.reduce((sum, row) => sum + row.count, 0)).toBe(2);
  });

  it('breaks the month down by product and by source', async () => {
    const { categories, sources } = await getSalesReport(client, manager, october);

    expect(categories).toEqual([
      { code: 'dental_units', name: 'Dental units', leads: 2, qualified: 2, wins: 1, wonValue: 100_000 },
      { code: 'autoclaves', name: 'Autoclaves', leads: 1, qualified: 0, wins: 0, wonValue: 0 },
    ]);
    expect(sources).toEqual([
      { code: 'whatsapp', name: 'WhatsApp', leads: 2, qualified: 2, wins: 1, wonValue: 100_000 },
      { code: 'facebook', name: 'Facebook', leads: 2, qualified: 0, wins: 0, wonValue: 0 },
    ]);
  });

  it('counts call results and the reasons deals and leads were dropped', async () => {
    const { outcomes, lostReasons, disqualifyReasons } = await getSalesReport(client, manager, october);

    expect(outcomes).toEqual([
      { outcome: 'ASKING_PRICES', count: 1 },
      { outcome: 'NO_ANSWER', count: 1 },
    ]);
    expect(lostReasons).toEqual([{ code: 'price_too_high', label: 'Price too high', count: 1 }]);
    expect(disqualifyReasons.map((row) => [row.code, row.count])).toEqual([['not_interested', 1]]);
  });

  it('gives the twelve months up to the period’s last month', async () => {
    const { months } = await getSalesReport(client, manager, october);

    expect(months).toHaveLength(12);
    expect(months[0].month).toBe('2025-11');
    expect(months[11]).toEqual({ month: '2026-10', newLeads: 4, wins: 1, wonValue: 100_000 });
    expect(months[10]).toEqual({ month: '2026-09', newLeads: 1, wins: 0, wonValue: 0 });
  });
});
