/**
 * Daily Sales Reliability V1.
 *
 * Four guarantees this slice adds on top of the existing opportunity work:
 *   1. a promise can be attached to a lead, before it is commercial work;
 *   2. completing an action captures what actually happened;
 *   3. the phone behind a deal is one tap away on both workspaces;
 *   4. outstanding work follows its owner when the owner changes.
 *
 * These are integration tests against a real Postgres database, because every
 * one of the four is fundamentally about rows moving between tables under a
 * transaction.
 */
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
import { createProductCategory } from '../../src/server/crm/catalog/repository';
import { createLead } from '../../src/server/crm/leads/repository';
import { updateLeadUseCase } from '../../src/server/crm/leads/service';
import {
  qualifyLeadUseCase,
  createFollowUpUseCase,
  createLeadFollowUpUseCase,
  completeFollowUpUseCase,
  listFollowUpsUseCase,
  listOpportunityFollowUpsUseCase,
  listLeadFollowUpsUseCase,
  reassignOpportunityOwnerUseCase,
  getOpportunityActivityUseCase,
  type Actor,
} from '../../src/server/crm/opportunities/service';
import { findOpportunityDetailById } from '../../src/server/crm/opportunities/repository';
import { createQuotationUseCase } from '../../src/server/crm/quotations/service';
import { findQuotationDetailById } from '../../src/server/crm/quotations/repository';
import { uniqueToken } from './setup/db';

const REP: Actor['role'] = 'SALES_REP';
const MANAGER: Actor['role'] = 'SALES_MANAGER';

describe('daily sales reliability (lead follow-ups, outcomes, phone, hand-off)', () => {
  let database: DisposableDatabase;
  let client: Client;

  let repAId: string;
  let repBId: string;
  let managerId: string;
  let adminId: string;
  let contactId: string;
  let categoryId: string;
  let sourceId: string;
  let disqualifyReasonId: string;

  const repA: Actor = { userId: '', role: REP };
  const repB: Actor = { userId: '', role: REP };
  const manager: Actor = { userId: '', role: MANAGER };
  const admin: Actor = { userId: '', role: 'ADMIN' };

  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

  async function newLead(ownerUserId: string, contact = contactId): Promise<string> {
    const lead = await createLead(client, {
      sourceId,
      campaignId: null,
      contactId: contact,
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

    const { rows: reasonRows } = await client.query<{ id: string }>(
      `SELECT id FROM crm_outcome_reason WHERE kind = 'disqualify' AND code = 'spam'`,
    );
    disqualifyReasonId = reasonRows[0].id;
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  describe('lead-level follow-ups', () => {
    it('schedules a next action on a lead, before it is commercial work', async () => {
      const leadId = await newLead(repAId);
      const result = await createLeadFollowUpUseCase(
        repA,
        leadId,
        { actionType: 'CALL', dueAt: inDays(2), note: 'Ring back about the consultation' },
        client,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.followUp.leadId).toBe(leadId);
      expect(result.followUp.opportunityId).toBeNull();
      expect(result.followUp.ownerUserId).toBe(repAId);
    });

    it('surfaces a lead promise in the owner queue, tagged as a lead parent', async () => {
      const leadId = await newLead(repAId);
      const created = await createLeadFollowUpUseCase(
        repA,
        leadId,
        { actionType: 'WHATSAPP', dueAt: inDays(3) },
        client,
      );
      if (!created.ok) throw new Error('setup failed');

      const queue = await listFollowUpsUseCase(repA, { window: 'upcoming' }, client);
      const row = queue.followUps.find((entry) => entry.id === created.followUp.id);
      expect(row).toBeDefined();
      expect(row!.parentKind).toBe('lead');
      expect(row!.contactName).toBe('Patient Contact');
    });

    it('keeps one rep’s lead promises out of another rep’s queue', async () => {
      const leadId = await newLead(repAId);
      const created = await createLeadFollowUpUseCase(
        repA,
        leadId,
        { actionType: 'CALL', dueAt: inDays(3) },
        client,
      );
      if (!created.ok) throw new Error('setup failed');

      const queue = await listFollowUpsUseCase(repB, { window: 'upcoming' }, client);
      expect(queue.followUps.find((entry) => entry.id === created.followUp.id)).toBeUndefined();
    });

    it('refuses to schedule against a disqualified lead', async () => {
      const leadId = await newLead(repAId);
      await client.query(
        `UPDATE crm_lead
            SET status = 'DISQUALIFIED', disqualified_at = now(), disqualify_reason_id = $2
          WHERE id = $1`,
        [leadId, disqualifyReasonId],
      );
      const result = await createLeadFollowUpUseCase(
        repA,
        leadId,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'LEAD_NOT_SCHEDULABLE' });
    });

    it('refuses to schedule against an archived lead', async () => {
      const leadId = await newLead(repAId);
      await client.query(
        `UPDATE crm_lead SET archived_at = now(), archived_by_user_id = $2 WHERE id = $1`,
        [leadId, repBId],
      );
      const result = await createLeadFollowUpUseCase(
        repA,
        leadId,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'LEAD_NOT_SCHEDULABLE' });
    });

    it('hides another rep’s lead as not found, not forbidden', async () => {
      const leadId = await newLead(repAId);
      const result = await createLeadFollowUpUseCase(
        repB,
        leadId,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    });

    it('lets a manager schedule work for a rep on the rep’s lead', async () => {
      const leadId = await newLead(repAId);
      const result = await createLeadFollowUpUseCase(
        manager,
        leadId,
        { actionType: 'CALL', dueAt: inDays(1), ownerUserId: repBId },
        client,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.followUp.ownerUserId).toBe(repBId);
    });

    it('rejects an unknown action type and a past due date', async () => {
      const leadId = await newLead(repAId);
      const badType = await createLeadFollowUpUseCase(
        repA,
        leadId,
        { actionType: 'CARRIER_PIGEON', dueAt: inDays(1) },
        client,
      );
      expect(badType).toMatchObject({ ok: false, error: 'VALIDATION' });

      const past = await createLeadFollowUpUseCase(
        repA,
        leadId,
        { actionType: 'CALL', dueAt: inDays(-2) },
        client,
      );
      expect(past).toMatchObject({ ok: false, error: 'DUE_IN_PAST' });
    });
  });

  describe('completion captures the outcome', () => {
    it('requires a non-empty outcome', async () => {
      const leadId = await newLead(repAId);
      const created = await createLeadFollowUpUseCase(
        repA,
        leadId,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      if (!created.ok) throw new Error('setup failed');

      const blank = await completeFollowUpUseCase(repA, created.followUp.id, {}, client);
      expect(blank).toMatchObject({ ok: false, error: 'VALIDATION' });

      const whitespace = await completeFollowUpUseCase(
        repA,
        created.followUp.id,
        { completionNote: '   ' },
        client,
      );
      expect(whitespace).toMatchObject({ ok: false, error: 'VALIDATION' });
    });

    it('appends the outcome to the plan note rather than replacing it', async () => {
      const leadId = await newLead(repAId);
      const created = await createLeadFollowUpUseCase(
        repA,
        leadId,
        { actionType: 'CALL', dueAt: inDays(1), note: 'Confirm the implant budget' },
        client,
      );
      if (!created.ok) throw new Error('setup failed');

      const done = await completeFollowUpUseCase(
        repA,
        created.followUp.id,
        { completionNote: 'Budget approved, sending a quote' },
        client,
      );
      expect(done.ok).toBe(true);
      if (done.ok) {
        expect(done.followUp.note).toContain('Confirm the implant budget');
        expect(done.followUp.note).toContain('Budget approved, sending a quote');
      }
    });

    it('keeps the outcome when the action never had a plan note', async () => {
      const leadId = await newLead(repAId);
      const created = await createLeadFollowUpUseCase(
        repA,
        leadId,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      if (!created.ok) throw new Error('setup failed');
      expect(created.followUp.note).toBeNull();

      const done = await completeFollowUpUseCase(
        repA,
        created.followUp.id,
        { completionNote: 'Left a voicemail, will retry tomorrow' },
        client,
      );
      expect(done.ok).toBe(true);
      if (done.ok) expect(done.followUp.note).toBe('Left a voicemail, will retry tomorrow');
    });
  });

  describe('qualification carries pending work forward', () => {
    it('moves a pending lead promise onto the new opportunity and leaves history behind', async () => {
      const leadId = await newLead(repAId);

      const pending = await createLeadFollowUpUseCase(
        repA,
        leadId,
        { actionType: 'MEETING', dueAt: inDays(4), note: 'Site visit' },
        client,
      );
      const closed = await createLeadFollowUpUseCase(
        repA,
        leadId,
        { actionType: 'CALL', dueAt: inDays(1), note: 'First contact' },
        client,
      );
      if (!pending.ok || !closed.ok) throw new Error('setup failed');
      await completeFollowUpUseCase(
        repA,
        closed.followUp.id,
        { completionNote: 'No answer' },
        client,
      );

      const result = await qualifyLeadUseCase(manager, leadId, {}, client);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const opportunityId = result.opportunity.id;

      const onLead = await listLeadFollowUpsUseCase(repA, leadId, client);
      expect(onLead.map((f) => f.id)).toContain(closed.followUp.id);
      expect(onLead.map((f) => f.id)).not.toContain(pending.followUp.id);

      const onOpportunity = await listOpportunityFollowUpsUseCase(repA, opportunityId, client);
      const moved = onOpportunity.find((f) => f.id === pending.followUp.id);
      expect(moved).toBeDefined();
      expect(moved!.opportunityId).toBe(opportunityId);
      expect(moved!.leadId).toBeNull();
    });

    it('records a FOLLOW_UP_MOVED entry on the opportunity timeline', async () => {
      const leadId = await newLead(repAId);
      const created = await createLeadFollowUpUseCase(
        repA,
        leadId,
        { actionType: 'CALL', dueAt: inDays(3) },
        client,
      );
      if (!created.ok) throw new Error('setup failed');

      const result = await qualifyLeadUseCase(manager, leadId, {}, client);
      if (!result.ok) throw new Error('setup failed');

      const activity = await getOpportunityActivityUseCase(repA, result.opportunity.id, client);
      expect(activity.some((entry) => entry.activityType === 'FOLLOW_UP_MOVED')).toBe(true);
    });
  });

  describe('owner reassignment hands over outstanding work', () => {
    it('moves pending opportunity follow-ups to the new owner and leaves completed ones', async () => {
      const opportunity = await newOpportunity(repAId);

      const pending = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'CALL', dueAt: inDays(3), note: 'Ongoing' },
        client,
      );
      const done = await createFollowUpUseCase(
        repA,
        opportunity.id,
        { actionType: 'MEETING', dueAt: inDays(1), note: 'Done' },
        client,
      );
      if (!pending.ok || !done.ok) throw new Error('setup failed');
      await completeFollowUpUseCase(repA, done.followUp.id, { completionNote: 'Held' }, client);

      const reassigned = await reassignOpportunityOwnerUseCase(
        manager,
        opportunity.id,
        repBId,
        client,
      );
      expect(reassigned.ok).toBe(true);

      const rows = await client.query<{ id: string; owner_user_id: string }>(
        `SELECT id, owner_user_id FROM crm_followup WHERE opportunity_id = $1`,
        [opportunity.id],
      );
      const byId = new Map(rows.rows.map((row) => [row.id, row.owner_user_id]));
      expect(byId.get(pending.followUp.id)).toBe(repBId);
      expect(byId.get(done.followUp.id)).toBe(repAId);
    });

    it('moves pending lead follow-ups when a lead is reassigned', async () => {
      const leadId = await newLead(repAId);
      const created = await createLeadFollowUpUseCase(
        repA,
        leadId,
        { actionType: 'CALL', dueAt: inDays(2) },
        client,
      );
      if (!created.ok) throw new Error('setup failed');

      const updated = await updateLeadUseCase(manager, leadId, { ownerUserId: repBId }, client);
      expect(updated.ok).toBe(true);

      const rows = await client.query<{ owner_user_id: string }>(
        `SELECT owner_user_id FROM crm_followup WHERE id = $1`,
        [created.followUp.id],
      );
      expect(rows.rows[0].owner_user_id).toBe(repBId);
    });
  });

  describe('phone and WhatsApp visibility', () => {
    let phoneContactId: string;
    let phoneOpportunityId: string;

    beforeAll(async () => {
      phoneContactId = (
        await createContact(client, {
          fullName: 'Reachable Doctor',
          email: uniqueToken('phone') + '@clinic.test',
        })
      ).id;
      await client.query(
        `INSERT INTO crm_contact_channel (contact_id, channel_type, value, is_whatsapp)
         VALUES ($1, 'PHONE', '+201001234567', true)`,
        [phoneContactId],
      );

      const leadId = await newLead(repAId, phoneContactId);
      const result = await qualifyLeadUseCase(manager, leadId, {}, client);
      if (!result.ok) throw new Error('setup failed');
      phoneOpportunityId = result.opportunity.id;
    });

    it('exposes the contact phone and its WhatsApp capability on the opportunity', async () => {
      const detail = await findOpportunityDetailById(client, phoneOpportunityId, repA);
      expect(detail!.contactPhone).toBe('+201001234567');
      expect(detail!.contactPhoneIsWhatsApp).toBe(true);
    });

    it('exposes the same phone on the quotation workspace', async () => {
      const created = await createQuotationUseCase(
        manager,
        phoneOpportunityId,
        { items: [{ description: 'Dental unit', quantity: 1, unitPrice: 120000 }] },
        client,
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const detail = await findQuotationDetailById(client, created.quotation.id, manager);
      expect(detail!.contactPhone).toBe('+201001234567');
      expect(detail!.contactPhoneIsWhatsApp).toBe(true);
    });
  });
});
