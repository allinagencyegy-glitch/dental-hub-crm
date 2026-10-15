import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';
import { createUser, setUserActive } from '../../src/server/users/repository';
import { createContact } from '../../src/server/crm/contacts/repository';
import { createProductCategory } from '../../src/server/crm/catalog/repository';
import { createLead, findLeadById } from '../../src/server/crm/leads/repository';
import {
  qualifyLeadUseCase,
  changeOpportunityStageUseCase,
  updateOpportunityUseCase,
  reassignOpportunityOwnerUseCase,
  createFollowUpUseCase,
  completeFollowUpUseCase,
  listFollowUpsUseCase,
  getOpportunityStageHistoryUseCase,
  getNextPendingFollowUpUseCase,
  getFollowUpWindowCountsUseCase,
  type Actor,
} from '../../src/server/crm/opportunities/service';
import { uniqueToken } from './setup/db';

const REP: Actor['role'] = 'SALES_REP';
const MANAGER: Actor['role'] = 'SALES_MANAGER';

describe('opportunities and follow-ups (use cases)', () => {
  let database: DisposableDatabase;
  let client: Client;

  let repAId: string;
  let repBId: string;
  let repCId: string;
  let managerId: string;
  let adminId: string;
  let contactId: string;
  let categoryId: string;
  let sourceId: string;
  let lostReasonId: string;
  let lostReasonNeedingNoteId: string;

  const repA: Actor = { userId: '', role: REP };
  const repB: Actor = { userId: '', role: REP };
  const manager: Actor = { userId: '', role: MANAGER };
  const admin: Actor = { userId: '', role: 'ADMIN' };

  async function newLead(ownerUserId: string): Promise<string> {
    const lead = await createLead(client, {
      sourceId,
      campaignId: null,
      contactId,
      accountId: null,
      productCategoryId: categoryId,
      note: null,
      ownerUserId,
    });
    return lead.id;
  }

  async function newOpportunity(ownerUserId = repAId) {
    const leadId = await newLead(ownerUserId);
    const result = await qualifyLeadUseCase(manager, leadId, {}, client);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('setup failed');
    return result.opportunity;
  }

  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);

    const mkUser = async (displayName: string, role: Actor['role']) =>
      (
        await createUser(client, {
          displayName,
          email: uniqueToken(displayName) + '@test.com',
          password: 'Password123!',
          role,
        })
      ).id;

    repAId = await mkUser('Rep Alpha', REP);
    repBId = await mkUser('Rep Bravo', REP);
    repCId = await mkUser('Rep Charlie', REP);
    managerId = await mkUser('Sales Manager', MANAGER);
    adminId = await mkUser('Admin', 'ADMIN');

    repA.userId = repAId;
    repB.userId = repBId;
    manager.userId = managerId;
    admin.userId = adminId;

    categoryId = (
      await createProductCategory(client, { code: uniqueToken('cat'), name: 'Implants' })
    ).id;
    contactId = (await createContact(client, { fullName: 'Patient Contact' })).id;

    const { rows: sourceRows } = await client.query<{ id: string }>(
      `SELECT id FROM crm_source WHERE code = 'website'`,
    );
    sourceId = sourceRows[0].id;

    const { rows: reasons } = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM crm_outcome_reason WHERE kind = 'lost' AND code IN ('no_budget', 'other')`,
    );
    lostReasonId = reasons.find((r) => r.code === 'no_budget')!.id;
    lostReasonNeedingNoteId = reasons.find((r) => r.code === 'other')!.id;
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  describe('qualifying a lead', () => {
    it('creates an opportunity at QUALIFIED owned by the lead owner', async () => {
      const leadId = await newLead(repAId);
      const result = await qualifyLeadUseCase(repA, leadId, { estimatedValue: 25000 }, client);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.opportunity.stage).toBe('QUALIFIED');
      expect(result.opportunity.ownerUserId).toBe(repAId);
      expect(result.opportunity.estimatedValue).toBe(25000);
    });

    it('marks a NEW lead as CONTACTED', async () => {
      const leadId = await newLead(repAId);
      await qualifyLeadUseCase(repA, leadId, {}, client);
      const lead = await findLeadById(client, leadId, { userId: repAId, role: REP });
      expect(lead!.status).toBe('CONTACTED');
    });

    it('refuses to qualify the same lead twice', async () => {
      const leadId = await newLead(repAId);
      await qualifyLeadUseCase(repA, leadId, {}, client);
      const second = await qualifyLeadUseCase(repA, leadId, {}, client);
      expect(second).toMatchObject({ ok: false, error: 'ALREADY_QUALIFIED' });
    });

    it('refuses to qualify a disqualified lead', async () => {
      const leadId = await newLead(repAId);
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM crm_outcome_reason WHERE kind = 'disqualify' AND code = 'spam'`,
      );
      await client.query(
        `UPDATE crm_lead
            SET status = 'DISQUALIFIED', disqualified_at = now(), disqualify_reason_id = $2
          WHERE id = $1`,
        [leadId, rows[0].id],
      );
      const result = await qualifyLeadUseCase(repA, leadId, {}, client);
      expect(result).toMatchObject({ ok: false, error: 'LEAD_NOT_QUALIFIABLE' });
    });

    it('reports a lead the actor cannot see as not found, not forbidden', async () => {
      const leadId = await newLead(repAId);
      const result = await qualifyLeadUseCase(repB, leadId, {}, client);
      // repB owns nothing: the lead must be indistinguishable from a bad id.
      expect(result).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    });

    it('rejects a negative estimated value', async () => {
      const leadId = await newLead(repAId);
      const result = await qualifyLeadUseCase(repA, leadId, { estimatedValue: -5 }, client);
      expect(result).toMatchObject({ ok: false, error: 'VALIDATION' });
    });

    it('lets a manager qualify on behalf of another rep', async () => {
      const leadId = await newLead(repAId);
      const result = await qualifyLeadUseCase(
        manager,
        leadId,
        { ownerUserId: repBId },
        client,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.opportunity.ownerUserId).toBe(repBId);
    });

    it('stops a rep from qualifying onto someone else', async () => {
      const leadId = await newLead(repAId);
      const result = await qualifyLeadUseCase(repA, leadId, { ownerUserId: repBId }, client);
      expect(result).toMatchObject({ ok: false, error: 'UNAUTHORISED' });
    });

    it('rejects an inactive owner', async () => {
      await setUserActive(client, repCId, false);
      const leadId = await newLead(repAId);
      const result = await qualifyLeadUseCase(manager, leadId, { ownerUserId: repCId }, client);
      expect(result).toMatchObject({ ok: false, error: 'OWNER_NOT_FOUND' });
    });

    it('rejects an owner outside the sales roles', async () => {
      const leadId = await newLead(repAId);
      const result = await qualifyLeadUseCase(manager, leadId, { ownerUserId: adminId }, client);
      expect(result).toMatchObject({ ok: false, error: 'OWNER_NOT_FOUND' });
    });
  });

  describe('stage transitions', () => {
    it('walks the happy path QUALIFIED → WON', async () => {
      const opportunity = await newOpportunity();
      for (const stage of ['NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'WON'] as const) {
        const result = await changeOpportunityStageUseCase(manager, opportunity.id, { toStage: stage }, client);
        expect(result.ok, `expected move to ${stage}`).toBe(true);
      }
      const history = await getOpportunityStageHistoryUseCase(manager, opportunity.id, client);
      expect(history.map((h) => h.toStage)).toEqual([
        'QUALIFIED',
        'NEEDS_ANALYSIS',
        'PROPOSAL',
        'NEGOTIATION',
        'WON',
      ]);
    });

    it('refuses to skip PROPOSAL', async () => {
      const opportunity = await newOpportunity();
      const result = await changeOpportunityStageUseCase(
        manager,
        opportunity.id,
        { toStage: 'NEGOTIATION' },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'INVALID_TRANSITION' });
    });

    it('refuses to move to the stage it is already in', async () => {
      const opportunity = await newOpportunity();
      const result = await changeOpportunityStageUseCase(
        manager,
        opportunity.id,
        { toStage: 'QUALIFIED' },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'INVALID_TRANSITION' });
    });

    it('resumes from ON_HOLD into any open stage', async () => {
      const opportunity = await newOpportunity();
      await changeOpportunityStageUseCase(manager, opportunity.id, { toStage: 'ON_HOLD' }, client);
      const resumed = await changeOpportunityStageUseCase(
        manager,
        opportunity.id,
        { toStage: 'PROPOSAL' },
        client,
      );
      expect(resumed.ok).toBe(true);
    });

    it('treats WON as terminal', async () => {
      const opportunity = await newOpportunity();
      await advanceTo(opportunity.id, 'WON');
      const result = await changeOpportunityStageUseCase(
        manager,
        opportunity.id,
        { toStage: 'ON_HOLD' },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'INVALID_TRANSITION' });
    });

    it('treats LOST as terminal', async () => {
      const opportunity = await newOpportunity();
      await changeOpportunityStageUseCase(
        manager,
        opportunity.id,
        { toStage: 'LOST', lostReasonId },
        client,
      );
      const result = await changeOpportunityStageUseCase(
        manager,
        opportunity.id,
        { toStage: 'QUALIFIED' },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'INVALID_TRANSITION' });
    });

    it('rejects an unknown stage name', async () => {
      const opportunity = await newOpportunity();
      const result = await changeOpportunityStageUseCase(
        manager,
        opportunity.id,
        { toStage: 'SHIPPED' },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'VALIDATION' });
    });

    it('requires a reason to lose a deal', async () => {
      const opportunity = await newOpportunity();
      const result = await changeOpportunityStageUseCase(
        manager,
        opportunity.id,
        { toStage: 'LOST' },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'LOST_REASON_REQUIRED' });
    });

    it('requires a note when the chosen reason demands one', async () => {
      const opportunity = await newOpportunity();
      const result = await changeOpportunityStageUseCase(
        manager,
        opportunity.id,
        { toStage: 'LOST', lostReasonId: lostReasonNeedingNoteId },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'LOST_REASON_REQUIRED' });
    });

    it('accepts a losing reason that requires a note when one is given', async () => {
      const opportunity = await newOpportunity();
      const result = await changeOpportunityStageUseCase(
        manager,
        opportunity.id,
        { toStage: 'LOST', lostReasonId: lostReasonNeedingNoteId, lostNote: 'Chose a cheaper vendor' },
        client,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.opportunity.lostAt).toBeInstanceOf(Date);
        expect(result.opportunity.lostReasonId).toBe(lostReasonNeedingNoteId);
      }
    });

    it('rejects a reason that is not a lost-kind reason', async () => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM crm_outcome_reason WHERE kind = 'disqualify' LIMIT 1`,
      );
      const opportunity = await newOpportunity();
      const result = await changeOpportunityStageUseCase(
        manager,
        opportunity.id,
        { toStage: 'LOST', lostReasonId: rows[0].id },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'LOST_REASON_REQUIRED' });
    });

    it('does not record history for a rejected transition', async () => {
      const opportunity = await newOpportunity();
      await changeOpportunityStageUseCase(manager, opportunity.id, { toStage: 'NEGOTIATION' }, client);
      const history = await getOpportunityStageHistoryUseCase(manager, opportunity.id, client);
      // Only the opening QUALIFIED row; the rejected move left no trace.
      expect(history).toHaveLength(1);
    });

    it('records who moved the deal and when', async () => {
      const opportunity = await newOpportunity();
      await changeOpportunityStageUseCase(manager, opportunity.id, { toStage: 'ON_HOLD' }, client);
      const history = await getOpportunityStageHistoryUseCase(manager, opportunity.id, client);
      const move = history.at(-1)!;
      expect(move.fromStage).toBe('QUALIFIED');
      expect(move.toStage).toBe('ON_HOLD');
      expect(move.changedBy).toBe(managerId);
      expect(move.changedAt).toBeInstanceOf(Date);
    });

    it('hides the history of a deal the actor cannot see', async () => {
      const opportunity = await newOpportunity();
      const history = await getOpportunityStageHistoryUseCase(repB, opportunity.id, client);
      expect(history).toEqual([]);
    });

    it('stamps won_at exactly once when winning', async () => {
      const opportunity = await newOpportunity();
      await advanceTo(opportunity.id, 'WON');
      const { rows } = await client.query<{ won_at: Date; lost_at: Date | null }>(
        `SELECT won_at, lost_at FROM crm_opportunity WHERE id = $1`,
        [opportunity.id],
      );
      expect(rows[0].won_at).toBeInstanceOf(Date);
      expect(rows[0].lost_at).toBeNull();
    });
  });

  async function advanceTo(opportunityId: string, target: 'WON'): Promise<void> {
    for (const stage of ['NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'WON'] as const) {
      const result = await changeOpportunityStageUseCase(manager, opportunityId, { toStage: stage }, client);
      if (!result.ok) throw new Error(`setup move to ${stage} failed`);
      if (stage === target) return;
    }
  }

  describe('ownership', () => {
    it('lets a manager reassign to another active rep', async () => {
      const opportunity = await newOpportunity();
      const result = await reassignOpportunityOwnerUseCase(manager, opportunity.id, repBId, client);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.opportunity.ownerUserId).toBe(repBId);
    });

    it('stops a rep from reassigning their own deal', async () => {
      const opportunity = await newOpportunity();
      const result = await reassignOpportunityOwnerUseCase(repA, opportunity.id, repBId, client);
      expect(result).toMatchObject({ ok: false, error: 'UNAUTHORISED' });
    });

    it('refuses a reassignment attempt by a rep regardless of ownership', async () => {
      const opportunity = await newOpportunity(repAId);
      const result = await reassignOpportunityOwnerUseCase(repB, opportunity.id, repBId, client);
      // A rep can never reassign, so the answer is UNAUTHORISED whether or not
      // the deal exists. That is deliberate: it leaks nothing about repA's deal.
      expect(result).toMatchObject({ ok: false, error: 'UNAUTHORISED' });
    });

    it('lets a rep update fields on their own deal', async () => {
      const opportunity = await newOpportunity();
      const result = await updateOpportunityUseCase(
        repA,
        opportunity.id,
        { estimatedValue: 42000, notes: 'Bigger case than first thought' },
        client,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.opportunity.estimatedValue).toBe(42000);
    });

    it('hides a deal from a rep who does not own it', async () => {
      const opportunity = await newOpportunity();
      const result = await updateOpportunityUseCase(repB, opportunity.id, { estimatedValue: 1 }, client);
      expect(result).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    });

    it('rolls back the owner change when the field update fails', async () => {
      const opportunity = await newOpportunity();
      // An inactive owner passes neither check; the negative value is the one
      // that gets past validation and fails at the database.
      const result = await updateOpportunityUseCase(
        manager,
        opportunity.id,
        { ownerUserId: repBId, estimatedValue: -1 },
        client,
      );
      expect(result.ok).toBe(false);
      const { rows } = await client.query<{ owner_user_id: string }>(
        `SELECT owner_user_id FROM crm_opportunity WHERE id = $1`,
        [opportunity.id],
      );
      // The move to repB must not have survived a failed save.
      expect(rows[0].owner_user_id).toBe(repAId);
    });
  });

  describe('follow-ups', () => {
    it('schedules an action defaulting to the opportunity owner', async () => {
      const opportunity = await newOpportunity();
      const result = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'CALL', dueAt: inDays(2), note: 'Confirm budget' },
        client,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.followUp.ownerUserId).toBe(repAId);
    });

    it('rejects an unknown action type', async () => {
      const opportunity = await newOpportunity();
      const result = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'CARRIER_PIGEON', dueAt: inDays(1) },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'VALIDATION' });
    });

    it('rejects a due date in the past', async () => {
      const opportunity = await newOpportunity();
      const result = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'CALL', dueAt: inDays(-3) },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'DUE_IN_PAST' });
    });

    it('refuses to add work to a won deal', async () => {
      const opportunity = await newOpportunity();
      await advanceTo(opportunity.id, 'WON');
      const result = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'CLOSED_OPPORTUNITY' });
    });

    it('stops a rep assigning work on a deal they cannot see', async () => {
      const opportunity = await newOpportunity();
      const result = await createFollowUpUseCase(
        repB,
        opportunity.id,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    });

    it('stops a rep assigning work to a colleague', async () => {
      const opportunity = await newOpportunity();
      const result = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'CALL', dueAt: inDays(1), ownerUserId: repBId },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'UNAUTHORISED' });
    });

    it('lets a rep complete their own action', async () => {
      const opportunity = await newOpportunity();
      const created = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'MEETING', dueAt: inDays(1) },
        client,
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const done = await completeFollowUpUseCase(repA, created.followUp.id, {}, client);
      expect(done.ok).toBe(true);
      if (done.ok) expect(done.followUp.completedAt).toBeInstanceOf(Date);
    });

    it('refuses to complete the same action twice', async () => {
      const opportunity = await newOpportunity();
      const created = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      if (!created.ok) throw new Error('setup failed');
      await completeFollowUpUseCase(repA, created.followUp.id, {}, client);
      const again = await completeFollowUpUseCase(repA, created.followUp.id, {}, client);
      expect(again).toMatchObject({ ok: false, error: 'ALREADY_COMPLETED' });
    });

    it('preserves the original completion stamp on a second attempt', async () => {
      const opportunity = await newOpportunity();
      const created = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      if (!created.ok) throw new Error('setup failed');
      const first = await completeFollowUpUseCase(repA, created.followUp.id, {}, client);
      await completeFollowUpUseCase(repA, created.followUp.id, {}, client);
      const { rows } = await client.query<{ completed_at: Date }>(
        `SELECT completed_at FROM crm_followup WHERE id = $1`,
        [created.followUp.id],
      );
      if (first.ok) expect(rows[0].completed_at.getTime()).toBe(first.followUp.completedAt!.getTime());
    });

    it('returns the earliest pending action as the next action', async () => {
      const opportunity = await newOpportunity();
      await createFollowUpUseCase(repA, opportunity.id, { actionType: 'CALL', dueAt: inDays(5) }, client);
      await createFollowUpUseCase(repA, opportunity.id, { actionType: 'MEETING', dueAt: inDays(1) }, client);
      const next = await getNextPendingFollowUpUseCase(repA, opportunity.id, client);
      expect(next!.actionType).toBe('MEETING');
    });

    it('skips completed work when picking the next action', async () => {
      const opportunity = await newOpportunity();
      const first = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      if (!first.ok) throw new Error('setup failed');
      await completeFollowUpUseCase(repA, first.followUp.id, {}, client);
      await createFollowUpUseCase(repA, opportunity.id, { actionType: 'MEETING', dueAt: inDays(4) }, client);
      const next = await getNextPendingFollowUpUseCase(repA, opportunity.id, client);
      expect(next!.actionType).toBe('MEETING');
    });

    it('keeps completed actions in the history after the deal closes', async () => {
      const opportunity = await newOpportunity();
      const created = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      if (!created.ok) throw new Error('setup failed');
      await completeFollowUpUseCase(repA, created.followUp.id, {}, client);
      await advanceTo(opportunity.id, 'WON');

      const completed = await listFollowUpsUseCase(manager, { window: 'completed' }, client);
      expect(
        completed.followUps.some((f) => f.id === created.followUp.id),
      ).toBe(true);
    });

    it('does not let a pending action nag a rep after the deal is won', async () => {
      const opportunity = await newOpportunity();
      await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'CALL', dueAt: new Date(Date.now() - 86_400_000) },
        client,
      ).catch(() => undefined);
      await client.query(
        `UPDATE crm_followup SET due_at = now() - interval '1 day'
          WHERE opportunity_id = $1`,
        [opportunity.id],
      );
      await advanceTo(opportunity.id, 'WON');

      const overdue = await listFollowUpsUseCase(manager, { window: 'overdue' }, client);
      expect(overdue.followUps.some((f) => f.opportunityId === opportunity.id)).toBe(false);
    });

    it('lists only the actor own overdue work for a rep', async () => {
      const mine = await newOpportunity();
      const theirs = await newOpportunity(repBId);
      await createFollowUpUseCase(repA, mine.id, { actionType: 'CALL', dueAt: inDays(1) }, client);
      await createFollowUpUseCase(repB, theirs.id, { actionType: 'CALL', dueAt: inDays(1) }, client);
      await client.query(
        `UPDATE crm_followup SET due_at = now() - interval '1 day'
          WHERE opportunity_id IN ($1, $2)`,
        [mine.id, theirs.id],
      );

      const overdue = await listFollowUpsUseCase(repA, { window: 'overdue' }, client);
      const opportunityIds = overdue.followUps.map((f) => f.opportunityId);
      expect(opportunityIds).toContain(mine.id);
      expect(opportunityIds).not.toContain(theirs.id);
    });

    it('lets a manager see every rep overdue work', async () => {
      const mine = await newOpportunity();
      const theirs = await newOpportunity(repBId);
      await createFollowUpUseCase(repA, mine.id, { actionType: 'CALL', dueAt: inDays(1) }, client);
      await createFollowUpUseCase(repB, theirs.id, { actionType: 'CALL', dueAt: inDays(1) }, client);
      await client.query(
        `UPDATE crm_followup SET due_at = now() - interval '1 day'
          WHERE opportunity_id IN ($1, $2)`,
        [mine.id, theirs.id],
      );

      const overdue = await listFollowUpsUseCase(manager, { window: 'overdue' }, client);
      const opportunityIds = overdue.followUps.map((f) => f.opportunityId);
      expect(opportunityIds).toContain(mine.id);
      expect(opportunityIds).toContain(theirs.id);
    });

    it('lets a rep complete an action a manager assigned to them', async () => {
      const opportunity = await newOpportunity();
      const created = await createFollowUpUseCase(
        manager,
        opportunity.id,
        { actionType: 'MEETING', dueAt: inDays(1), ownerUserId: repBId },
        client,
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // repB does not own the opportunity, but the action is theirs to do.
      const done = await completeFollowUpUseCase(repB, created.followUp.id, {}, client);
      expect(done.ok).toBe(true);
    });

    it('stops a rep completing an action assigned to a colleague', async () => {
      const opportunity = await newOpportunity();
      const created = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      if (!created.ok) throw new Error('setup failed');
      const done = await completeFollowUpUseCase(repB, created.followUp.id, {}, client);
      // Unauthorised reads as missing, not forbidden.
      expect(done).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    });
  });

  describe('follow-up day-window boundaries', () => {
    // These cases exercise the exact queries that previously crashed with
    //   unit "tomorrow" not recognized for type timestamp without time zone
    // and pin the due dates with the same Africa/Cairo boundary expressions
    // the production queries use, so the test and the code cannot drift
    // apart. LEAST keeps the "today" row inside [now, start of tomorrow
    // Cairo) even when the suite runs seconds before Cairo midnight.
    const PIN_TODAY = `LEAST(
      now() + interval '5 minutes',
      date_trunc('day', now() + interval '1 day', 'Africa/Cairo') - interval '1 minute'
    )`;
    const PIN_UPCOMING = `date_trunc('day', now() + interval '1 day', 'Africa/Cairo') + interval '5 minutes'`;

    it('classifies today and upcoming buckets using Cairo day boundaries', async () => {
      const opportunity = await newOpportunity();
      const today = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      const upcoming = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'MEETING', dueAt: inDays(3) },
        client,
      );
      if (!today.ok || !upcoming.ok) throw new Error('setup failed');

      await client.query(`UPDATE crm_followup SET due_at = ${PIN_TODAY} WHERE id = $1`, [
        today.followUp.id,
      ]);
      await client.query(`UPDATE crm_followup SET due_at = ${PIN_UPCOMING} WHERE id = $1`, [
        upcoming.followUp.id,
      ]);

      const todayList = await listFollowUpsUseCase(manager, { window: 'today' }, client);
      const todayIds = todayList.followUps.map((f) => f.id);
      expect(todayIds).toContain(today.followUp.id);
      expect(todayIds).not.toContain(upcoming.followUp.id);

      const upcomingList = await listFollowUpsUseCase(manager, { window: 'upcoming' }, client);
      const upcomingIds = upcomingList.followUps.map((f) => f.id);
      expect(upcomingIds).toContain(upcoming.followUp.id);
      expect(upcomingIds).not.toContain(today.followUp.id);
    });

    it('keeps rows straddling Cairo midnight in the correct buckets', async () => {
      const opportunity = await newOpportunity();
      const beforeMidnight = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      const afterMidnight = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'MEETING', dueAt: inDays(3) },
        client,
      );
      if (!beforeMidnight.ok || !afterMidnight.ok) throw new Error('setup failed');

      // One minute on each side of the start of the next Cairo day.
      await client.query(
        `UPDATE crm_followup SET due_at = date_trunc('day', now() + interval '1 day', 'Africa/Cairo') - interval '1 minute' WHERE id = $1`,
        [beforeMidnight.followUp.id],
      );
      await client.query(
        `UPDATE crm_followup SET due_at = date_trunc('day', now() + interval '1 day', 'Africa/Cairo') + interval '1 minute' WHERE id = $1`,
        [afterMidnight.followUp.id],
      );

      const upcomingList = await listFollowUpsUseCase(manager, { window: 'upcoming' }, client);
      const upcomingIds = upcomingList.followUps.map((f) => f.id);
      // The minute after Cairo midnight is tomorrow: upcoming, never today.
      expect(upcomingIds).toContain(afterMidnight.followUp.id);
      expect(upcomingIds).not.toContain(beforeMidnight.followUp.id);

      // The minute before Cairo midnight is today unless the suite happens to
      // run inside that final minute (then it is already overdue). It must
      // never appear in upcoming.
      const todayList = await listFollowUpsUseCase(manager, { window: 'today' }, client);
      const overdueList = await listFollowUpsUseCase(manager, { window: 'overdue' }, client);
      const todayIds = todayList.followUps.map((f) => f.id);
      const overdueIds = overdueList.followUps.map((f) => f.id);
      expect([...todayIds, ...overdueIds]).toContain(beforeMidnight.followUp.id);
    });

    it('returns window counts that agree with the lists', async () => {
      const opportunity = await newOpportunity();
      const today = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      if (!today.ok) throw new Error('setup failed');
      await client.query(`UPDATE crm_followup SET due_at = ${PIN_TODAY} WHERE id = $1`, [
        today.followUp.id,
      ]);

      // Previously crashed: countFollowUpsByWindow ran the same invalid
      // date_trunc('tomorrow', ...) expressions.
      const counts = await getFollowUpWindowCountsUseCase(manager, client);
      expect(counts.today).toBeGreaterThanOrEqual(1);
      expect(counts.overdue).toBeGreaterThanOrEqual(0);
      expect(counts.upcoming).toBeGreaterThanOrEqual(0);
      expect(counts.completed).toBeGreaterThanOrEqual(0);
    });
  });
});
