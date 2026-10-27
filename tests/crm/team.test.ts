import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';
import { createUser, setUserActive, setUserTeamLeader } from '../../src/server/users/repository';
import { createContact } from '../../src/server/crm/contacts/repository';
import { createLead } from '../../src/server/crm/leads/repository';
import { qualifyLeadUseCase, type Actor } from '../../src/server/crm/opportunities/service';
import { getTeamBoard } from '../../src/server/crm/team/repository';
import { attentionFor } from '../../src/server/crm/team/attention';
import { formatAgo } from '../../src/i18n/format';
import { uniqueToken } from './setup/db';

// 12:00 in Cairo (UTC+3 until the end of October 2026); the Cairo day began at 21:00Z.
const now = new Date('2026-10-27T09:00:00Z');

describe('team attention flags', () => {
  const calm = { overdue: 0, waitingLeads: 0, oldestWaitingAt: null, lastSignInAt: new Date('2026-10-27T08:00:00Z') };

  it('flags nothing for someone on top of their work', () => {
    expect(attentionFor(calm, now)).toEqual([]);
    // A new lead that came in this morning is not late yet.
    expect(attentionFor({ ...calm, waitingLeads: 1, oldestWaitingAt: new Date('2026-10-27T06:00:00Z') }, now)).toEqual([]);
  });

  it('flags overdue follow-ups, a lead waiting over a day and three days away', () => {
    const since = new Date('2026-10-26T08:00:00Z');
    expect(
      attentionFor({ overdue: 2, waitingLeads: 1, oldestWaitingAt: since, lastSignInAt: new Date('2026-10-23T08:00:00Z') }, now),
    ).toEqual([
      { kind: 'overdue', count: 2 },
      { kind: 'waiting', since },
      { kind: 'away', since: new Date('2026-10-23T08:00:00Z') },
    ]);
    expect(attentionFor({ ...calm, lastSignInAt: null }, now)).toEqual([{ kind: 'away', since: null }]);
  });
});

describe('time ago', () => {
  it('reads minutes, hours, days and months in both languages', () => {
    expect(formatAgo('en', new Date('2026-10-27T08:55:00Z'), now)).toBe('5 minutes ago');
    expect(formatAgo('en', new Date('2026-10-27T06:00:00Z'), now)).toBe('3 hours ago');
    expect(formatAgo('en', new Date('2026-10-26T08:00:00Z'), now)).toBe('yesterday');
    expect(formatAgo('en', new Date('2026-09-01T08:00:00Z'), now)).toBe('last month');
    expect(formatAgo('ar', new Date('2026-10-24T08:00:00Z'), now)).toBe('قبل 3 أيام');
    // A clock a little ahead never reads as the future.
    expect(formatAgo('en', new Date('2026-10-27T09:01:00Z'), now)).toBe('this minute');
  });
});

/**
 * The board at `now`, built from rows whose dates are set explicitly so every
 * count can be checked by hand.
 */
describe('team board', () => {
  let database: DisposableDatabase;
  let client: Client;

  const manager: Actor = { userId: '', role: 'SALES_MANAGER' };
  const leader: Actor = { userId: '', role: 'SALES_TEAM_LEADER' };
  const teamRep: Actor = { userId: '', role: 'SALES_REP' };
  const otherRep: Actor = { userId: '', role: 'SALES_REP' };
  let sourceId = '';

  async function lead(owner: Actor, receivedAt: string, status: 'NEW' | 'CONTACTED' = 'NEW') {
    const contact = await createContact(client, { fullName: uniqueToken('Dr') });
    const created = await createLead(client, {
      sourceId,
      campaignId: null,
      contactId: contact.id,
      accountId: null,
      productCategoryId: null,
      note: null,
      ownerUserId: owner.userId,
    });
    await client.query(`UPDATE crm_lead SET received_at = $2, created_at = $2, status = $3 WHERE id = $1`, [
      created.id,
      receivedAt,
      status,
    ]);
    return created.id;
  }

  async function deal(owner: Actor, value: number) {
    const result = await qualifyLeadUseCase(manager, await lead(owner, '2026-10-01T09:00:00Z'), {}, client);
    if (!result.ok) throw new Error(`setup failed: ${result.error}`);
    await client.query(`UPDATE crm_opportunity SET estimated_value = $2 WHERE id = $1`, [result.opportunity.id, value]);
    return result.opportunity.id;
  }

  async function followUp(owner: Actor, opportunityId: string, dueAt: string, completedAt: string | null = null) {
    await client.query(
      `INSERT INTO crm_followup (opportunity_id, owner_user_id, action_type, due_at, created_at, completed_at)
       VALUES ($1, $2, 'CALL', $3, '2026-10-01T09:00:00Z', $4)`,
      [opportunityId, owner.userId, dueAt, completedAt],
    );
  }

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);

    const mkUser = async (name: string, role: Actor['role'] | 'ADMIN') =>
      (await createUser(client, { displayName: name, email: `${uniqueToken(role)}@test.com`, password: 'Password123!', role })).id;
    manager.userId = await mkUser('A Manager', 'SALES_MANAGER');
    leader.userId = await mkUser('Leader Lina', 'SALES_TEAM_LEADER');
    teamRep.userId = await mkUser('Team Rep', 'SALES_REP');
    otherRep.userId = await mkUser('Other Rep', 'SALES_REP');
    await setUserTeamLeader(client, teamRep.userId, leader.userId);
    // Neither an admin nor someone who left sells, so neither is on the board.
    await mkUser('The Admin', 'ADMIN');
    await setUserActive(client, await mkUser('Gone Rep', 'SALES_REP'), false);
    sourceId = (await client.query<{ id: string }>(`SELECT id FROM crm_source WHERE code = 'whatsapp'`)).rows[0].id;

    // Team rep: two new leads waiting, one already called, one archived.
    await lead(teamRep, '2026-10-25T09:00:00Z');
    await lead(teamRep, '2026-10-27T08:00:00Z');
    await lead(teamRep, '2026-10-20T09:00:00Z', 'CONTACTED');
    const archived = await lead(teamRep, '2026-10-10T09:00:00Z');
    await client.query(`UPDATE crm_lead SET archived_at = now(), archived_by_user_id = $2 WHERE id = $1`, [archived, manager.userId]);

    // One open deal with its follow-ups, one deal won this month, one won last month.
    const open = await deal(teamRep, 50_000);
    await followUp(teamRep, open, '2026-10-26T09:00:00Z');
    await followUp(teamRep, open, '2026-10-27T15:00:00Z');
    await followUp(teamRep, open, '2026-10-28T09:00:00Z');
    // 00:30 today in Cairo counts as today; 23:30 yesterday does not.
    await followUp(teamRep, open, '2026-10-26T09:00:00Z', '2026-10-26T21:30:00Z');
    await followUp(teamRep, open, '2026-10-26T09:00:00Z', '2026-10-26T20:30:00Z');

    const won = await deal(teamRep, 100_000);
    await client.query(`UPDATE crm_opportunity SET stage = 'WON', won_at = '2026-10-05T09:00:00Z' WHERE id = $1`, [won]);
    // A follow-up left on a closed deal is no longer anyone's work.
    await followUp(teamRep, won, '2026-10-20T09:00:00Z');
    const september = await deal(teamRep, 7_000);
    await client.query(`UPDATE crm_opportunity SET stage = 'WON', won_at = '2026-09-30T20:30:00Z' WHERE id = $1`, [
      september,
    ]);

    await lead(leader, '2026-10-27T08:30:00Z');
    await client.query(
      `INSERT INTO crm_session (user_id, token_hash, created_at, expires_at)
       VALUES ($1, sha256(gen_random_uuid()::text::bytea), '2026-10-27T06:00:00Z', '2026-11-27T06:00:00Z'),
              ($1, sha256(gen_random_uuid()::text::bytea), '2026-10-20T06:00:00Z', '2026-11-20T06:00:00Z')`,
      [teamRep.userId],
    );
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  it('gives each person in a selling role their workload, team by team', async () => {
    const board = await getTeamBoard(client, manager, now);
    expect(board).toMatchObject({ today: '2026-10-27', monthStart: '2026-10-01' });
    expect(board.members.map((row) => row.displayName)).toEqual(['Leader Lina', 'Team Rep', 'A Manager', 'Other Rep']);

    const byName = new Map(board.members.map((row) => [row.displayName, row]));
    expect(byName.get('Team Rep')).toEqual({
      userId: teamRep.userId,
      displayName: 'Team Rep',
      role: 'SALES_REP',
      teamLeaderId: leader.userId,
      teamName: 'Leader Lina',
      lastSignInAt: new Date('2026-10-27T06:00:00Z'),
      lastCallAt: new Date('2026-10-26T21:30:00Z'),
      waitingLeads: 2,
      oldestWaitingAt: new Date('2026-10-25T09:00:00Z'),
      openLeads: 3,
      openDeals: 1,
      pipelineValue: 50_000,
      overdue: 1,
      dueToday: 1,
      callsToday: 1,
      monthWins: 1,
      monthWonValue: 100_000,
    });
    expect(byName.get('Leader Lina')).toMatchObject({
      teamLeaderId: leader.userId,
      teamName: 'Leader Lina',
      waitingLeads: 1,
      lastSignInAt: null,
    });
    expect(byName.get('Other Rep')).toMatchObject({
      teamLeaderId: null,
      teamName: null,
      waitingLeads: 0,
      openDeals: 0,
      lastCallAt: null,
      oldestWaitingAt: null,
    });
  });

  it('keeps a rep to their own card and a team leader to their team', async () => {
    expect((await getTeamBoard(client, teamRep, now)).members.map((row) => row.displayName)).toEqual(['Team Rep']);
    expect((await getTeamBoard(client, otherRep, now)).members.map((row) => row.displayName)).toEqual(['Other Rep']);
    expect((await getTeamBoard(client, leader, now)).members.map((row) => row.displayName)).toEqual([
      'Leader Lina',
      'Team Rep',
    ]);
  });
});
