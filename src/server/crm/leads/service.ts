import { Pool, PoolClient, Client } from 'pg';
import { db as defaultDb } from '@/server/db/client';
import type { Db } from '@/server/db/types';
import {
  createLead,
  listLeads,
  markLeadContacted,
  disqualifyLead,
  findLeadDetailById,
  findLeadById,
  archiveLead,
  restoreLead,
  updateLead,
  updateLeadAccount,
  resolveOrCreateContact,
  resolvePrimaryAccount,
  IdentityConflictError,
  DuplicateOpenLeadError,
  assertNoOpenLeadForContact,
  LeadNotFoundError,
  LeadAlreadyArchivedError,
  LeadNotArchivedError,
  type Lead,
  type LeadDetail,
  type LeadStatus,
  type LeadListCounts,
} from './repository';
import {
  createAccount,
  linkContactToAccount,
} from '@/server/crm/accounts/repository';
import { beginTransaction, commitTransaction, rollbackTransaction } from '@/server/db/transaction';
import { notify, notifyLeadReceived } from '@/server/crm/notifications/repository';
import { findSourceByCode, listSourceCampaigns, findProductCategoryByCode, listProductCategories, listSources } from '@/server/crm/catalog/repository';
import type { Role } from '@/server/authz/permissions';
import { checkAssignableOwner, listAssignableOwners } from '@/server/crm/scope';

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
  | {
      ok: false;
      error: 'VALIDATION' | 'UNAUTHORISED' | 'SOURCE_NOT_FOUND' | 'CAMPAIGN_MISMATCH' | 'CATEGORY_NOT_FOUND' | 'OWNER_NOT_FOUND' | 'IDENTITY_CONFLICT' | 'DUPLICATE_LEAD' | 'INTERNAL';
      message: string;
      conflict?: { phoneContactId: string; emailContactId: string };
      // DUPLICATE_LEAD only, and only when the actor may open that lead.
      existingLeadId?: string;
      // DUPLICATE_LEAD only: who is already working the contact.
      existingOwnerName?: string;
    };

export type Actor = { userId: string; role: Role };

function ownerFailure<E extends 'UNAUTHORISED' | 'OWNER_NOT_FOUND'>(
  error: E,
): { ok: false; error: E; message: string } {
  return error === 'UNAUTHORISED'
    ? { ok: false, error, message: 'You cannot give this lead to that person.' }
    : { ok: false, error, message: 'Owner must be an active Sales Rep, Team Leader or Sales Manager.' };
}

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
      const check = await checkAssignableOwner(database, actor, input.ownerUserId);
      if (!check.ok) return ownerFailure(check.error);
      ownerUserId = check.owner.id;
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

    // One open lead per contact: a repeat inquiry belongs on the lead already
    // being worked. Checked under a per-contact lock so two simultaneous
    // captures cannot both pass.
    try {
      await assertNoOpenLeadForContact(client, contactId);
    } catch (error) {
      if (!(error instanceof DuplicateOpenLeadError)) throw error;
      await client.query('ROLLBACK');
      // Only link to the existing lead when the actor could open it anyway.
      const mayOpen = (await findLeadById(client, error.existingLeadId, actor)) !== null;
      return {
        ok: false,
        error: 'DUPLICATE_LEAD',
        message: error.message,
        existingOwnerName: error.ownerName,
        ...(mayOpen ? { existingLeadId: error.existingLeadId } : {}),
      };
    }

    const lead = await createLead(client, {
      sourceId: source.id,
      campaignId,
      contactId,
      accountId,
      productCategoryId,
      note: input.note ?? null,
      ownerUserId,
    });

    // The owner hears the lead is theirs; managers hear a lead arrived.
    await notify(client, { recipientUserId: ownerUserId, kind: 'LEAD_ASSIGNED', actorUserId: actor.userId, leadId: lead.id });
    await notifyLeadReceived(client, { leadId: lead.id, ownerUserId, actorUserId: actor.userId });

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

export async function listLeadsUseCase(actor: Actor, options: { status?: LeadStatus; archiveFilter?: 'active' | 'archived' | 'all'; search?: string; limit?: number; offset?: number } = {}, db?: Db): Promise<{ leads: Lead[]; total: number; counts: LeadListCounts }> {
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

/** Who the actor may give a lead to: everyone for a manager, the team for a team leader. */
export async function getAssignableOwnersUseCase(
  actor: Actor,
  db?: Db,
): Promise<{ id: string; displayName: string; email: string; role: string }[]> {
  return listAssignableOwners(getDb(db), actor);
}

export async function archiveLeadUseCase(actor: Actor, leadId: string, db?: Db): Promise<Lead> {
  const database = getDb(db);
  return archiveLead(database, leadId, { userId: actor.userId, role: actor.role });
}

export async function restoreLeadUseCase(actor: Actor, leadId: string, db?: Db): Promise<Lead> {
  const database = getDb(db);
  return restoreLead(database, leadId, { userId: actor.userId, role: actor.role });
}

export type UpdateLeadInput = {
  sourceCode?: string | null;
  campaignCode?: string | null;
  productCategoryCode?: string | null;
  note?: string | null;
  ownerUserId?: string | null;
  contact?: {
    fullName?: string;
    phone?: string | null;
    email?: string | null;
  };
};

export type UpdateLeadResult =
  | { ok: true; lead: LeadDetail }
  | { ok: false; error: 'VALIDATION' | 'UNAUTHORISED' | 'NOT_FOUND' | 'IDENTITY_CONFLICT' | 'SOURCE_NOT_FOUND' | 'CAMPAIGN_MISMATCH' | 'CATEGORY_NOT_FOUND' | 'OWNER_NOT_FOUND' | 'INTERNAL'; message: string; conflict?: { phoneContactId: string; emailContactId: string } };

export async function updateLeadUseCase(actor: Actor, leadId: string, input: UpdateLeadInput, db?: Db): Promise<UpdateLeadResult> {
  const database = getDb(db);

  // Verify lead exists and actor has access
  const existingLead = await findLeadById(database, leadId, { userId: actor.userId, role: actor.role });
  if (!existingLead) {
    return { ok: false, error: 'NOT_FOUND', message: 'Lead not found.' };
  }

  // Resolve source if provided
  let sourceId: string | null | undefined = undefined;
  if (input.sourceCode !== undefined) {
    if (input.sourceCode === null) {
      sourceId = null;
    } else {
      const source = await findSourceByCode(database, input.sourceCode);
      if (!source || !source.isActive) {
        return { ok: false, error: 'SOURCE_NOT_FOUND', message: 'Source not found or inactive.' };
      }
      sourceId = source.id;
    }
  }

  // Resolve campaign if provided
  let campaignId: string | null | undefined = undefined;
  if (input.campaignCode !== undefined) {
    if (input.campaignCode === null) {
      campaignId = null;
    } else {
      const sourceIdForCampaign = sourceId ?? existingLead.sourceId;
      const campaigns = await listSourceCampaigns(database, sourceIdForCampaign);
      const campaign = campaigns.find((c) => c.code === input.campaignCode);
      if (!campaign || !campaign.isActive) {
        return { ok: false, error: 'CAMPAIGN_MISMATCH', message: 'Campaign not found, inactive, or does not belong to the selected source.' };
      }
      campaignId = campaign.id;
    }
  }

  // Resolve product category if provided
  let productCategoryId: string | null | undefined = undefined;
  if (input.productCategoryCode !== undefined) {
    if (input.productCategoryCode === null) {
      productCategoryId = null;
    } else {
      const category = await findProductCategoryByCode(database, input.productCategoryCode);
      if (!category || !category.isActive) {
        return { ok: false, error: 'CATEGORY_NOT_FOUND', message: 'Product category not found or inactive.' };
      }
      productCategoryId = category.id;
    }
  }

  // Validate owner if provided (only for MANAGER/ADMIN)
  let ownerUserId: string | null | undefined = undefined;
  if (input.ownerUserId !== undefined) {
    if (actor.role === 'SALES_REP') {
      return ownerFailure('UNAUTHORISED');
    }
    if (input.ownerUserId === null) {
      ownerUserId = null;
    } else {
      const check = await checkAssignableOwner(database, actor, input.ownerUserId);
      if (!check.ok) return ownerFailure(check.error);
      ownerUserId = check.owner.id;
    }
  }

  // Prepare repository input
  const repoInput = {
    sourceId,
    campaignId,
    productCategoryId,
    note: input.note ?? undefined,
    ownerUserId,
    contact: input.contact,
  };

  try {
    await updateLead(database, leadId, { userId: actor.userId, role: actor.role }, repoInput);
    // Return enriched lead detail
    const leadDetail = await findLeadDetailById(database, leadId, { userId: actor.userId, role: actor.role });
    return { ok: true, lead: leadDetail! };
  } catch (error) {
    if (error instanceof IdentityConflictError) {
      return {
        ok: false,
        error: 'IDENTITY_CONFLICT',
        message: error.message,
        conflict: { phoneContactId: error.phoneContactId, emailContactId: error.emailContactId },
      };
    }
    if (error instanceof LeadNotFoundError) {
      return { ok: false, error: 'NOT_FOUND', message: error.message };
    }
    if (error instanceof LeadAlreadyArchivedError) {
      return { ok: false, error: 'VALIDATION', message: 'Lead is already archived.' };
    }
    if (error instanceof LeadNotArchivedError) {
      return { ok: false, error: 'VALIDATION', message: 'Lead is not archived.' };
    }
    // Check for specific error messages from repository
    if (error instanceof Error) {
      if (error.message === 'SOURCE_NOT_FOUND') {
        return { ok: false, error: 'SOURCE_NOT_FOUND', message: 'Source not found or inactive.' };
      }
      if (error.message === 'CAMPAIGN_MISMATCH') {
        return { ok: false, error: 'CAMPAIGN_MISMATCH', message: 'Campaign not found, inactive, or does not belong to the selected source.' };
      }
      if (error.message === 'CATEGORY_NOT_FOUND') {
        return { ok: false, error: 'CATEGORY_NOT_FOUND', message: 'Product category not found or inactive.' };
      }
      if (error.message === 'OWNER_NOT_FOUND') {
        return { ok: false, error: 'OWNER_NOT_FOUND', message: 'Owner not found, inactive, or invalid role.' };
      }
      if (error.message === 'UNAUTHORISED') {
        return { ok: false, error: 'UNAUTHORISED', message: 'Not authorised to perform this action.' };
      }
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Account / clinic workflow
// ---------------------------------------------------------------------------

export type LinkLeadAccountResult =
  | { ok: true; account: { id: string; name: string } }
  | { ok: false; error: 'VALIDATION' | 'NOT_FOUND' | 'ACCOUNT_NOT_FOUND'; message: string };

/**
 * Links a lead's contact to an account/clinic and points the lead at it.
 *
 * Two modes:
 *   - accountId provided: reuse an existing clinic.
 *   - newAccountName provided: create the clinic, then link to it.
 *
 * The contact <-> account link is many-to-many by design (crm_account_contact),
 * so a contact may be linked to several clinics; the lead's own account_id is
 * the "primary clinic for this inquiry" and is updated to the chosen one.
 * Re-linking an already-linked pair is not an error - it is a no-op for the
 * link and still updates the lead reference. Everything lands in one
 * transaction.
 */
export async function linkLeadToAccountUseCase(
  actor: Actor,
  leadId: string,
  input: { accountId?: string | null; newAccountName?: string | null },
  db?: Db,
): Promise<LinkLeadAccountResult> {
  const database = getDb(db);

  const newAccountName = input.newAccountName?.trim();
  if (!input.accountId && !newAccountName) {
    return { ok: false, error: 'VALIDATION', message: 'Choose an existing clinic or name a new one.' };
  }

  const lead = await findLeadById(database, leadId, { userId: actor.userId, role: actor.role });
  if (!lead) {
    return { ok: false, error: 'NOT_FOUND', message: 'Lead not found.' };
  }

  const transaction = await beginTransaction(database);
  const client = transaction.client;
  try {
    let accountId: string;
    let accountName: string;

    if (input.accountId) {
      const existing = await client.query<{ id: string; name: string; is_active: boolean }>(
        `SELECT id, name, is_active FROM crm_account WHERE id = $1`,
        [input.accountId],
      );
      const row = existing.rows[0];
      if (!row || !row.is_active) {
        await rollbackTransaction(client);
        return { ok: false, error: 'ACCOUNT_NOT_FOUND', message: 'Clinic not found or inactive.' };
      }
      accountId = row.id;
      accountName = row.name;
    } else {
      if (newAccountName!.length > 200) {
        await rollbackTransaction(client);
        return { ok: false, error: 'VALIDATION', message: 'Clinic name must be 200 characters or fewer.' };
      }
      const created = await createAccount(client, { name: newAccountName! });
      accountId = created.id;
      accountName = created.name;
    }

    // The contact <-> account pair is UNIQUE. A failed INSERT would abort the
    // surrounding transaction even if the error is caught, so check first and
    // only insert a link that does not exist yet.
    const { rows: linkRows } = await client.query<{ id: string }>(
      `SELECT id FROM crm_account_contact WHERE account_id = $1 AND contact_id = $2`,
      [accountId, lead.contactId],
    );
    if (linkRows.length === 0) {
      await linkContactToAccount(client, { accountId, contactId: lead.contactId });
    }

    await updateLeadAccount(client, leadId, { userId: actor.userId, role: actor.role }, accountId);

    await commitTransaction(client);
    return { ok: true, account: { id: accountId, name: accountName } };
  } catch (error) {
    await rollbackTransaction(client);
    if (error instanceof LeadNotFoundError) {
      return { ok: false, error: 'NOT_FOUND', message: error.message };
    }
    if (error instanceof Error && error.message === 'ACCOUNT_NOT_FOUND') {
      return { ok: false, error: 'ACCOUNT_NOT_FOUND', message: 'Clinic not found.' };
    }
    throw error;
  } finally {
    transaction.release();
  }
}