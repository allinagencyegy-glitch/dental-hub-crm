import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { connectTestDb, uniqueToken } from './setup/db';
import { createContact } from '../../src/server/crm/contacts/repository';
import { createUser } from '../../src/server/users/repository';
import {
  captureLeadUseCase,
  listLeadsUseCase,
  getLeadDetailUseCase,
  markLeadContactedUseCase,
  disqualifyLeadUseCase,
  getLeadCaptureCatalogUseCase,
  getSourceCampaignsUseCase,
  getDisqualifyReasonsUseCase,
  getAssignableOwnersUseCase,
  type Actor,
} from '../../src/server/crm/leads/service';
import {
  createLead,
  findLeadById,
  markLeadContacted,
  disqualifyLead,
} from '../../src/server/crm/leads/repository';

let db: Client;
let adminUser: { id: string; role: 'ADMIN' };
let managerUser: { id: string; role: 'SALES_MANAGER' };
let repUser1: { id: string; role: 'SALES_REP' };
let repUser2: { id: string; role: 'SALES_REP' };
let inactiveRepUser: { id: string; role: 'SALES_REP' };
let sourceId: string;
let campaignId: string;
let categoryId: string;
let disqualifyReasonId: string;
let inactiveCampaignId: string;
let inactiveCategoryId: string;

const adminActor: Actor = { userId: '', role: 'ADMIN' };
const managerActor: Actor = { userId: '', role: 'SALES_MANAGER' };
const rep1Actor: Actor = { userId: '', role: 'SALES_REP' };
const rep2Actor: Actor = { userId: '', role: 'SALES_REP' };

beforeAll(async () => {
  db = await connectTestDb();

  adminUser = { id: (await createUser(db, {
    displayName: 'Test Admin',
    email: uniqueToken('admin') + '@test.com',
    password: 'Password123!',
    role: 'ADMIN',
  })).id, role: 'ADMIN' };
  adminActor.userId = adminUser.id;

  managerUser = { id: (await createUser(db, {
    displayName: 'Test Manager',
    email: uniqueToken('manager') + '@test.com',
    password: 'Password123!',
    role: 'SALES_MANAGER',
  })).id, role: 'SALES_MANAGER' };
  managerActor.userId = managerUser.id;

  repUser1 = { id: (await createUser(db, {
    displayName: 'Test Rep 1',
    email: uniqueToken('rep1') + '@test.com',
    password: 'Password123!',
    role: 'SALES_REP',
  })).id, role: 'SALES_REP' };
  rep1Actor.userId = repUser1.id;

  repUser2 = { id: (await createUser(db, {
    displayName: 'Test Rep 2',
    email: uniqueToken('rep2') + '@test.com',
    password: 'Password123!',
    role: 'SALES_REP',
  })).id, role: 'SALES_REP' };
  rep2Actor.userId = repUser2.id;

  inactiveRepUser = { id: (await createUser(db, {
    displayName: 'Inactive Rep',
    email: uniqueToken('inactive-rep') + '@test.com',
    password: 'Password123!',
    role: 'SALES_REP',
    isActive: false,
  })).id, role: 'SALES_REP' };

  const { rows: sources } = await db.query('SELECT id, code FROM crm_source WHERE is_active = true ORDER BY code');
  const websiteSource = sources.find((s) => s.code === 'website');
  if (!websiteSource) throw new Error('website source not found');
  sourceId = websiteSource.id;

  // Create active campaign
  const camp = await db.query<{ id: string }>(
    `INSERT INTO crm_source_campaign (source_id, code, name) VALUES ($1, $2, $3) RETURNING id`,
    [sourceId, uniqueToken('camp'), 'Test Campaign']
  );
  campaignId = camp.rows[0].id;

  // Create inactive campaign
  const inactiveCamp = await db.query<{ id: string }>(
    `INSERT INTO crm_source_campaign (source_id, code, name, is_active) VALUES ($1, $2, $3, false) RETURNING id`,
    [sourceId, uniqueToken('inactive-camp'), 'Inactive Campaign']
  );
  inactiveCampaignId = inactiveCamp.rows[0].id;

  const { rows: categories } = await db.query('SELECT id, code FROM crm_product_category WHERE is_active = true ORDER BY code');
  if (!categories[0]) throw new Error('no active category found');
  categoryId = categories[0].id;

  // Create inactive category for testing
  const inactiveCat = await db.query<{ id: string }>(
    `INSERT INTO crm_product_category (code, name, is_active) VALUES ($1, $2, false) RETURNING id`,
    [uniqueToken('inactive-cat'), 'Inactive Category']
  );
  inactiveCategoryId = inactiveCat.rows[0].id;

  const { rows: reasons } = await db.query('SELECT id, code FROM crm_outcome_reason WHERE kind = \'disqualify\' AND is_active = true ORDER BY code');
  const spamReason = reasons.find((r) => r.code === 'spam');
  if (!spamReason) throw new Error('spam reason not found');
  disqualifyReasonId = spamReason.id;
});

afterAll(async () => {
  // Clean up test leads and related data
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

async function createTestLead(ownerId: string, overrides: Partial<{ sourceId: string; campaignId: string | null; productCategoryId: string | null; note: string | null }> = {}) {
  const contact = await createContact(db, {
    fullName: 'Test Lead Contact',
    email: uniqueToken('lead-contact') + '@test.com',
  });

  const accountId = await (await import('../../src/server/crm/leads/repository')).resolvePrimaryAccount(db, contact.id);

  return createLead(db, {
    sourceId: overrides.sourceId ?? sourceId,
    campaignId: overrides.campaignId ?? null,
    contactId: contact.id,
    accountId,
    productCategoryId: overrides.productCategoryId ?? null,
    note: overrides.note ?? null,
    ownerUserId: ownerId,
  });
}

describe('Application Service - captureLeadUseCase', () => {
  it('forces SALES_REP owner to self even when ownerUserId provided', async () => {
    const result = await captureLeadUseCase(rep1Actor, {
      fullName: 'Rep Lead',
      phone: '+201012345678',
      email: 'replead@test.com',
      sourceCode: 'website',
      campaignCode: null,
      productCategoryCode: null,
      note: 'Test',
      ownerUserId: repUser2.id,
    }, db);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const lead = await findLeadById(db, result.leadId, rep1Actor);
      expect(lead?.ownerUserId).toBe(repUser1.id);
    }
  });

  it('allows SALES_MANAGER to assign another active owner', async () => {
    const result = await captureLeadUseCase(managerActor, {
      fullName: 'Manager Assigned Lead',
      phone: '+201012345679',
      email: 'manager-assigned@test.com',
      sourceCode: 'website',
      campaignCode: null,
      productCategoryCode: null,
      note: 'Test',
      ownerUserId: repUser2.id,
    }, db);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const lead = await findLeadById(db, result.leadId, managerActor);
      expect(lead?.ownerUserId).toBe(repUser2.id);
    }
  });

  it('allows ADMIN to assign another active owner', async () => {
    const result = await captureLeadUseCase(adminActor, {
      fullName: 'Admin Assigned Lead',
      phone: '+201012345680',
      email: 'admin-assigned@test.com',
      sourceCode: 'website',
      campaignCode: null,
      productCategoryCode: null,
      note: 'Test',
      ownerUserId: repUser2.id,
    }, db);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const lead = await findLeadById(db, result.leadId, adminActor);
      expect(lead?.ownerUserId).toBe(repUser2.id);
    }
  });

  it('rejects inactive owner', async () => {
    const result = await captureLeadUseCase(managerActor, {
      fullName: 'Inactive Owner Lead',
      phone: '+201012345681',
      email: 'inactive-owner@test.com',
      sourceCode: 'website',
      campaignCode: null,
      productCategoryCode: null,
      note: 'Test',
      ownerUserId: inactiveRepUser.id,
    }, db);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('OWNER_NOT_FOUND');
    }
  });

  it('rejects non-assignable owner (ADMIN role)', async () => {
    const result = await captureLeadUseCase(managerActor, {
      fullName: 'Admin Owner Lead',
      phone: '+201012345682',
      email: 'admin-owner@test.com',
      sourceCode: 'website',
      campaignCode: null,
      productCategoryCode: null,
      note: 'Test',
      ownerUserId: adminUser.id,
    }, db);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('OWNER_NOT_FOUND');
    }
  });

  it('rejects invalid source code', async () => {
    const result = await captureLeadUseCase(rep1Actor, {
      fullName: 'Invalid Source Lead',
      phone: '+201012345683',
      email: 'invalid-source@test.com',
      sourceCode: 'nonexistent',
      campaignCode: null,
      productCategoryCode: null,
      note: 'Test',
    }, db);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('SOURCE_NOT_FOUND');
    }
  });

  it('rejects inactive source', async () => {
    const { rows: inactiveSource } = await db.query('SELECT code FROM crm_source WHERE is_active = false LIMIT 1');
    if (inactiveSource.length === 0) {
      return;
    }

    const result = await captureLeadUseCase(rep1Actor, {
      fullName: 'Inactive Source Lead',
      phone: '+201012345684',
      email: 'inactive-source@test.com',
      sourceCode: inactiveSource[0].code,
      campaignCode: null,
      productCategoryCode: null,
      note: 'Test',
    }, db);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('SOURCE_NOT_FOUND');
    }
  });

  it('rejects campaign not belonging to selected source', async () => {
    const { rows: otherSource } = await db.query('SELECT code FROM crm_source WHERE is_active = true AND code != \'website\' LIMIT 1');
    if (otherSource.length === 0) {
      return;
    }

    const { rows: otherCampaign } = await db.query('SELECT code FROM crm_source_campaign WHERE source_id = (SELECT id FROM crm_source WHERE code = $1) AND is_active = true LIMIT 1', [otherSource[0].code]);
    if (otherCampaign.length === 0) {
      return;
    }

    const result = await captureLeadUseCase(rep1Actor, {
      fullName: 'Wrong Campaign Lead',
      phone: '+201012345685',
      email: 'wrong-campaign@test.com',
      sourceCode: 'website',
      campaignCode: otherCampaign[0].code,
      productCategoryCode: null,
      note: 'Test',
    }, db);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('CAMPAIGN_MISMATCH');
    }
  });

  it('rejects inactive campaign', async () => {
    if (!inactiveCampaignId) {
      return;
    }

    const { rows: inactiveCampaign } = await db.query('SELECT code FROM crm_source_campaign WHERE id = $1', [inactiveCampaignId]);
    if (inactiveCampaign.length === 0) {
      return;
    }

    const result = await captureLeadUseCase(rep1Actor, {
      fullName: 'Inactive Campaign Lead',
      phone: '+201012345686',
      email: 'inactive-campaign@test.com',
      sourceCode: 'website',
      campaignCode: inactiveCampaign[0].code,
      productCategoryCode: null,
      note: 'Test',
    }, db);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('CAMPAIGN_MISMATCH');
    }
  });

  it('rejects invalid product category', async () => {
    const result = await captureLeadUseCase(rep1Actor, {
      fullName: 'Invalid Category Lead',
      phone: '+201012345687',
      email: 'invalid-category@test.com',
      sourceCode: 'website',
      campaignCode: null,
      productCategoryCode: 'nonexistent',
      note: 'Test',
    }, db);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('CATEGORY_NOT_FOUND');
    }
  });

  it('rejects inactive product category', async () => {
    if (!inactiveCategoryId) {
      return;
    }

    const { rows: inactiveCategory } = await db.query('SELECT code FROM crm_product_category WHERE id = $1', [inactiveCategoryId]);
    if (inactiveCategory.length === 0) {
      return;
    }

    const result = await captureLeadUseCase(rep1Actor, {
      fullName: 'Inactive Category Lead',
      phone: '+201012345688',
      email: 'inactive-category@test.com',
      sourceCode: 'website',
      campaignCode: null,
      productCategoryCode: inactiveCategory[0].code,
      note: 'Test',
    }, db);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('CATEGORY_NOT_FOUND');
    }
  });

  it('returns identity conflict when phone matches one contact and email matches another', async () => {
    const phone = '+201099999999';
    const email = 'conflict@test.com';

    // Create first contact with phone
    const phoneContact = await createContact(db, { fullName: 'Phone Contact', email: 'phone-contact@test.com' });
    await db.query(
      `INSERT INTO crm_contact_channel (contact_id, channel_type, value) VALUES ($1, 'PHONE', $2)`,
      [phoneContact.id, phone]
    );

    // Create second contact with email
    const emailContact = await createContact(db, { fullName: 'Email Contact', email });
    await db.query(
      `INSERT INTO crm_contact_channel (contact_id, channel_type, value) VALUES ($1, 'PHONE', $2)`,
      [emailContact.id, '+201088888888']
    );

    const result = await captureLeadUseCase(rep1Actor, {
      fullName: 'Conflict Lead',
      phone,
      email,
      sourceCode: 'website',
      campaignCode: null,
      productCategoryCode: null,
      note: 'Test',
    }, db);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('IDENTITY_CONFLICT');
      expect(result.conflict).toBeDefined();
      expect(result.conflict?.phoneContactId).toBeDefined();
      expect(result.conflict?.emailContactId).toBeDefined();
      expect(result.conflict?.phoneContactId).not.toBe(result.conflict?.emailContactId);
    }
  });
});

describe('Application Service - markLeadContactedUseCase', () => {
  let rep1LeadId: string;
  let rep2LeadId: string;

  beforeEach(async () => {
    const lead1 = await createTestLead(repUser1.id);
    rep1LeadId = lead1.id;

    const lead2 = await createTestLead(repUser2.id);
    rep2LeadId = lead2.id;
  });

  it('allows SALES_REP to mark own lead as contacted', async () => {
    const lead = await markLeadContactedUseCase(rep1Actor, rep1LeadId, db);
    expect(lead.status).toBe('CONTACTED');
  });

  it('allows ADMIN to mark any lead as contacted', async () => {
    const lead = await markLeadContactedUseCase(adminActor, rep2LeadId, db);
    expect(lead.status).toBe('CONTACTED');
  });

  it('allows SALES_MANAGER to mark any lead as contacted', async () => {
    const lead = await markLeadContactedUseCase(managerActor, rep2LeadId, db);
    expect(lead.status).toBe('CONTACTED');
  });

  it('denies SALES_REP marking another rep lead as contacted', async () => {
    await expect(markLeadContactedUseCase(rep1Actor, rep2LeadId, db)).rejects.toThrow('not found');
  });

  it('rejects invalid transition CONTACTED -> CONTACTED', async () => {
    await markLeadContactedUseCase(rep1Actor, rep1LeadId, db);
    await expect(markLeadContactedUseCase(rep1Actor, rep1LeadId, db)).rejects.toThrow('Invalid lead status transition');
  });

  it('rejects invalid transition DISQUALIFIED -> CONTACTED', async () => {
    await disqualifyLeadUseCase(rep1Actor, rep1LeadId, { reasonId: disqualifyReasonId, note: 'Test' }, db);
    await expect(markLeadContactedUseCase(rep1Actor, rep1LeadId, db)).rejects.toThrow('Invalid lead status transition');
  });
});

describe('Application Service - disqualifyLeadUseCase', () => {
  let rep1LeadId: string;
  let rep2LeadId: string;
  let holdReasonId: string;

  beforeEach(async () => {
    const lead1 = await createTestLead(repUser1.id);
    rep1LeadId = lead1.id;

    const lead2 = await createTestLead(repUser2.id);
    rep2LeadId = lead2.id;

    const { rows } = await db.query('SELECT id FROM crm_outcome_reason WHERE kind = \'hold\' AND is_active = true LIMIT 1');
    holdReasonId = rows[0]?.id;
  });

  it('allows SALES_REP to disqualify own lead with valid reason and note', async () => {
    const lead = await disqualifyLeadUseCase(rep1Actor, rep1LeadId, { reasonId: disqualifyReasonId, note: 'Not interested' }, db);
    expect(lead.status).toBe('DISQUALIFIED');
    expect(lead.disqualifyReasonId).toBe(disqualifyReasonId);
    expect(lead.note).toBe('Not interested');
    expect(lead.disqualifiedAt).toBeDefined();
  });

  it('allows ADMIN to disqualify any lead', async () => {
    const lead = await disqualifyLeadUseCase(adminActor, rep2LeadId, { reasonId: disqualifyReasonId, note: 'Test' }, db);
    expect(lead.status).toBe('DISQUALIFIED');
  });

  it('allows SALES_MANAGER to disqualify any lead', async () => {
    const lead = await disqualifyLeadUseCase(managerActor, rep2LeadId, { reasonId: disqualifyReasonId, note: 'Test' }, db);
    expect(lead.status).toBe('DISQUALIFIED');
  });

  it('rejects disqualification without required note for "other" reason', async () => {
    const { rows } = await db.query('SELECT id FROM crm_outcome_reason WHERE kind = \'disqualify\' AND code = \'other\' AND is_active = true LIMIT 1');
    const otherReasonId = rows[0]?.id;
    if (!otherReasonId) return;

    await expect(disqualifyLeadUseCase(rep1Actor, rep1LeadId, { reasonId: otherReasonId, note: null }, db)).rejects.toThrow('requires a note');
  });

  it('rejects invalid/inactive disqualify reason', async () => {
    const { rows } = await db.query('SELECT id FROM crm_outcome_reason WHERE kind = \'disqualify\' AND is_active = false LIMIT 1');
    const inactiveReasonId = rows[0]?.id;
    if (!inactiveReasonId) return;

    await expect(disqualifyLeadUseCase(rep1Actor, rep1LeadId, { reasonId: inactiveReasonId, note: 'Test' }, db)).rejects.toThrow('not active');
  });

  it('rejects hold/lost reason used for disqualification', async () => {
    if (!holdReasonId) return;

    await expect(disqualifyLeadUseCase(rep1Actor, rep1LeadId, { reasonId: holdReasonId, note: 'Test' }, db)).rejects.toThrow('must be "disqualify"');
  });

  it('rejects disqualifying already DISQUALIFIED lead', async () => {
    await disqualifyLeadUseCase(rep1Actor, rep1LeadId, { reasonId: disqualifyReasonId, note: 'Test' }, db);
    await expect(disqualifyLeadUseCase(rep1Actor, rep1LeadId, { reasonId: disqualifyReasonId, note: 'Test' }, db)).rejects.toThrow('Invalid lead status transition');
  });
});

describe('Application Service - listLeadsUseCase and getLeadDetailUseCase', () => {
  let rep2LeadId: string;

  beforeAll(async () => {
    // Clean up leads from previous tests
    await db.query('DELETE FROM crm_lead');

    await createTestLead(repUser1.id);

    const lead2 = await createTestLead(repUser2.id);
    rep2LeadId = lead2.id;

    const lead3 = await createTestLead(repUser1.id);
    await markLeadContacted(db, lead3.id, { userId: repUser1.id, role: 'SALES_REP' });

    const lead4 = await createTestLead(repUser2.id);
    await disqualifyLead(db, lead4.id, { userId: repUser2.id, role: 'SALES_REP' }, { reasonId: disqualifyReasonId, note: 'Test' });
  });

  it('enforces row-scope for SALES_REP in listLeadsUseCase', async () => {
    const result = await listLeadsUseCase(rep1Actor, {}, db);
    expect(result.total).toBe(2);
    expect(result.leads.every((l) => l.ownerUserId === repUser1.id)).toBe(true);
  });

  it('allows ADMIN to see all leads in listLeadsUseCase', async () => {
    const result = await listLeadsUseCase(adminActor, {}, db);
    expect(result.total).toBe(4);
  });

  it('enforces row-scope for SALES_REP in getLeadDetailUseCase', async () => {
    const lead = await getLeadDetailUseCase(rep1Actor, rep2LeadId, db);
    expect(lead).toBeNull();
  });

  it('allows ADMIN to access any lead detail', async () => {
    const lead = await getLeadDetailUseCase(adminActor, rep2LeadId, db);
    expect(lead).not.toBeNull();
    expect(lead?.id).toBe(rep2LeadId);
  });
});

describe('Application Service - catalog actions', () => {
  it('getSourceCampaignsUseCase returns campaigns for valid source', async () => {
    const campaigns = await getSourceCampaignsUseCase('website', db);
    expect(Array.isArray(campaigns)).toBe(true);
    expect(campaigns.length).toBeGreaterThan(0);
    expect(campaigns.every((c) => c.id && c.code && c.name)).toBe(true);
  });

  it('getSourceCampaignsUseCase returns empty array for invalid source', async () => {
    const campaigns = await getSourceCampaignsUseCase('nonexistent', db);
    expect(campaigns).toEqual([]);
  });

  it('getLeadCaptureCatalogUseCase returns active sources and categories', async () => {
    const catalog = await getLeadCaptureCatalogUseCase(db);
    expect(catalog.sources.length).toBeGreaterThan(0);
    expect(catalog.productCategories.length).toBeGreaterThan(0);
    expect(catalog.sources.every((s) => s.id && s.code && s.name)).toBe(true);
    expect(catalog.productCategories.every((c) => c.id && c.code && c.name)).toBe(true);
  });

  it('getDisqualifyReasonsUseCase returns only disqualify reasons', async () => {
    const reasons = await getDisqualifyReasonsUseCase(db);
    expect(Array.isArray(reasons)).toBe(true);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every((r) => r.id && r.code && r.label && typeof r.requiresNote === 'boolean')).toBe(true);
  });

  it('getAssignableOwnersUseCase returns only active SALES_REP and SALES_MANAGER', async () => {
    const owners = await getAssignableOwnersUseCase(db);
    expect(Array.isArray(owners)).toBe(true);
    expect(owners.length).toBeGreaterThan(0);
    expect(owners.every((o) => o.id && o.displayName && o.email && ['SALES_REP', 'SALES_MANAGER'].includes(o.role))).toBe(true);
    expect(owners.some((o) => o.id === inactiveRepUser.id)).toBe(false);
    expect(owners.some((o) => o.id === adminUser.id)).toBe(false);
  });
});
