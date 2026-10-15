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
import { createLead } from '../../src/server/crm/leads/repository';
import {
  qualifyLeadUseCase,
  changeOpportunityStageUseCase,
  getOpportunityActivityUseCase,
  type Actor,
} from '../../src/server/crm/opportunities/service';
import {
  createQuotationUseCase,
  getQuotationUseCase,
  listQuotationsUseCase,
  listQuotationSnapshotsUseCase,
  reviseQuotationUseCase,
  transitionQuotationUseCase,
  updateDraftQuotationUseCase,
} from '../../src/server/crm/quotations/service';
import type { QuotationDetail, QuotationListItem } from '../../src/server/crm/quotations/repository';
import { uniqueToken } from './setup/db';

/**
 * Quotations V1 use cases: creation, totals, transitions, revisions, row
 * scope and the activity feed.
 */
describe('quotations (use cases)', () => {
  let database: DisposableDatabase;
  let client: Client;

  let repAId: string;
  let repBId: string;
  let managerId: string;
  let contactId: string;
  let sourceId: string;

  const repA: Actor = { userId: '', role: 'SALES_REP' };
  const repB: Actor = { userId: '', role: 'SALES_REP' };
  const manager: Actor = { userId: '', role: 'SALES_MANAGER' };
  const admin: Actor = { userId: '', role: 'ADMIN' };

  async function newOpportunity(ownerUserId = repAId) {
    const lead = await createLead(client, {
      sourceId,
      campaignId: null,
      contactId,
      accountId: null,
      productCategoryId: null,
      note: null,
      ownerUserId,
    });
    const result = await qualifyLeadUseCase(manager, lead.id, {}, client);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('setup failed');
    return result.opportunity;
  }

  async function newQuotation(
    actor: Actor,
    opportunityId: string,
    overrides: Partial<Parameters<typeof createQuotationUseCase>[2]> = {},
  ) {
    const result = await createQuotationUseCase(
      actor,
      opportunityId,
      {
        items: [
          { description: 'Dental unit', quantity: 1, unitPrice: 120000 },
          { description: 'Delivery and setup', quantity: 1, unitPrice: 4500.5 },
        ],
        ...overrides,
      },
      client,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('setup failed: ' + result.message);
    return result.quotation;
  }

  function assertFailure(
    result: { ok: boolean; error?: string; message?: string },
    expectedCode: string,
  ) {
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(expectedCode);
    }
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

    repAId = await mkUser('Rep Alpha', 'SALES_REP');
    repBId = await mkUser('Rep Bravo', 'SALES_REP');
    managerId = await mkUser('Manager', 'SALES_MANAGER');

    repA.userId = repAId;
    repB.userId = repBId;
    manager.userId = managerId;
    admin.userId = managerId;

    contactId = (await createContact(client, { fullName: 'Doctor Patient', email: 'dr@clinic.test' })).id;

    const { rows: sourceRows } = await client.query<{ id: string }>(
      `SELECT id FROM crm_source WHERE code = 'website'`,
    );
    sourceId = sourceRows[0].id;
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  describe('creation and totals', () => {
    it('creates a DRAFT with a unique human-readable number', async () => {
      const opportunity = await newOpportunity();
      const quotation = await newQuotation(manager, opportunity.id);

      expect(quotation.status).toBe('DRAFT');
      expect(quotation.version).toBe(1);
      expect(quotation.quoteNumber).toMatch(/^Q-\d{5}$/);
      expect(quotation.subtotal).toBe(124500.5);
      expect(quotation.discountAmount).toBe(0);
      expect(quotation.taxAmount).toBe(0);
      expect(quotation.totalAmount).toBe(124500.5);
      expect(quotation.items).toHaveLength(2);
      expect(quotation.items[0].lineTotal).toBe(120000);
      expect(quotation.items[1].lineTotal).toBe(4500.5);
    });

    it('assigns distinct numbers across many creations (sequence-backed)', async () => {
      const opportunity = await newOpportunity();
      const numbers = new Set<string>();
      for (let i = 0; i < 12; i++) {
        const quotation = await newQuotation(manager, opportunity.id);
        numbers.add(quotation.quoteNumber);
      }
      expect(numbers.size).toBe(12);
    });

    it('computes discount, tax and total consistently', async () => {
      const opportunity = await newOpportunity();
      const quotation = await newQuotation(manager, opportunity.id, {
        discountAmount: 10000,
        taxAmount: 16000,
      });

      expect(quotation.subtotal).toBe(124500.5);
      expect(quotation.totalAmount).toBe(130500.5);
    });

    it('rounds per-line totals and keeps amounts exact (numeric, not float)', async () => {
      const opportunity = await newOpportunity();
      const result = await createQuotationUseCase(
        manager,
        opportunity.id,
        {
          items: [
            { description: 'Odd priced consumable', quantity: 1.11, unitPrice: 1.11 },
            { description: 'Another odd price', quantity: 3, unitPrice: 0.1 },
          ],
        },
        client,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // 1.11 * 1.11 = 1.2321 -> 1.23; 3 * 0.10 = 0.30; subtotal 1.53.
      expect(result.quotation.items[0].lineTotal).toBe(1.23);
      expect(result.quotation.items[1].lineTotal).toBe(0.3);
      expect(result.quotation.subtotal).toBe(1.53);
      expect(result.quotation.totalAmount).toBe(1.53);
    });

    it('stores notes and terms for the customer document', async () => {
      const opportunity = await newOpportunity();
      const quotation = await newQuotation(manager, opportunity.id, {
        notes: '  Installation included in week one.  ',
        termsConditions: '50% deposit, balance on delivery.',
        validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });

      expect(quotation.notes).toBe('Installation included in week one.');
      expect(quotation.termsConditions).toBe('50% deposit, balance on delivery.');
      expect(quotation.validUntil).toBeInstanceOf(Date);
    });

    it('rejects empty items', async () => {
      const opportunity = await newOpportunity();
      const result = await createQuotationUseCase(manager, opportunity.id, { items: [] }, client);
      assertFailure(result, 'VALIDATION');
    });

    it('rejects a blank item description', async () => {
      const opportunity = await newOpportunity();
      const result = await createQuotationUseCase(
        manager,
        opportunity.id,
        { items: [{ description: '   ', quantity: 1, unitPrice: 10 }] },
        client,
      );
      assertFailure(result, 'VALIDATION');
    });

    it('rejects a non-positive quantity', async () => {
      const opportunity = await newOpportunity();
      const result = await createQuotationUseCase(
        manager,
        opportunity.id,
        { items: [{ description: 'Zero units', quantity: 0, unitPrice: 10 }] },
        client,
      );
      assertFailure(result, 'VALIDATION');
    });

    it('rejects a negative unit price', async () => {
      const opportunity = await newOpportunity();
      const result = await createQuotationUseCase(
        manager,
        opportunity.id,
        { items: [{ description: 'Refund line', quantity: 1, unitPrice: -5 }] },
        client,
      );
      assertFailure(result, 'VALIDATION');
    });

    it('rejects a negative discount', async () => {
      const opportunity = await newOpportunity();
      const result = await createQuotationUseCase(
        manager,
        opportunity.id,
        { items: [{ description: 'Item', quantity: 1, unitPrice: 100 }], discountAmount: -1 },
        client,
      );
      assertFailure(result, 'VALIDATION');
    });

    it('rejects a negative tax', async () => {
      const opportunity = await newOpportunity();
      const result = await createQuotationUseCase(
        manager,
        opportunity.id,
        { items: [{ description: 'Item', quantity: 1, unitPrice: 100 }], taxAmount: -1 },
        client,
      );
      assertFailure(result, 'VALIDATION');
    });

    it('rejects a discount larger than the subtotal', async () => {
      const opportunity = await newOpportunity();
      const result = await createQuotationUseCase(
        manager,
        opportunity.id,
        { items: [{ description: 'Item', quantity: 1, unitPrice: 100 }], discountAmount: 150 },
        client,
      );
      assertFailure(result, 'VALIDATION');
    });

    it('rejects creation for an unknown opportunity without leaking anything', async () => {
      const result = await createQuotationUseCase(
        manager,
        '00000000-0000-0000-0000-000000000000',
        { items: [{ description: 'Item', quantity: 1, unitPrice: 100 }] },
        client,
      );
      assertFailure(result, 'NOT_FOUND');
    });

    it('refuses a new quotation on a closed opportunity', async () => {
      const opportunity = await newOpportunity();
      for (const toStage of ['NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'WON']) {
        const moved = await changeOpportunityStageUseCase(manager, opportunity.id, { toStage }, client);
        expect(moved.ok).toBe(true);
      }

      const result = await createQuotationUseCase(
        manager,
        opportunity.id,
        { items: [{ description: 'Item', quantity: 1, unitPrice: 100 }] },
        client,
      );
      assertFailure(result, 'CLOSED_OPPORTUNITY');
    });
  });

  describe('row scope', () => {
    it('lets the owning rep read and list their quotations', async () => {
      const opportunity = await newOpportunity(repAId);
      const quotation = await newQuotation(repA, opportunity.id);

      expect(await getQuotationUseCase(repA, quotation.id, client)).not.toBeNull();
      const list = await listQuotationsUseCase(repA, opportunity.id, client);
      expect(list.map((row) => row.id)).toContain(quotation.id);
    });

    it('hides another rep\u2019s quotation from reads', async () => {
      const opportunity = await newOpportunity(repAId);
      const quotation = await newQuotation(manager, opportunity.id);

      expect(await getQuotationUseCase(repB, quotation.id, client)).toBeNull();
      expect(await listQuotationsUseCase(repB, opportunity.id, client)).toEqual([]);
      expect(await listQuotationSnapshotsUseCase(repB, quotation.id, client)).toEqual([]);
    });

    it('refuses another rep\u2019s writes with a generic not-found outcome', async () => {
      const opportunity = await newOpportunity(repAId);
      const quotation = await newQuotation(manager, opportunity.id);

      const update = await updateDraftQuotationUseCase(
        repB,
        quotation.id,
        { items: [{ description: 'Stolen edit', quantity: 1, unitPrice: 1 }] },
        client,
      );
      assertFailure(update, 'NOT_FOUND');

      const send = await transitionQuotationUseCase(repB, quotation.id, 'SENT', client);
      assertFailure(send, 'NOT_FOUND');

      const revise = await reviseQuotationUseCase(repB, quotation.id, client);
      assertFailure(revise, 'NOT_FOUND');
    });

    it('lets a manager and an admin read and act on any quotation', async () => {
      const opportunity = await newOpportunity(repAId);
      const quotation = await newQuotation(manager, opportunity.id);

      expect(await getQuotationUseCase(admin, quotation.id, client)).not.toBeNull();
      const sent = await transitionQuotationUseCase(admin, quotation.id, 'SENT', client);
      expect(sent.ok).toBe(true);
    });
  });

  describe('draft editing', () => {
    it('updates items, totals and fields, and snapshots each state', async () => {
      const opportunity = await newOpportunity();
      const quotation = await newQuotation(manager, opportunity.id);

      const updated = await updateDraftQuotationUseCase(
        manager,
        quotation.id,
        {
          items: [
            { description: 'Dental unit', quantity: 2, unitPrice: 120000 },
            { description: 'Chair accessories', quantity: 1, unitPrice: 8500 },
          ],
          discountAmount: 5000,
          taxAmount: 12000,
          notes: 'Revised scope.',
          changeReason: 'Customer asked for two units',
        },
        client,
      );
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;

      expect(updated.quotation.items).toHaveLength(2);
      expect(updated.quotation.subtotal).toBe(248500);
      expect(updated.quotation.totalAmount).toBe(255500);
      expect(updated.quotation.notes).toBe('Revised scope.');

      const snapshots = await listQuotationSnapshotsUseCase(manager, quotation.id, client);
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0].changeReason).toBe('Customer asked for two units');
      expect(snapshots[0].subtotal).toBe(248500);
      expect(snapshots[1].subtotal).toBe(124500.5);
    });

    it('refuses to edit a quotation that is no longer a draft', async () => {
      const opportunity = await newOpportunity();
      const quotation = await newQuotation(manager, opportunity.id);
      const sent = await transitionQuotationUseCase(manager, quotation.id, 'SENT', client);
      expect(sent.ok).toBe(true);

      const update = await updateDraftQuotationUseCase(
        manager,
        quotation.id,
        { items: [{ description: 'Tamper', quantity: 1, unitPrice: 1 }] },
        client,
      );
      assertFailure(update, 'NOT_DRAFT');
    });
  });

  describe('state transitions', () => {
    it('sends a draft: sent_at stamped, activity recorded', async () => {
      const opportunity = await newOpportunity();
      const quotation = await newQuotation(manager, opportunity.id);

      const result = await transitionQuotationUseCase(manager, quotation.id, 'SENT', client);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.quotation.status).toBe('SENT');
      expect(result.quotation.sentAt).toBeInstanceOf(Date);

      const activity = await getOpportunityActivityUseCase(manager, opportunity.id, client);
      const sentEvent = activity.find((entry) => entry.activityType === 'QUOTATION_SENT');
      expect(sentEvent).toBeDefined();
      expect(sentEvent!.description).toContain(quotation.quoteNumber);
    });

    it('accepts a sent quotation and records the decision', async () => {
      const opportunity = await newOpportunity();
      const quotation = await newQuotation(manager, opportunity.id);
      await transitionQuotationUseCase(manager, quotation.id, 'SENT', client);

      const result = await transitionQuotationUseCase(manager, quotation.id, 'ACCEPTED', client);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.quotation.status).toBe('ACCEPTED');
      expect(result.quotation.acceptedAt).toBeInstanceOf(Date);
      expect(result.quotation.sentAt).toBeInstanceOf(Date);

      const activity = await getOpportunityActivityUseCase(manager, opportunity.id, client);
      expect(activity.some((entry) => entry.activityType === 'QUOTATION_ACCEPTED')).toBe(true);
    });

    it('rejects a sent quotation and records the decision', async () => {
      const opportunity = await newOpportunity();
      const quotation = await newQuotation(manager, opportunity.id);
      await transitionQuotationUseCase(manager, quotation.id, 'SENT', client);

      const result = await transitionQuotationUseCase(manager, quotation.id, 'REJECTED', client);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.quotation.status).toBe('REJECTED');
      expect(result.quotation.rejectedAt).toBeInstanceOf(Date);

      const activity = await getOpportunityActivityUseCase(manager, opportunity.id, client);
      expect(activity.some((entry) => entry.activityType === 'QUOTATION_REJECTED')).toBe(true);
    });

    it('expires a draft and a sent quotation', async () => {
      const opportunity = await newOpportunity();
      const draft = await newQuotation(manager, opportunity.id);
      const expiredDraft = await transitionQuotationUseCase(manager, draft.id, 'EXPIRED', client);
      expect(expiredDraft.ok).toBe(true);

      const sent = await newQuotation(manager, opportunity.id);
      await transitionQuotationUseCase(manager, sent.id, 'SENT', client);
      const expiredSent = await transitionQuotationUseCase(manager, sent.id, 'EXPIRED', client);
      expect(expiredSent.ok).toBe(true);
    });

    it('refuses illegal transitions', async () => {
      const opportunity = await newOpportunity();
      const quotation = await newQuotation(manager, opportunity.id);

      assertFailure(
        await transitionQuotationUseCase(manager, quotation.id, 'ACCEPTED', client),
        'INVALID_TRANSITION',
      );
      assertFailure(
        await transitionQuotationUseCase(manager, quotation.id, 'REJECTED', client),
        'INVALID_TRANSITION',
      );

      await transitionQuotationUseCase(manager, quotation.id, 'SENT', client);
      assertFailure(
        await transitionQuotationUseCase(manager, quotation.id, 'SENT', client),
        'INVALID_TRANSITION',
      );
      assertFailure(
        await transitionQuotationUseCase(manager, quotation.id, 'DRAFT', client),
        'INVALID_TRANSITION',
      );

      await transitionQuotationUseCase(manager, quotation.id, 'ACCEPTED', client);
      assertFailure(
        await transitionQuotationUseCase(manager, quotation.id, 'SENT', client),
        'INVALID_TRANSITION',
      );
      assertFailure(
        await transitionQuotationUseCase(manager, quotation.id, 'REJECTED', client),
        'INVALID_TRANSITION',
      );
    });
  });

  describe('revisions', () => {
    let opportunityId: string;
    let original: QuotationDetail;

    beforeAll(async () => {
      opportunityId = (await newOpportunity()).id;
      original = await newQuotation(manager, opportunityId);
      const sent = await transitionQuotationUseCase(manager, original.id, 'SENT', client);
      expect(sent.ok).toBe(true);
    });

    it('creates a chained DRAFT without touching the original', async () => {
      const result = await reviseQuotationUseCase(manager, original.id, client);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const revision = result.quotation;
      expect(revision.status).toBe('DRAFT');
      expect(revision.version).toBe(2);
      expect(revision.previousQuoteId).toBe(original.id);
      expect(revision.previousQuoteNumber).toBe(original.quoteNumber);
      expect(revision.quoteNumber).not.toBe(original.quoteNumber);
      expect(revision.items).toHaveLength(2);
      expect(revision.totalAmount).toBe(original.totalAmount);

      const untouched = await getQuotationUseCase(manager, original.id, client);
      expect(untouched!.status).toBe('SENT');
      expect(untouched!.totalAmount).toBe(original.totalAmount);
    });

    it('records the revision in the activity feed with both numbers', async () => {
      const activity = await getOpportunityActivityUseCase(manager, opportunityId, client);
      const event = activity.find((entry) => entry.activityType === 'QUOTATION_REVISED');
      expect(event).toBeDefined();
      expect(event!.description).toContain(original.quoteNumber);
    });

    it('lists the full chain for the opportunity, oldest first', async () => {
      const list: QuotationListItem[] = await listQuotationsUseCase(manager, opportunityId, client);
      const statuses = list.map((row) => row.status);
      expect(statuses).toContain('SENT');
      expect(statuses).toContain('DRAFT');
      expect(list[0].version).toBe(1);
      expect(list[list.length - 1].version).toBe(2);
      expect(list[list.length - 1].previousQuoteNumber).toBe(original.quoteNumber);
    });

    it('refuses to revise a draft (edit it instead)', async () => {
      const draft = await newQuotation(manager, opportunityId);
      const result = await reviseQuotationUseCase(manager, draft.id, client);
      assertFailure(result, 'INVALID_TRANSITION');
    });

    it('allows revising a rejected quotation into a new offer', async () => {
      const quoted = await newQuotation(manager, opportunityId);
      await transitionQuotationUseCase(manager, quoted.id, 'SENT', client);
      await transitionQuotationUseCase(manager, quoted.id, 'REJECTED', client);

      const result = await reviseQuotationUseCase(manager, quoted.id, client);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.quotation.status).toBe('DRAFT');
      expect(result.quotation.previousQuoteId).toBe(quoted.id);
    });
  });

  describe('snapshots', () => {
    it('captures the whole commercial lifecycle of one quotation', async () => {
      const opportunity = await newOpportunity();
      const quotation = await newQuotation(manager, opportunity.id);
      await updateDraftQuotationUseCase(
        manager,
        quotation.id,
        { items: [{ description: 'Item', quantity: 1, unitPrice: 200 }], changeReason: 'Edit 1' },
        client,
      );
      await transitionQuotationUseCase(manager, quotation.id, 'SENT', client);

      const snapshots = await listQuotationSnapshotsUseCase(manager, quotation.id, client);
      expect(snapshots.map((snapshot) => snapshot.status)).toEqual(['SENT', 'DRAFT', 'DRAFT']);
      expect(snapshots.map((snapshot) => snapshot.version)).toEqual([3, 2, 1]);
      expect(snapshots[2].totalAmount).toBe(124500.5);
      expect(snapshots[1].totalAmount).toBe(200);
      expect(snapshots[0].changeReason).toBe('Status moved to SENT');
    });
  });
});
