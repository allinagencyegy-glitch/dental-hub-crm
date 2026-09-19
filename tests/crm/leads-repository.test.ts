import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { connectTestDb, uniqueToken } from './setup/db';
import {
  createAccount,
  linkContactToAccount,
} from '../../src/server/crm/accounts/repository';
import {
  createContact,
} from '../../src/server/crm/contacts/repository';
import { createProductCategory } from '../../src/server/crm/catalog/repository';
import { createUser } from '../../src/server/users/repository';
import {
  createLead,
  findLeadById,
  listLeads,
  markLeadContacted,
  disqualifyLead,
  findLeadDetailById,
  LeadNotFoundError,
  InvalidLeadStatusTransitionError,
  InvalidDisqualifyReasonError,
} from '../../src/server/crm/leads/repository';

let db: Client;

beforeAll(async () => {
  db = await connectTestDb();
});

afterAll(async () => {
  // Clean up test leads and related data FIRST (due to FK constraints)
  await db.query('DELETE FROM crm_lead');
  await db.query('DELETE FROM crm_account_contact');
  await db.query('DELETE FROM crm_account');
  await db.query('DELETE FROM crm_contact_channel');
  await db.query('DELETE FROM crm_contact');
  // Clean up test outcome reasons created during tests
  await db.query(`DELETE FROM crm_outcome_reason WHERE code LIKE 'inactive_%' OR code LIKE 'needsnote_%'`);
  // Clean up test users
  await db.query(`DELETE FROM crm_user WHERE email LIKE '%@test.com'`);
  await db.end();
});

describe('leads repository', () => {
  let adminUser: { id: string; role: 'ADMIN' };
  let managerUser: { id: string; role: 'SALES_MANAGER' };
  let repUser1: { id: string; role: 'SALES_REP' };
  let repUser2: { id: string; role: 'SALES_REP' };
  let sourceId: string;
  let campaignId: string;
  let categoryId: string;
  let disqualifyReasonId: string;

  beforeAll(async () => {
    // Create test users
    adminUser = { id: (await createUser(db, {
      displayName: 'Test Admin',
      email: uniqueToken('admin') + '@test.com',
      password: 'Password123!',
      role: 'ADMIN',
    })).id, role: 'ADMIN' };

    managerUser = { id: (await createUser(db, {
      displayName: 'Test Manager',
      email: uniqueToken('manager') + '@test.com',
      password: 'Password123!',
      role: 'SALES_MANAGER',
    })).id, role: 'SALES_MANAGER' };

    repUser1 = { id: (await createUser(db, {
      displayName: 'Test Rep 1',
      email: uniqueToken('rep1') + '@test.com',
      password: 'Password123!',
      role: 'SALES_REP',
    })).id, role: 'SALES_REP' };

    repUser2 = { id: (await createUser(db, {
      displayName: 'Test Rep 2',
      email: uniqueToken('rep2') + '@test.com',
      password: 'Password123!',
      role: 'SALES_REP',
    })).id, role: 'SALES_REP' };

    // Get source
    const source = await db.query<{ id: string }>("SELECT id FROM crm_source WHERE code = 'website'");
    sourceId = source.rows[0].id;

    // Create campaign
    const camp = await db.query<{ id: string }>(
      `INSERT INTO crm_source_campaign (source_id, code, name) VALUES ($1, $2, $3) RETURNING id`,
      [sourceId, uniqueToken('camp'), 'Test Campaign']
    );
    campaignId = camp.rows[0].id;

    // Create product category
    const cat = await createProductCategory(db, { code: uniqueToken('cat'), name: 'Test Category' });
    categoryId = cat.id;

    // Get disqualify reason
    const reason = await db.query<{ id: string }>(
      "SELECT id FROM crm_outcome_reason WHERE kind = 'disqualify' AND code = 'spam'"
    );
    disqualifyReasonId = reason.rows[0].id;
  });

  async function createTestLead(overrides: Partial<{
    ownerUserId: string;
    contactId: string;
    accountId: string;
  }> = {}) {
    // Create contact
    const contact = await createContact(db, {
      fullName: 'Test Contact',
      email: uniqueToken('contact') + '@test.com',
    });

    // Create account and link
    const account = await createAccount(db, { name: uniqueToken('Account') });
    await linkContactToAccount(db, { accountId: account.id, contactId: contact.id, isPrimary: true });

    return createLead(db, {
      sourceId,
      campaignId,
      contactId: contact.id,
      accountId: account.id,
      productCategoryId: categoryId,
      note: 'Test note',
      ownerUserId: overrides.ownerUserId ?? repUser1.id,
      receivedAt: new Date(),
    });
  }

  describe('createLead', () => {
    it('creates a lead with all fields', async () => {
      const lead = await createTestLead();

      expect(lead.id).toBeDefined();
      expect(lead.sourceId).toBe(sourceId);
      expect(lead.campaignId).toBe(campaignId);
      expect(lead.contactId).toBeDefined();
      expect(lead.accountId).toBeDefined();
      expect(lead.productCategoryId).toBe(categoryId);
      expect(lead.status).toBe('NEW');
      expect(lead.note).toBe('Test note');
      expect(lead.ownerUserId).toBe(repUser1.id);
      expect(lead.receivedAt).toBeInstanceOf(Date);
      expect(lead.disqualifiedAt).toBeNull();
      expect(lead.disqualifyReasonId).toBeNull();
    });

    it('defaults status to NEW', async () => {
      const lead = await createTestLead();
      expect(lead.status).toBe('NEW');
    });
  });

  describe('findLeadById with row-scope', () => {
    it('allows ADMIN to find any lead', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      const found = await findLeadById(db, lead.id, { userId: adminUser.id, role: 'ADMIN' });
      expect(found).not.toBeNull();
      expect(found?.id).toBe(lead.id);
    });

    it('allows SALES_MANAGER to find any lead', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      const found = await findLeadById(db, lead.id, { userId: managerUser.id, role: 'SALES_MANAGER' });
      expect(found).not.toBeNull();
      expect(found?.id).toBe(lead.id);
    });

    it('allows SALES_REP to find their own lead', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      const found = await findLeadById(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' });
      expect(found).not.toBeNull();
      expect(found?.id).toBe(lead.id);
    });

    it('denies SALES_REP access to another rep\'s lead', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      const found = await findLeadById(db, lead.id, { userId: repUser2.id, role: 'SALES_REP' });
      expect(found).toBeNull();
    });

    it('returns null for non-existent lead', async () => {
      const found = await findLeadById(db, randomUUID(), { userId: adminUser.id, role: 'ADMIN' });
      expect(found).toBeNull();
    });
  });

  describe('listLeads with row-scope', () => {
    let testLeadIds: string[] = [];

    beforeAll(async () => {
      // Clean up any existing leads from other tests
      await db.query('DELETE FROM crm_lead');
      await db.query('DELETE FROM crm_account_contact');
      await db.query('DELETE FROM crm_account');
      await db.query('DELETE FROM crm_contact_channel');
      await db.query('DELETE FROM crm_contact');

      // Create leads for different owners and track their IDs
      // All leads start as NEW, then we transition some
      const lead1 = await createTestLead({ ownerUserId: repUser1.id });
      const lead2 = await createTestLead({ ownerUserId: repUser1.id });
      const lead3 = await createTestLead({ ownerUserId: repUser2.id });
      const lead4 = await createTestLead({ ownerUserId: repUser2.id });
      const lead5 = await createTestLead({ ownerUserId: repUser2.id });

      // Transition lead4 to CONTACTED
      await markLeadContacted(db, lead4.id, { userId: repUser2.id, role: 'SALES_REP' });
      // Transition lead5 to DISQUALIFIED
      await disqualifyLead(db, lead5.id, { userId: repUser2.id, role: 'SALES_REP' }, {
        reasonId: disqualifyReasonId,
        note: 'Test disqualification',
      });

      testLeadIds = [lead1.id, lead2.id, lead3.id, lead4.id, lead5.id];
    });

    afterAll(async () => {
      // Clean up test leads
      if (testLeadIds.length > 0) {
        await db.query('DELETE FROM crm_lead WHERE id = ANY($1)', [testLeadIds]);
      }
    });

    it('returns all leads for ADMIN', async () => {
      const { leads, total } = await listLeads(db, { userId: adminUser.id, role: 'ADMIN' }, { limit: 100 });
      expect(total).toBeGreaterThanOrEqual(5);
      expect(leads.length).toBeGreaterThanOrEqual(5);
    });

    it('returns all leads for SALES_MANAGER', async () => {
      const { leads, total } = await listLeads(db, { userId: managerUser.id, role: 'SALES_MANAGER' }, { limit: 100 });
      expect(total).toBeGreaterThanOrEqual(5);
      expect(leads.length).toBeGreaterThanOrEqual(5);
    });

    it('returns only own leads for SALES_REP', async () => {
      const { leads } = await listLeads(db, { userId: repUser1.id, role: 'SALES_REP' }, { limit: 100 });
      // Should only see leads owned by repUser1
      expect(leads.every(l => l.ownerUserId === repUser1.id)).toBe(true);
      // Should see at least the 2 leads we created for repUser1
      expect(leads.filter(l => testLeadIds.includes(l.id)).length).toBe(2);
    });

    it('filters by status for SALES_REP', async () => {
      const { leads } = await listLeads(db, { userId: repUser2.id, role: 'SALES_REP' }, { status: 'NEW', limit: 100 });
      // Should only see leads owned by repUser2 with status NEW
      expect(leads.every(l => l.ownerUserId === repUser2.id && l.status === 'NEW')).toBe(true);
      // Should see at least the 1 NEW lead we created for repUser2
      const ourNewLeads = leads.filter(l => testLeadIds.includes(l.id) && l.status === 'NEW');
      expect(ourNewLeads.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by status for ADMIN', async () => {
      const { leads } = await listLeads(db, { userId: adminUser.id, role: 'ADMIN' }, { status: 'DISQUALIFIED', limit: 100 });
      // Should see at least the 1 DISQUALIFIED lead we created
      const ourDisqualifiedLeads = leads.filter(l => testLeadIds.includes(l.id) && l.status === 'DISQUALIFIED');
      expect(ourDisqualifiedLeads.length).toBeGreaterThanOrEqual(1);
      expect(leads.every(l => l.status === 'DISQUALIFIED')).toBe(true);
    });

    it('respects pagination', async () => {
      const page1 = await listLeads(db, { userId: adminUser.id, role: 'ADMIN' }, { limit: 2, offset: 0 });
      const page2 = await listLeads(db, { userId: adminUser.id, role: 'ADMIN' }, { limit: 2, offset: 2 });
      expect(page1.leads.length).toBe(2);
      expect(page2.leads.length).toBeGreaterThanOrEqual(1);
      expect(page1.leads[0].id).not.toBe(page2.leads[0].id);
    });
  });

  describe('markLeadContacted', () => {
    it('transitions NEW -> CONTACTED', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      const updated = await markLeadContacted(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' });
      expect(updated.status).toBe('CONTACTED');
    });

    it('allows ADMIN to mark any lead contacted', async () => {
      const lead = await createTestLead({ ownerUserId: repUser2.id });
      const updated = await markLeadContacted(db, lead.id, { userId: adminUser.id, role: 'ADMIN' });
      expect(updated.status).toBe('CONTACTED');
    });

    it('allows SALES_MANAGER to mark any lead contacted', async () => {
      const lead = await createTestLead({ ownerUserId: repUser2.id });
      const updated = await markLeadContacted(db, lead.id, { userId: managerUser.id, role: 'SALES_MANAGER' });
      expect(updated.status).toBe('CONTACTED');
    });

    it('denies SALES_REP marking another rep\'s lead contacted', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      await expect(
        markLeadContacted(db, lead.id, { userId: repUser2.id, role: 'SALES_REP' })
      ).rejects.toBeInstanceOf(LeadNotFoundError);
    });

    it('rejects invalid transition CONTACTED -> CONTACTED', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      await markLeadContacted(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' });
      await expect(
        markLeadContacted(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' })
      ).rejects.toBeInstanceOf(InvalidLeadStatusTransitionError);
    });

    it('rejects invalid transition DISQUALIFIED -> CONTACTED', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      await disqualifyLead(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' }, { reasonId: disqualifyReasonId });
      await expect(
        markLeadContacted(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' })
      ).rejects.toBeInstanceOf(InvalidLeadStatusTransitionError);
    });
  });

  describe('disqualifyLead', () => {
    it('transitions NEW -> DISQUALIFIED', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      const updated = await disqualifyLead(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' }, {
        reasonId: disqualifyReasonId,
        note: 'Spam inquiry',
      });
      expect(updated.status).toBe('DISQUALIFIED');
      expect(updated.disqualifiedAt).toBeInstanceOf(Date);
      expect(updated.disqualifyReasonId).toBe(disqualifyReasonId);
      expect(updated.note).toBe('Spam inquiry');
    });

    it('transitions CONTACTED -> DISQUALIFIED', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      await markLeadContacted(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' });
      const updated = await disqualifyLead(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' }, {
        reasonId: disqualifyReasonId,
        note: 'Not interested',
      });
      expect(updated.status).toBe('DISQUALIFIED');
    });

    it('allows ADMIN to disqualify any lead', async () => {
      const lead = await createTestLead({ ownerUserId: repUser2.id });
      const updated = await disqualifyLead(db, lead.id, { userId: adminUser.id, role: 'ADMIN' }, {
        reasonId: disqualifyReasonId,
      });
      expect(updated.status).toBe('DISQUALIFIED');
    });

    it('allows SALES_MANAGER to disqualify any lead', async () => {
      const lead = await createTestLead({ ownerUserId: repUser2.id });
      const updated = await disqualifyLead(db, lead.id, { userId: managerUser.id, role: 'SALES_MANAGER' }, {
        reasonId: disqualifyReasonId,
      });
      expect(updated.status).toBe('DISQUALIFIED');
    });

    it('denies SALES_REP disqualifying another rep\'s lead', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      await expect(
        disqualifyLead(db, lead.id, { userId: repUser2.id, role: 'SALES_REP' }, { reasonId: disqualifyReasonId })
      ).rejects.toBeInstanceOf(LeadNotFoundError);
    });

    it('rejects invalid reason (wrong kind)', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      const lostReason = await db.query<{ id: string }>(
        "SELECT id FROM crm_outcome_reason WHERE kind = 'lost' AND code = 'price_too_high'"
      );
      await expect(
        disqualifyLead(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' }, { reasonId: lostReason.rows[0].id })
      ).rejects.toBeInstanceOf(InvalidDisqualifyReasonError);
    });

    it('rejects inactive reason', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      // Create inactive disqualify reason
      const inactiveReason = await db.query<{ id: string }>(
        `INSERT INTO crm_outcome_reason (kind, code, label, requires_note, is_active) VALUES ('disqualify', $1, $2, false, false) RETURNING id`,
        [uniqueToken('inactive'), 'Inactive Reason']
      );
      try {
        await expect(
          disqualifyLead(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' }, { reasonId: inactiveReason.rows[0].id })
        ).rejects.toBeInstanceOf(InvalidDisqualifyReasonError);
      } finally {
        // Clean up immediately to avoid polluting other tests
        await db.query('DELETE FROM crm_outcome_reason WHERE id = $1', [inactiveReason.rows[0].id]);
      }
    });

    it('enforces requires_note when true', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      // Use the existing 'other' disqualify reason which requires a note
      const otherReason = await db.query<{ id: string }>(
        "SELECT id FROM crm_outcome_reason WHERE kind = 'disqualify' AND code = 'other'"
      );
      const reasonWithNoteId = otherReason.rows[0].id;

      await expect(
        disqualifyLead(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' }, { reasonId: reasonWithNoteId })
      ).rejects.toBeInstanceOf(InvalidDisqualifyReasonError);

      // With note should work
      const updated = await disqualifyLead(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' }, {
        reasonId: reasonWithNoteId,
        note: 'Required note',
      });
      expect(updated.status).toBe('DISQUALIFIED');
      expect(updated.note).toBe('Required note');
    });

    it('rejects DISQUALIFIED -> DISQUALIFIED transition', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      await disqualifyLead(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' }, { reasonId: disqualifyReasonId });
      await expect(
        disqualifyLead(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' }, { reasonId: disqualifyReasonId })
      ).rejects.toBeInstanceOf(InvalidLeadStatusTransitionError);
    });
  });

  describe('findLeadDetailById with row-scope', () => {
    it('returns enriched lead detail for ADMIN', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      const detail = await findLeadDetailById(db, lead.id, { userId: adminUser.id, role: 'ADMIN' });
      expect(detail).not.toBeNull();
      expect(detail?.sourceCode).toBeDefined();
      expect(detail?.sourceName).toBeDefined();
      expect(detail?.campaignCode).toBeDefined();
      expect(detail?.campaignName).toBeDefined();
      expect(detail?.productCategoryCode).toBeDefined();
      expect(detail?.productCategoryName).toBeDefined();
      expect(detail?.ownerName).toBeDefined();
      expect(detail?.ownerEmail).toBeDefined();
      expect(detail?.contactName).toBeDefined();
      expect(detail?.contactEmail).toBeDefined();
      expect(detail?.accountName).toBeDefined();
    });

    it('returns enriched lead detail for SALES_MANAGER', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      const detail = await findLeadDetailById(db, lead.id, { userId: managerUser.id, role: 'SALES_MANAGER' });
      expect(detail).not.toBeNull();
    });

    it('returns enriched lead detail for owning SALES_REP', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      const detail = await findLeadDetailById(db, lead.id, { userId: repUser1.id, role: 'SALES_REP' });
      expect(detail).not.toBeNull();
    });

    it('denies SALES_REP access to another rep\'s lead detail', async () => {
      const lead = await createTestLead({ ownerUserId: repUser1.id });
      const detail = await findLeadDetailById(db, lead.id, { userId: repUser2.id, role: 'SALES_REP' });
      expect(detail).toBeNull();
    });
  });
});