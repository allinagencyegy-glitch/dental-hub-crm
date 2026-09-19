import { Pool, PoolClient, Client } from 'pg';
import { db as defaultDb } from '@/server/db/client';
import type { Db } from '@/server/db/types';
import {
  createLead,
  listLeads,
  markLeadContacted,
  disqualifyLead,
  findLeadDetailById,
  resolveOrCreateContact,
  resolvePrimaryAccount,
  IdentityConflictError,
  type Lead,
  type LeadDetail,
  type LeadStatus,
} from './repository';
import { findSourceByCode, listSourceCampaigns, findProductCategoryByCode, listProductCategories, listSources } from '@/server/crm/catalog/repository';
import { findUserById, listUsers } from '@/server/users/repository';

function getDb(db?: Db): Db {
  return db ?? defaultDb();
}

export type CaptureLeadInput = {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  sourceCode: string;
  campaignCode?: string | null;
  productCategoryCode?: string | null;
  note?: string | null;
  ownerUserId?: string | null;
};

export type CaptureLeadResult =
  | { ok: true; leadId: string }
  | { ok: false; error: 'VALIDATION' | 'UNAUTHORISED' | 'SOURCE_NOT_FOUND' | 'CAMPAIGN_MISMATCH' | 'CATEGORY_NOT_FOUND' | 'OWNER_NOT_FOUND' | 'IDENTITY_CONFLICT' | 'INTERNAL'; message: string; conflict?: { phoneContactId: string; emailContactId: string } };

export type Actor = { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' };

export async function captureLeadUseCase(actor: Actor, input: CaptureLeadInput, db?: Db): Promise<CaptureLeadResult> {
  const database = getDb(db);

  // Validate source
  const source = await findSourceByCode(database, input.sourceCode);
  if (!source || !source.isActive) {
    return { ok: false, error: 'SOURCE_NOT_FOUND', message: 'Source not found or inactive.' };
  }

  // Validate campaign (if provided)
  let campaignId: string | null = null;
  if (input.campaignCode) {
    const campaigns = await listSourceCampaigns(database, source.id);
    const campaign = campaigns.find((c) => c.code === input.campaignCode);
    if (!campaign || !campaign.isActive) {
      return { ok: false, error: 'CAMPAIGN_MISMATCH', message: 'Campaign not found, inactive, or does not belong to the selected source.' };
    }
    campaignId = campaign.id;
  }

  // Validate product category (if provided)
  let productCategoryId: string | null = null;
  if (input.productCategoryCode) {
    const category = await findProductCategoryByCode(database, input.productCategoryCode);
    if (!category || !category.isActive) {
      return { ok: false, error: 'CATEGORY_NOT_FOUND', message: 'Product category not found or inactive.' };
    }
    productCategoryId = category.id;
  }

  // Determine owner
  let ownerUserId: string;
  if (actor.role === 'SALES_REP') {
    ownerUserId = actor.userId;
  } else {
    if (input.ownerUserId) {
      const owner = await findUserById(database, input.ownerUserId);
      if (!owner || !owner.is_active) {
        return { ok: false, error: 'OWNER_NOT_FOUND', message: 'Owner not found or inactive.' };
      }
      if (!['SALES_REP', 'SALES_MANAGER'].includes(owner.role)) {
        return { ok: false, error: 'OWNER_NOT_FOUND', message: 'Owner must be a Sales Rep or Sales Manager.' };
      }
      ownerUserId = owner.id;
    } else {
      ownerUserId = actor.userId;
    }
  }

  // Resolve or create contact
  let contactId: string;
  try {
    const result = await resolveOrCreateContact(database, {
      fullName: input.fullName,
      phone: input.phone ?? undefined,
      email: input.email ?? undefined,
    });
    contactId = result.contactId;
  } catch (error) {
    if (error instanceof IdentityConflictError) {
      return {
        ok: false,
        error: 'IDENTITY_CONFLICT',
        message: error.message,
        conflict: { phoneContactId: error.phoneContactId, emailContactId: error.emailContactId },
      };
    }
    throw error;
  }

  // Resolve primary account for the contact
  const accountId = await resolvePrimaryAccount(database, contactId);

  // Create lead in a transaction
  let client: PoolClient | Client;
  let shouldRelease = false;
  if (database instanceof Pool) {
    client = await database.connect();
    shouldRelease = true;
  } else {
    client = database;
  }
  try {
    await client.query('BEGIN');

    const lead = await createLead(client, {
      sourceId: source.id,
      campaignId,
      contactId,
      accountId,
      productCategoryId,
      note: input.note ?? null,
      ownerUserId,
    });

    await client.query('COMMIT');
    return { ok: true, leadId: lead.id };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (shouldRelease && 'release' in client) {
      client.release();
    }
  }
}

export async function listLeadsUseCase(actor: Actor, options: { status?: LeadStatus; limit?: number; offset?: number } = {}, db?: Db): Promise<{ leads: Lead[]; total: number }> {
  const database = getDb(db);
  return listLeads(database, { userId: actor.userId, role: actor.role }, options);
}

export async function getLeadDetailUseCase(actor: Actor, leadId: string, db?: Db): Promise<LeadDetail | null> {
  const database = getDb(db);
  return findLeadDetailById(database, leadId, { userId: actor.userId, role: actor.role });
}

export async function markLeadContactedUseCase(actor: Actor, leadId: string, db?: Db): Promise<Lead> {
  const database = getDb(db);
  return markLeadContacted(database, leadId, { userId: actor.userId, role: actor.role });
}

export async function disqualifyLeadUseCase(actor: Actor, leadId: string, input: { reasonId: string; note?: string | null }, db?: Db): Promise<Lead> {
  const database = getDb(db);
  return disqualifyLead(database, leadId, { userId: actor.userId, role: actor.role }, input);
}

export async function getLeadCaptureCatalogUseCase(db?: Db): Promise<{
  sources: { id: string; code: string; name: string }[];
  productCategories: { id: string; code: string; name: string }[];
}> {
  const database = getDb(db);
  const [sources, productCategories] = await Promise.all([
    listSources(database),
    listProductCategories(database),
  ]);

  return {
    sources: sources.filter((s) => s.isActive).map((s) => ({ id: s.id, code: s.code, name: s.name })),
    productCategories: productCategories.filter((c) => c.isActive).map((c) => ({ id: c.id, code: c.code, name: c.name })),
  };
}

export async function getSourceCampaignsUseCase(sourceCode: string, db?: Db): Promise<{ id: string; code: string; name: string }[]> {
  const database = getDb(db);
  const source = await findSourceByCode(database, sourceCode);
  if (!source) return [];

  const campaigns = await listSourceCampaigns(database, source.id);
  return campaigns.filter((c) => c.isActive).map((c) => ({ id: c.id, code: c.code, name: c.name }));
}

export async function getDisqualifyReasonsUseCase(db?: Db): Promise<{ id: string; code: string; label: string; requiresNote: boolean }[]> {
  const database = getDb(db);
  const { rows } = await database.query<{ id: string; code: string; label: string; requires_note: boolean }>(
    `SELECT id, code, label, requires_note FROM crm_outcome_reason WHERE kind = 'disqualify' AND is_active = true ORDER BY code ASC`,
  );

  return rows.map((r) => ({ id: r.id, code: r.code, label: r.label, requiresNote: r.requires_note }));
}

export async function getAssignableOwnersUseCase(db?: Db): Promise<{ id: string; displayName: string; email: string; role: string }[]> {
  const database = getDb(db);
  const users = await listUsers(database);
  return users
    .filter((u) => u.isActive && ['SALES_REP', 'SALES_MANAGER'].includes(u.role))
    .map((u) => ({ id: u.id, displayName: u.displayName, email: u.email, role: u.role }));
}