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
import { uniqueToken } from './setup/db';

/**
 * Schema-level guarantees for Slice 2B.
 *
 * These assert the DATABASE refuses bad state, not that the repository politely
 * asks first. Each case names the exact constraint it expects, because a test
 * that merely "rejects toThrow" can pass because of an unrelated failure - here
 * most easily the UNIQUE on lead_id, since every case needs its own lead.
 */
describe('crm_opportunity / crm_followup schema', () => {
  let database: DisposableDatabase;
  let client: Client;

  let ownerId: string;
  let contactId: string;
  let categoryId: string;
  let sourceId: string;
  let lostReasonId: string;

  /** A fresh lead per opportunity: crm_opportunity.lead_id is UNIQUE. */
  async function newLead(): Promise<string> {
    const lead = await createLead(client, {
      sourceId,
      campaignId: null,
      contactId,
      accountId: null,
      productCategoryId: categoryId,
      note: null,
      ownerUserId: ownerId,
    });
    return lead.id;
  }

  async function insertOpportunity(overrides: Record<string, unknown> = {}) {
    const row = {
      lead_id: await newLead(),
      contact_id: contactId,
      owner_user_id: ownerId,
      product_category_id: null,
      stage: 'QUALIFIED',
      estimated_value: null,
      notes: null,
      won_at: null,
      lost_at: null,
      lost_reason_id: null,
      ...overrides,
    };
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO crm_opportunity
         (lead_id, contact_id, owner_user_id, product_category_id, stage, estimated_value,
          notes, won_at, lost_at, lost_reason_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        row.lead_id,
        row.contact_id,
        row.owner_user_id,
        row.product_category_id,
        row.stage,
        row.estimated_value,
        row.notes,
        row.won_at,
        row.lost_at,
        row.lost_reason_id,
      ],
    );
    return rows[0].id;
  }

  /** Assert the specific constraint fired, not merely that something threw. */
  async function expectConstraint(constraint: string, work: Promise<unknown>) {
    const error = await work.then(
      () => null,
      (err: unknown) => err,
    );
    expect(error, `expected constraint ${constraint} to be violated`).not.toBeNull();
    expect(String((error as { constraint?: string }).constraint ?? '')).toBe(constraint);
  }

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);

    ownerId = (
      await createUser(client, {
        displayName: 'Schema Owner',
        email: uniqueToken('schema') + '@test.com',
        password: 'Password123!',
        role: 'SALES_REP',
      })
    ).id;

    categoryId = (
      await createProductCategory(client, {
        code: uniqueToken('cat'),
        name: 'Schema Category',
      })
    ).id;

    contactId = (await createContact(client, { fullName: 'Schema Contact' })).id;

    const { rows: sourceRows } = await client.query<{ id: string }>(
      `SELECT id FROM crm_source WHERE code = 'website'`,
    );
    sourceId = sourceRows[0].id;

    const { rows: reasonRows } = await client.query<{ id: string }>(
      `SELECT id FROM crm_outcome_reason WHERE kind = 'lost' AND code = 'no_budget'`,
    );
    lostReasonId = reasonRows[0].id;
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  describe('crm_opportunity', () => {
    it('rejects an unknown stage', async () => {
      await expectConstraint('crm_opportunity_stage_known', insertOpportunity({ stage: 'SHIPPED' }));
    });

    it('accepts every stage in the pipeline vocabulary', async () => {
      // WON / LOST additionally need their outcome stamps, so they are inserted
      // in their valid shape below rather than bare.
      for (const stage of ['QUALIFIED', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'ON_HOLD']) {
        await expect(insertOpportunity({ stage })).resolves.toEqual(expect.any(String));
      }
    });

    it('rejects a second opportunity for the same lead', async () => {
      const leadId = await newLead();
      await insertOpportunity({ lead_id: leadId });
      // The UNIQUE on lead_id is the arbiter, not a courtesy check upstream.
      await expectConstraint('crm_opportunity_lead_id_key', insertOpportunity({ lead_id: leadId }));
    });

    it('rejects a negative estimated value', async () => {
      await expectConstraint(
        'crm_opportunity_estimated_value_non_negative',
        insertOpportunity({ estimated_value: -1 }),
      );
    });

    it('rejects a WON stage with no won_at', async () => {
      await expectConstraint('crm_opportunity_won_at_agrees', insertOpportunity({ stage: 'WON' }));
    });

    it('rejects a LOST stage with no lost_at', async () => {
      await expectConstraint('crm_opportunity_lost_at_agrees', insertOpportunity({ stage: 'LOST' }));
    });

    it('rejects a LOST stage carrying no reason', async () => {
      await expectConstraint(
        'crm_opportunity_lost_reason_agrees',
        insertOpportunity({ stage: 'LOST', lost_at: new Date() }),
      );
    });

    it('accepts a fully-formed WON opportunity', async () => {
      const opportunityId = await insertOpportunity({ stage: 'WON', won_at: new Date() });
      const { rows } = await client.query<{ won_at: Date | null; lost_at: Date | null }>(
        `SELECT won_at, lost_at FROM crm_opportunity WHERE id = $1`,
        [opportunityId],
      );
      expect(rows[0].won_at).toBeInstanceOf(Date);
      expect(rows[0].lost_at).toBeNull();
    });

    it('refuses to leave a WON deal carrying a lost reason', async () => {
      const opportunityId = await insertOpportunity({ stage: 'WON', won_at: new Date() });
      await expectConstraint(
        'crm_opportunity_lost_reason_agrees',
        client.query(`UPDATE crm_opportunity SET lost_reason_id = $2 WHERE id = $1`, [
          opportunityId,
          lostReasonId,
        ]),
      );
    });

    it('refuses to keep won_at on a deal that is no longer WON', async () => {
      const opportunityId = await insertOpportunity({ stage: 'WON', won_at: new Date() });
      // Clearing the stage while won_at survives would misrepresent the history.
      await expectConstraint(
        'crm_opportunity_won_at_agrees',
        client.query(`UPDATE crm_opportunity SET stage = 'NEGOTIATION' WHERE id = $1`, [
          opportunityId,
        ]),
      );
    });

    it('records a LOST opportunity with its reason', async () => {
      const opportunityId = await insertOpportunity({
        stage: 'LOST',
        lost_at: new Date(),
        lost_reason_id: lostReasonId,
      });
      const { rows } = await client.query<{ lost_reason_id: string; lost_at: Date | null }>(
        `SELECT lost_reason_id, lost_at FROM crm_opportunity WHERE id = $1`,
        [opportunityId],
      );
      expect(rows[0].lost_reason_id).toBe(lostReasonId);
      expect(rows[0].lost_at).toBeInstanceOf(Date);
    });

    it('rejects a lost_at stamped without losing the deal', async () => {
      const opportunityId = await insertOpportunity();
      await expectConstraint(
        'crm_opportunity_lost_at_agrees',
        client.query(`UPDATE crm_opportunity SET lost_at = now() WHERE id = $1`, [opportunityId]),
      );
    });

    it('rejects notes longer than 5000 characters', async () => {
      await expectConstraint('crm_opportunity_notes_len', insertOpportunity({ notes: 'x'.repeat(5001) }));
    });

    it('rejects blank notes rather than storing empty whitespace', async () => {
      await expectConstraint('crm_opportunity_notes_len', insertOpportunity({ notes: '   ' }));
    });

    it('rejects a lead that does not exist', async () => {
      await expectConstraint(
        'crm_opportunity_lead_id_fkey',
        insertOpportunity({ lead_id: '00000000-0000-0000-0000-000000000000' }),
      );
    });
  });

  describe('crm_followup', () => {
    let opportunityId: string;

    beforeAll(async () => {
      opportunityId = await insertOpportunity();
    });

    async function insertFollowUp(overrides: Record<string, unknown> = {}) {
      const row = {
        opportunity_id: opportunityId,
        owner_user_id: ownerId,
        action_type: 'CALL',
        note: null,
        due_at: new Date(Date.now() + 3_600_000),
        completed_at: null,
        ...overrides,
      };
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO crm_followup
           (opportunity_id, owner_user_id, action_type, note, due_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          row.opportunity_id,
          row.owner_user_id,
          row.action_type,
          row.note,
          row.due_at,
          row.completed_at,
        ],
      );
      return rows[0].id;
    }

    it('rejects an unknown action type', async () => {
      await expectConstraint(
        'crm_followup_action_type_known',
        insertFollowUp({ action_type: 'TELEPATHY' }),
      );
    });

    it('accepts every configured action type', async () => {
      for (const actionType of [
        'CALL',
        'WHATSAPP',
        'MEETING',
        'SEND_QUOTATION',
        'FOLLOW_UP',
        'OTHER',
      ]) {
        const id = await insertFollowUp({ action_type: actionType });
        const { rows } = await client.query<{ action_type: string }>(
          `SELECT action_type FROM crm_followup WHERE id = $1`,
          [id],
        );
        expect(rows[0].action_type).toBe(actionType);
      }
    });

    it('rejects a completion stamped before the row was created', async () => {
      await expectConstraint(
        'crm_followup_completed_at_not_future',
        insertFollowUp({ completed_at: new Date(Date.now() - 7_200_000) }),
      );
    });

    it('rejects notes longer than 5000 characters', async () => {
      await expectConstraint('crm_followup_note_len', insertFollowUp({ note: 'y'.repeat(5001) }));
    });

    it('keeps a completed follow-up row rather than requiring its absence', async () => {
      const followUpId = await insertFollowUp();
      await client.query(`UPDATE crm_followup SET completed_at = now() WHERE id = $1`, [followUpId]);

      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM crm_followup WHERE id = $1`,
        [followUpId],
      );
      // History is preserved by design: completion stamps, it never deletes.
      expect(rows[0].count).toBe('1');
    });

    it('refuses to delete a follow-up through the opportunity foreign key', async () => {
      // ON DELETE RESTRICT means cleaning up an opportunity cannot silently take
      // its activity with it.
      await expectConstraint(
        'crm_followup_opportunity_id_fkey',
        client.query(`DELETE FROM crm_opportunity WHERE id = $1`, [opportunityId]),
      );
    });

    it('rejects a follow-up for an opportunity that does not exist', async () => {
      await expectConstraint(
        'crm_followup_opportunity_id_fkey',
        insertFollowUp({ opportunity_id: '00000000-0000-0000-0000-000000000000' }),
      );
    });
  });
});
