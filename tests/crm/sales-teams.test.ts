import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';
import {
  TeamAssignmentError,
  createUser,
  findUserById,
  setUserRole,
  setUserTeamLeader,
} from '../../src/server/users/repository';
import { PERMISSIONS, canAssignOwner, canOwnWork, can } from '../../src/server/authz/permissions';
import { createContact } from '../../src/server/crm/contacts/repository';
import { createLead } from '../../src/server/crm/leads/repository';
import {
  captureLeadUseCase,
  getAssignableOwnersUseCase,
  getLeadDetailUseCase,
  listLeadsUseCase,
  updateLeadUseCase,
} from '../../src/server/crm/leads/service';
import {
  createLeadFollowUpUseCase,
  getOpportunityOwnersUseCase,
  listFollowUpsUseCase,
  listOpportunitiesUseCase,
  qualifyLeadUseCase,
  reassignOpportunityOwnerUseCase,
  type Actor,
} from '../../src/server/crm/opportunities/service';
import { createQuotationUseCase, listQuotationsUseCase } from '../../src/server/crm/quotations/service';
import { getDashboardUseCase } from '../../src/server/crm/dashboard/service';
import { uniqueToken } from './setup/db';

/**
 * Sales teams V1: Admin -> Sales Manager -> Team Leaders -> Sales Reps. A team
 * leader sells like a rep, reaches their team's records as well as their own,
 * and hands work only to someone on their team.
 */
describe('sales teams', () => {
  let database: DisposableDatabase;
  let client: Client;

  const manager: Actor = { userId: '', role: 'SALES_MANAGER' };
  const leaderA: Actor = { userId: '', role: 'SALES_TEAM_LEADER' };
  const leaderB: Actor = { userId: '', role: 'SALES_TEAM_LEADER' };
  const repA1: Actor = { userId: '', role: 'SALES_REP' };
  const repA2: Actor = { userId: '', role: 'SALES_REP' };
  const repB: Actor = { userId: '', role: 'SALES_REP' };
  const loneRep: Actor = { userId: '', role: 'SALES_REP' };
  let adminId: string;
  let sourceId: string;
  const leadOf = new Map<string, string>();

  const mkUser = async (displayName: string, role: Actor['role'] | 'ADMIN') =>
    (
      await createUser(client, {
        displayName,
        email: uniqueToken(displayName.replace(/ /g, '.')) + '@test.com',
        password: 'Password123!',
        role,
      })
    ).id;

  async function newLead(ownerUserId: string): Promise<string> {
    const contact = await createContact(client, { fullName: uniqueToken('Dr Team') });
    const lead = await createLead(client, {
      sourceId,
      campaignId: null,
      contactId: contact.id,
      accountId: null,
      productCategoryId: null,
      note: null,
      ownerUserId,
    });
    return lead.id;
  }

  async function newOpportunity(owner: Actor): Promise<string> {
    const qualified = await qualifyLeadUseCase(owner, await newLead(owner.userId), {}, client);
    if (!qualified.ok) throw new Error(`setup failed: ${qualified.error}`);
    return qualified.opportunity.id;
  }

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);

    adminId = await mkUser('Team Admin', 'ADMIN');
    manager.userId = await mkUser('Team Manager', 'SALES_MANAGER');
    leaderA.userId = await mkUser('Leader A', 'SALES_TEAM_LEADER');
    leaderB.userId = await mkUser('Leader B', 'SALES_TEAM_LEADER');
    repA1.userId = await mkUser('Rep A1', 'SALES_REP');
    repA2.userId = await mkUser('Rep A2', 'SALES_REP');
    repB.userId = await mkUser('Rep B', 'SALES_REP');
    loneRep.userId = await mkUser('Lone Rep', 'SALES_REP');
    await setUserTeamLeader(client, repA1.userId, leaderA.userId);
    await setUserTeamLeader(client, repA2.userId, leaderA.userId);
    await setUserTeamLeader(client, repB.userId, leaderB.userId);

    const { rows } = await client.query<{ id: string }>(`SELECT id FROM crm_source WHERE code = 'whatsapp'`);
    sourceId = rows[0].id;

    for (const actor of [manager, leaderA, leaderB, repA1, repA2, repB, loneRep]) {
      leadOf.set(actor.userId, await newLead(actor.userId));
    }
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  describe('the role', () => {
    it('gives a team leader the selling capabilities of a rep and no user administration', () => {
      for (const permission of PERMISSIONS) {
        expect(can('SALES_TEAM_LEADER', permission)).toBe(can('SALES_REP', permission));
      }
      expect(can('SALES_TEAM_LEADER', 'users:manage')).toBe(false);
    });

    it('lets a team leader own work and assign it, which a rep may not', () => {
      expect(canOwnWork('SALES_TEAM_LEADER')).toBe(true);
      expect(canOwnWork('ADMIN')).toBe(false);
      expect(canAssignOwner('SALES_TEAM_LEADER')).toBe(true);
      expect(canAssignOwner('SALES_MANAGER')).toBe(true);
      expect(canAssignOwner('SALES_REP')).toBe(false);
    });
  });

  describe('team membership', () => {
    it('stores the rep on their leader’s team', async () => {
      expect((await findUserById(client, repA1.userId))?.team_leader_id).toBe(leaderA.userId);
    });

    it('takes a rep off their team with null', async () => {
      await setUserTeamLeader(client, loneRep.userId, leaderA.userId);
      const cleared = await setUserTeamLeader(client, loneRep.userId, null);
      expect(cleared.teamLeaderId).toBeNull();
    });

    it('puts only a rep on a team', async () => {
      await expect(setUserTeamLeader(client, leaderB.userId, leaderA.userId)).rejects.toMatchObject({
        reason: 'NOT_A_REP',
      });
      await expect(setUserTeamLeader(client, manager.userId, leaderA.userId)).rejects.toBeInstanceOf(
        TeamAssignmentError,
      );
    });

    it('accepts only an active team leader as the leader', async () => {
      await expect(setUserTeamLeader(client, loneRep.userId, manager.userId)).rejects.toMatchObject({
        reason: 'NOT_A_TEAM_LEADER',
      });
      const retired = await mkUser('Retired Leader', 'SALES_TEAM_LEADER');
      await client.query('UPDATE crm_user SET is_active = false WHERE id = $1', [retired]);
      await expect(setUserTeamLeader(client, loneRep.userId, retired)).rejects.toMatchObject({
        reason: 'NOT_A_TEAM_LEADER',
      });
    });

    it('refuses a team on anyone but a rep, and a rep leading themselves, in the database too', async () => {
      await expect(
        client.query('UPDATE crm_user SET team_leader_id = $2 WHERE id = $1', [manager.userId, leaderA.userId]),
      ).rejects.toMatchObject({ constraint: 'crm_user_team_leader_only_for_reps' });
      await expect(
        client.query('UPDATE crm_user SET team_leader_id = id WHERE id = $1', [repA1.userId]),
      ).rejects.toMatchObject({ constraint: 'crm_user_team_leader_not_self' });
    });

    it('takes a rep who changes role off their team', async () => {
      const leader = await mkUser('Short Leader', 'SALES_TEAM_LEADER');
      const rep = await mkUser('Promoted Rep', 'SALES_REP');
      await setUserTeamLeader(client, rep, leader);

      const promoted = await setUserRole(client, rep, 'SALES_MANAGER');

      expect(promoted.role).toBe('SALES_MANAGER');
      expect(promoted.teamLeaderId).toBeNull();
    });

    it('leaves a team without a leader when the leader changes role', async () => {
      const leader = await mkUser('Stepping Down', 'SALES_TEAM_LEADER');
      const rep = await mkUser('Team Member', 'SALES_REP');
      await setUserTeamLeader(client, rep, leader);

      await setUserRole(client, leader, 'SALES_REP');

      expect((await findUserById(client, rep))?.team_leader_id).toBeNull();
    });
  });

  describe('leads', () => {
    it('shows a team leader their own leads and their team’s, and nobody else’s', async () => {
      const { leads } = await listLeadsUseCase(leaderA, { limit: 500 }, client);
      const owners = new Set(leads.map((lead) => lead.ownerUserId));

      expect(owners).toEqual(new Set([leaderA.userId, repA1.userId, repA2.userId]));
    });

    it('keeps a rep on their own leads, team or not', async () => {
      const { leads } = await listLeadsUseCase(repA1, { limit: 500 }, client);
      expect(new Set(leads.map((lead) => lead.ownerUserId))).toEqual(new Set([repA1.userId]));
    });

    it('lets a manager see every team', async () => {
      const { leads } = await listLeadsUseCase(manager, { limit: 500 }, client);
      const owners = new Set(leads.map((lead) => lead.ownerUserId));
      for (const actor of [leaderA, leaderB, repA1, repB, loneRep]) {
        expect(owners.has(actor.userId)).toBe(true);
      }
    });

    it('reads another team’s lead as absent', async () => {
      expect(await getLeadDetailUseCase(leaderA, leadOf.get(repA2.userId)!, client)).not.toBeNull();
      expect(await getLeadDetailUseCase(leaderA, leadOf.get(repB.userId)!, client)).toBeNull();
      expect(await getLeadDetailUseCase(leaderA, leadOf.get(loneRep.userId)!, client)).toBeNull();
    });

    it('offers a team leader only their team as owners', async () => {
      const owners = await getAssignableOwnersUseCase(leaderA, client);
      expect(new Set(owners.map((owner) => owner.id))).toEqual(
        new Set([leaderA.userId, repA1.userId, repA2.userId]),
      );
      const opportunityOwners = await getOpportunityOwnersUseCase(leaderA, client);
      expect(opportunityOwners.map((owner) => owner.id).sort()).toEqual(owners.map((owner) => owner.id).sort());
    });

    it('lets a team leader capture a lead for someone on their team only', async () => {
      const forTeam = await captureLeadUseCase(
        leaderA,
        { fullName: 'Dr Captured', phone: '+201000000101', sourceCode: 'whatsapp', ownerUserId: repA1.userId },
        client,
      );
      if (!forTeam.ok) throw new Error(forTeam.error);
      expect((await getLeadDetailUseCase(manager, forTeam.leadId, client))?.ownerUserId).toBe(repA1.userId);

      for (const outsider of [repB.userId, manager.userId]) {
        const refused = await captureLeadUseCase(
          leaderA,
          { fullName: 'Dr Elsewhere', phone: '+201000000102', sourceCode: 'whatsapp', ownerUserId: outsider },
          client,
        );
        expect(refused).toMatchObject({ ok: false, error: 'UNAUTHORISED' });
      }
    });

    it('lets a team leader move a lead within their team but not out of it', async () => {
      const leadId = await newLead(repA1.userId);

      const moved = await updateLeadUseCase(leaderA, leadId, { ownerUserId: repA2.userId }, client);
      expect(moved.ok).toBe(true);

      const refused = await updateLeadUseCase(leaderA, leadId, { ownerUserId: repB.userId }, client);
      expect(refused).toMatchObject({ ok: false, error: 'UNAUTHORISED' });
    });

    it('links a duplicate to the existing lead only for someone who may open it', async () => {
      const phone = '+201000000103';
      const first = await captureLeadUseCase(
        manager,
        { fullName: 'Dr Repeat', phone, sourceCode: 'whatsapp', ownerUserId: repA2.userId },
        client,
      );
      expect(first.ok).toBe(true);

      const asLeader = await captureLeadUseCase(leaderA, { fullName: 'Dr Repeat', phone, sourceCode: 'whatsapp' }, client);
      expect(asLeader).toMatchObject({ ok: false, error: 'DUPLICATE_LEAD' });
      expect(!asLeader.ok && asLeader.existingLeadId).toBeTruthy();

      const asOtherLeader = await captureLeadUseCase(leaderB, { fullName: 'Dr Repeat', phone, sourceCode: 'whatsapp' }, client);
      expect(asOtherLeader).toMatchObject({ ok: false, error: 'DUPLICATE_LEAD' });
      expect(!asOtherLeader.ok && asOtherLeader.existingLeadId).toBeUndefined();
    });

    it('tells the owner’s team leader that a lead arrived, and not the other leaders', async () => {
      const captured = await captureLeadUseCase(
        manager,
        { fullName: 'Dr Notified', phone: '+201000000104', sourceCode: 'whatsapp', ownerUserId: repA1.userId },
        client,
      );
      if (!captured.ok) throw new Error('setup failed');

      const { rows } = await client.query<{ recipient_user_id: string }>(
        `SELECT recipient_user_id FROM crm_notification WHERE lead_id = $1 AND kind = 'LEAD_RECEIVED'`,
        [captured.leadId],
      );
      const recipients = rows.map((row) => row.recipient_user_id);
      expect(recipients).toContain(leaderA.userId);
      expect(recipients).toContain(adminId);
      expect(recipients).not.toContain(leaderB.userId);
      expect(recipients).not.toContain(repA2.userId);
    });
  });

  describe('opportunities, follow-ups and quotations', () => {
    it('shows a team leader their team’s opportunities and not another team’s', async () => {
      const teamDeal = await newOpportunity(repA1);
      const otherDeal = await newOpportunity(repB);

      const { opportunities } = await listOpportunitiesUseCase(leaderA, { limit: 500 }, client);
      const ids = opportunities.map((opportunity) => opportunity.id);
      expect(ids).toContain(teamDeal);
      expect(ids).not.toContain(otherDeal);
    });

    it('lets a team leader reassign a deal within their team only', async () => {
      const deal = await newOpportunity(repA1);

      const moved = await reassignOpportunityOwnerUseCase(leaderA, deal, repA2.userId, client);
      expect(moved.ok).toBe(true);
      if (moved.ok) expect(moved.opportunity.ownerUserId).toBe(repA2.userId);

      expect(await reassignOpportunityOwnerUseCase(leaderA, deal, repB.userId, client)).toMatchObject({
        ok: false,
        error: 'UNAUTHORISED',
      });
      expect(await reassignOpportunityOwnerUseCase(leaderB, deal, repB.userId, client)).toMatchObject({
        ok: false,
        error: 'NOT_FOUND',
      });
      expect(await reassignOpportunityOwnerUseCase(repA2, deal, repA1.userId, client)).toMatchObject({
        ok: false,
        error: 'UNAUTHORISED',
      });
    });

    it('puts the team’s follow-ups in the team leader’s queue', async () => {
      const leadId = await newLead(repA2.userId);
      const created = await createLeadFollowUpUseCase(
        repA2,
        leadId,
        { actionType: 'CALL', dueAt: new Date(Date.now() + 86_400_000), note: null },
        client,
      );
      if (!created.ok) throw new Error('setup failed');

      const mine = await listFollowUpsUseCase(leaderA, { window: 'upcoming', limit: 500 }, client);
      const theirs = await listFollowUpsUseCase(leaderB, { window: 'upcoming', limit: 500 }, client);
      expect(mine.followUps.map((followUp) => followUp.id)).toContain(created.followUp.id);
      expect(theirs.followUps.map((followUp) => followUp.id)).not.toContain(created.followUp.id);
    });

    it('lets a team leader assign a follow-up within their team only', async () => {
      const leadId = await newLead(repA1.userId);
      const due = new Date(Date.now() + 86_400_000);

      const ok = await createLeadFollowUpUseCase(
        leaderA,
        leadId,
        { actionType: 'CALL', dueAt: due, note: null, ownerUserId: repA2.userId },
        client,
      );
      expect(ok.ok).toBe(true);

      const refused = await createLeadFollowUpUseCase(
        leaderA,
        leadId,
        { actionType: 'CALL', dueAt: due, note: null, ownerUserId: repB.userId },
        client,
      );
      expect(refused).toMatchObject({ ok: false, error: 'UNAUTHORISED' });
    });

    it('shows a team leader the quotations on their team’s deals', async () => {
      const deal = await newOpportunity(repA1);
      const created = await createQuotationUseCase(
        repA1,
        deal,
        { items: [{ description: 'Dental unit', quantity: 1, unitPrice: 120000 }] },
        client,
      );
      if (!created.ok) throw new Error('setup failed');

      expect((await listQuotationsUseCase(leaderA, deal, client)).map((q) => q.id)).toContain(created.quotation.id);
      expect(await listQuotationsUseCase(leaderB, deal, client)).toEqual([]);
    });
  });

  describe('dashboard', () => {
    it('shows a team leader their team’s rows', async () => {
      const payload = await getDashboardUseCase(leaderA, { range: 'last30' }, client);
      expect(new Set(payload.repPerformance.map((row) => row.userId))).toEqual(
        new Set([leaderA.userId, repA1.userId, repA2.userId]),
      );
    });

    it('lets a team leader narrow to a team member, and answers nothing outside the team', async () => {
      const member = await getDashboardUseCase(leaderA, { range: 'last30', ownerUserId: repA1.userId }, client);
      expect(member.repPerformance.map((row) => row.userId)).toEqual([repA1.userId]);

      const outsider = await getDashboardUseCase(leaderA, { range: 'last30', ownerUserId: repB.userId }, client);
      expect(outsider.repPerformance).toEqual([]);
    });
  });
});
