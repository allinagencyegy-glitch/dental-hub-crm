/**
 * All SQL touching crm_lead.
 *
 * Lead status lifecycle for Slice 2A:
 *   NEW → CONTACTED → DISQUALIFIED
 *
 * Conversion to opportunity is the next slice.
 *
 * Identity resolution:
 *   - Normalize phone (E.164) and email (lowercase trimmed)
 *   - Look up both
 *   - If neither exists: create Contact atomically
 *   - If both resolve to SAME contact: reuse
 *   - If only one resolves: reuse
 *   - If they resolve to DIFFERENT contacts: IdentityConflictError
 *   - Concurrent creation: handle unique violation, re-query, return canonical
 *
 * Row-scope authorization is enforced at the query layer: SALES_REP sees only
 * own leads; SALES_MANAGER/ADMIN see all.
 */
import type { Db } from '@/server/db/types';
import { Pool, PoolClient } from 'pg';
import { likePattern } from '@/server/db/like';
import { normaliseEmail } from '@/server/users/repository';
import { normalisePhoneToE164 } from '@/server/crm/contacts/phone';
import { createContact, findContactByPhone, DuplicatePhoneError, DuplicateContactEmailError } from '@/server/crm/contacts/repository';
import { listAccountsForContact } from '@/server/crm/accounts/repository';

export type LeadStatus = 'NEW' | 'CONTACTED' | 'DISQUALIFIED';

export interface Lead {
  id: string;
  sourceId: string;
  sourceName: string;
  campaignId: string | null;
  contactId: string;
  contactName: string;
  accountId: string | null;
  accountName: string | null;
  productCategoryId: string | null;
  productCategoryName: string | null;
  status: LeadStatus;
  note: string | null;
  ownerUserId: string;
  ownerName: string;
  receivedAt: Date;
  disqualifiedAt: Date | null;
  disqualifyReasonId: string | null;
  archivedAt: Date | null;
  archivedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type LeadRow = {
  id: string;
  source_id: string;
  source_name: string;
  campaign_id: string | null;
  contact_id: string;
  contact_full_name: string;
  account_id: string | null;
  account_name: string | null;
  product_category_id: string | null;
  product_category_name: string | null;
  status: LeadStatus;
  note: string | null;
  owner_user_id: string;
  owner_display_name: string;
  received_at: Date;
  disqualified_at: Date | null;
  disqualify_reason_id: string | null;
  archived_at: Date | null;
  archived_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    campaignId: row.campaign_id,
    contactId: row.contact_id,
    contactName: row.contact_full_name,
    accountId: row.account_id,
    accountName: row.account_name,
    productCategoryId: row.product_category_id,
    productCategoryName: row.product_category_name,
    status: row.status,
    note: row.note,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_display_name,
    receivedAt: row.received_at,
    disqualifiedAt: row.disqualified_at,
    disqualifyReasonId: row.disqualify_reason_id,
    archivedAt: row.archived_at,
    archivedByUserId: row.archived_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const LEAD_COLUMNS = `
  l.id,
  l.source_id,
  l.campaign_id,
  l.contact_id,
  l.account_id,
  l.product_category_id,
  l.status,
  l.note,
  l.owner_user_id,
  l.received_at,
  l.disqualified_at,
  l.disqualify_reason_id,
  l.archived_at,
  l.archived_by_user_id,
  l.created_at,
  l.updated_at
`;

const LEAD_RETURNING_COLUMNS = `
  id,
  source_id,
  campaign_id,
  contact_id,
  account_id,
  product_category_id,
  status,
  note,
  owner_user_id,
  received_at,
  disqualified_at,
  disqualify_reason_id,
  archived_at,
  archived_by_user_id,
  created_at,
  updated_at
`;

const LEAD_LIST_COLUMNS = `
  ${LEAD_COLUMNS},
  s.name AS source_name,
  c.full_name AS contact_full_name,
  a.name AS account_name,
  pc.name AS product_category_name,
  u.display_name AS owner_display_name
`;

/**
 * Joins shared by list and count queries. `sc` (campaign) only exists here so
 * search can match a campaign by name; no campaign column is selected.
 */
const LEAD_LIST_JOINS = `
  JOIN crm_source s ON s.id = l.source_id
  JOIN crm_contact c ON c.id = l.contact_id
  LEFT JOIN crm_account a ON a.id = l.account_id
  LEFT JOIN crm_product_category pc ON pc.id = l.product_category_id
  JOIN crm_user u ON u.id = l.owner_user_id
  LEFT JOIN crm_source_campaign sc ON sc.id = l.campaign_id
`;

export class IdentityConflictError extends Error {
  public readonly phoneContactId: string;
  public readonly emailContactId: string;

  constructor(phoneContactId: string, emailContactId: string) {
    super(`Phone and email resolve to different contacts (${phoneContactId} vs ${emailContactId}). Manual resolution required.`);
    this.name = 'IdentityConflictError';
    this.phoneContactId = phoneContactId;
    this.emailContactId = emailContactId;
  }
}

export class LeadNotFoundError extends Error {
  constructor(id: string) {
    super(`Lead ${id} not found.`);
    this.name = 'LeadNotFoundError';
  }
}

export class LeadForbiddenError extends Error {
  constructor() {
    super('Not authorised to access this lead.');
    this.name = 'LeadForbiddenError';
  }
}

export class InvalidLeadStatusTransitionError extends Error {
  constructor(from: LeadStatus, to: LeadStatus) {
    super(`Invalid lead status transition: ${from} → ${to}.`);
    this.name = 'InvalidLeadStatusTransitionError';
  }
}

export class InvalidDisqualifyReasonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDisqualifyReasonError';
  }
}

export class LeadAlreadyArchivedError extends Error {
  constructor() {
    super('Lead is already archived.');
    this.name = 'LeadAlreadyArchivedError';
  }
}

export class LeadNotArchivedError extends Error {
  constructor() {
    super('Lead is not archived.');
    this.name = 'LeadNotArchivedError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

/**
 * Resolves or creates a contact from inbound identity information.
 *
 * Rules:
 * - Normalize phone (E.164) and email (lowercase trimmed)
 * - Look up both
 * - Neither exists → create Contact atomically
 * - Both resolve to SAME contact → reuse
 * - Only one resolves → reuse existing
 * - Phone and email resolve to DIFFERENT contacts → IdentityConflictError
 * - Concurrent creation → handle unique violation, re-query, return canonical
 */
export async function resolveOrCreateContact(
  db: Db,
  input: { fullName: string; phone?: string | null; email?: string | null },
): Promise<{ contactId: string; created: boolean }> {
  const { fullName, phone, email } = input;

  const normalizedPhone = phone?.trim() ? normalisePhoneToE164(phone.trim()) : null;
  const normalizedEmail = email?.trim() ? normaliseEmail(email.trim()) : null;

  if (!normalizedPhone && !normalizedEmail) {
    throw new Error('At least one of phone or email must be provided for identity resolution.');
  }

  // Look up existing contacts by phone and email
  const phoneContact = normalizedPhone ? await findContactByPhone(db, normalizedPhone) : null;
  const emailContact = normalizedEmail
    ? await db
        .query<{ id: string; full_name: string; email: string | null; is_active: boolean }>(
          `SELECT id, full_name, email, is_active FROM crm_contact WHERE email = $1`,
          [normalizedEmail],
        )
        .then(({ rows }) => (rows[0] ? { id: rows[0].id, full_name: rows[0].full_name, email: rows[0].email, is_active: rows[0].is_active } : null))
    : null;

  // Both resolve to same contact
  if (phoneContact && emailContact && phoneContact.id === emailContact.id) {
    return { contactId: phoneContact.id, created: false };
  }

  // Only phone resolves
  if (phoneContact && !emailContact) {
    return { contactId: phoneContact.id, created: false };
  }

  // Only email resolves
  if (!phoneContact && emailContact) {
    return { contactId: emailContact.id, created: false };
  }

  // Both resolve to DIFFERENT contacts - conflict
  if (phoneContact && emailContact && phoneContact.id !== emailContact.id) {
    throw new IdentityConflictError(phoneContact.id, emailContact.id);
  }

  // Neither exists - create new contact atomically
  try {
    const contact = await createContact(db, {
      fullName: fullName.trim(),
      email: normalizedEmail ?? undefined,
    });

    // Add phone channel if provided
    if (normalizedPhone) {
      try {
        await db.query(
          `INSERT INTO crm_contact_channel (contact_id, channel_type, value) VALUES ($1, 'PHONE', $2)`,
          [contact.id, normalizedPhone],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Race: another transaction claimed this phone. Re-query.
          const existing = await findContactByPhone(db, normalizedPhone);
          if (existing) {
            return { contactId: existing.id, created: false };
          }
        }
        throw error;
      }
    }

    return { contactId: contact.id, created: true };
  } catch (error) {
    // Handle concurrent creation races
    if (error instanceof DuplicateContactEmailError && normalizedEmail) {
      const existing = await db
        .query<{ id: string }>('SELECT id FROM crm_contact WHERE email = $1', [normalizedEmail])
        .then(({ rows }) => rows[0]?.id);
      if (existing) return { contactId: existing, created: false };
    }
    if (error instanceof DuplicatePhoneError && normalizedPhone) {
      const existing = await findContactByPhone(db, normalizedPhone);
      if (existing) return { contactId: existing.id, created: false };
    }
    throw error;
  }
}

/**
 * Resolves the primary account for a contact, if any.
 * Returns the first primary account, or the first account if no primary is set.
 */
export async function resolvePrimaryAccount(db: Db, contactId: string): Promise<string | null> {
  const accounts = await listAccountsForContact(db, contactId);
  if (accounts.length === 0) return null;

  const primary = accounts.find((a) => a.isPrimary);
  return primary?.accountId ?? accounts[0].accountId;
}

/**
 * Creates a new lead.
 * Caller must have already resolved the contact and (optionally) account.
 * New leads are always created with status = 'NEW'.
 */
export async function createLead(
  db: Db,
  input: {
    sourceId: string;
    campaignId: string | null;
    contactId: string;
    accountId: string | null;
    productCategoryId: string | null;
    note: string | null;
    ownerUserId: string;
    receivedAt?: Date;
  },
): Promise<Lead> {
  const receivedAt = input.receivedAt ?? new Date();
  const note = input.note?.trim() || null;

  const { rows } = await db.query<LeadRow>(
    `INSERT INTO crm_lead (
       source_id, campaign_id, contact_id, account_id, product_category_id,
       note, owner_user_id, received_at, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NEW')
     RETURNING ${LEAD_RETURNING_COLUMNS}`,
    [
      input.sourceId,
      input.campaignId,
      input.contactId,
      input.accountId,
      input.productCategoryId,
      note,
      input.ownerUserId,
      receivedAt,
    ],
  );

  return toLead(rows[0]);
}

/**
 * Finds a lead by ID with row-scope authorization.
 * SALES_REP can only access leads they own.
 * SALES_MANAGER/ADMIN can access all leads.
 */
export async function findLeadById(
  db: Db,
  leadId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
): Promise<Lead | null> {
  let whereClause = 'WHERE l.id = $1';
  const params: (string | string[]) = [leadId];

  if (actor.role === 'SALES_REP') {
    whereClause += ' AND l.owner_user_id = $2';
    params.push(actor.userId);
  }

  const { rows } = await db.query<LeadRow>(
    `SELECT ${LEAD_COLUMNS} FROM crm_lead l ${whereClause}`,
    params,
  );

  return rows[0] ? toLead(rows[0]) : null;
}

/**
 * Lists leads with row-scope authorization, pagination, archive filtering and
 * text search.
 *
 * SALES_REP sees only own leads; SALES_MANAGER/ADMIN see all.
 * archiveFilter: 'active' (default, archived_at IS NULL), 'archived'
 * (archived_at IS NOT NULL), 'all' (both).
 *
 * search matches, case-insensitively, the contact's name, any phone/email
 * channel, the account/clinic name, source name, campaign name, product
 * category name, owner display name and the lead reference id. The term is
 * escaped, so it always matches literally.
 */
export async function listLeads(
  db: Db,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
  options: { status?: LeadStatus; archiveFilter?: 'active' | 'archived' | 'all'; search?: string; limit?: number; offset?: number } = {},
): Promise<{ leads: Lead[]; total: number }> {
  const { status, archiveFilter = 'active', search, limit = 50, offset = 0 } = options;

  let whereClause = '';
  const params: (string | number)[] = [];

  if (actor.role === 'SALES_REP') {
    whereClause = 'WHERE l.owner_user_id = $1';
    params.push(actor.userId);
  }

  // Archive filter
  const archiveCondition = archiveFilter === 'active' ? 'l.archived_at IS NULL' : archiveFilter === 'archived' ? 'l.archived_at IS NOT NULL' : null;
  if (archiveCondition) {
    if (whereClause) {
      whereClause += ` AND ${archiveCondition}`;
    } else {
      whereClause = `WHERE ${archiveCondition}`;
    }
  }

  if (status) {
    if (whereClause) {
      whereClause += ` AND l.status = $${params.length + 1}`;
    } else {
      whereClause = `WHERE l.status = $${params.length + 1}`;
    }
    params.push(status);
  }

  if (search !== undefined && search.trim() !== '') {
    const pattern = likePattern(search.trim());
    const placeholder = `$${params.length + 1}`;
    const clause = `(
      c.full_name ILIKE ${placeholder} ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM crm_contact_channel ch
         WHERE ch.contact_id = c.id AND ch.value ILIKE ${placeholder} ESCAPE '\\'
      )
      OR COALESCE(a.name, '') ILIKE ${placeholder} ESCAPE '\\'
      OR s.name ILIKE ${placeholder} ESCAPE '\\'
      OR COALESCE(sc.name, '') ILIKE ${placeholder} ESCAPE '\\'
      OR COALESCE(pc.name, '') ILIKE ${placeholder} ESCAPE '\\'
      OR u.display_name ILIKE ${placeholder} ESCAPE '\\'
      OR l.id::text LIKE ${placeholder} ESCAPE '\\'
    )`;
    if (whereClause) {
      whereClause += ` AND ${clause}`;
    } else {
      whereClause = `WHERE ${clause}`;
    }
    params.push(pattern);
  }

  const countParams = [...params];
  const { rows: countRows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM crm_lead l
       ${LEAD_LIST_JOINS}
       ${whereClause}`,
    countParams,
  );
  const total = Number(countRows[0].count);

  params.push(limit, offset);
  const { rows } = await db.query<LeadRow>(
    `SELECT ${LEAD_LIST_COLUMNS}
       FROM crm_lead l
       ${LEAD_LIST_JOINS}
       ${whereClause}
       ORDER BY l.received_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { leads: rows.map(toLead), total };
}

/**
 * Marks a lead as CONTACTED.
 * Only allowed from NEW status.
 */
export async function markLeadContacted(
  db: Db,
  leadId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
): Promise<Lead> {
  const lead = await findLeadById(db, leadId, actor);
  if (!lead) throw new LeadNotFoundError(leadId);

  if (lead.status !== 'NEW') {
    throw new InvalidLeadStatusTransitionError(lead.status, 'CONTACTED');
  }

  const { rows } = await db.query<LeadRow>(
    `UPDATE crm_lead SET status = 'CONTACTED', updated_at = now() WHERE id = $1 RETURNING ${LEAD_RETURNING_COLUMNS}`,
    [leadId],
  );

  return toLead(rows[0]);
}

/**
 * Disqualifies a lead.
 * Validates reason exists, kind = 'disqualify', and requires_note policy.
 * Transition: NEW/CONTACTED → DISQUALIFIED
 */
export async function disqualifyLead(
  db: Db,
  leadId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
  input: { reasonId: string; note?: string | null },
): Promise<Lead> {
  const lead = await findLeadById(db, leadId, actor);
  if (!lead) throw new LeadNotFoundError(leadId);

  if (lead.status === 'DISQUALIFIED') {
    throw new InvalidLeadStatusTransitionError(lead.status, 'DISQUALIFIED');
  }
  if (lead.status !== 'NEW' && lead.status !== 'CONTACTED') {
    throw new InvalidLeadStatusTransitionError(lead.status, 'DISQUALIFIED');
  }

  // Validate reason
  const { rows: reasonRows } = await db.query<{ id: string; kind: string; requires_note: boolean; is_active: boolean }>(
    `SELECT id, kind, requires_note, is_active FROM crm_outcome_reason WHERE id = $1`,
    [input.reasonId],
  );

  const reason = reasonRows[0];
  if (!reason) {
    throw new InvalidDisqualifyReasonError('Disqualification reason not found.');
  }
  if (!reason.is_active) {
    throw new InvalidDisqualifyReasonError('Disqualification reason is not active.');
  }
  if (reason.kind !== 'disqualify') {
    throw new InvalidDisqualifyReasonError('Reason kind must be "disqualify".');
  }
  if (reason.requires_note && (!input.note || input.note.trim() === '')) {
    throw new InvalidDisqualifyReasonError('This disqualification reason requires a note.');
  }

  const note = input.note?.trim() || null;
  const disqualifiedAt = new Date();

  const { rows } = await db.query<LeadRow>(
    `UPDATE crm_lead
       SET status = 'DISQUALIFIED',
           disqualified_at = $2,
           disqualify_reason_id = $3,
           note = COALESCE($4, note),
           updated_at = now()
     WHERE id = $1
     RETURNING ${LEAD_RETURNING_COLUMNS}`,
    [leadId, disqualifiedAt, input.reasonId, note],
  );

  return toLead(rows[0]);
}

/**
 * Archives a lead.
 * Sets archived_at = now() and archived_by_user_id = actor.userId.
 * Preserves status, disqualification state, and all relations.
 * Row-scope authorization: SALES_REP can only archive own leads.
 */
export async function archiveLead(
  db: Db,
  leadId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
): Promise<Lead> {
  const lead = await findLeadById(db, leadId, actor);
  if (!lead) throw new LeadNotFoundError(leadId);

  if (lead.archivedAt !== null) {
    throw new LeadAlreadyArchivedError();
  }

  const { rows } = await db.query<LeadRow>(
    `UPDATE crm_lead
       SET archived_at = now(),
           archived_by_user_id = $2,
           updated_at = now()
     WHERE id = $1
     RETURNING ${LEAD_RETURNING_COLUMNS}`,
    [leadId, actor.userId],
  );

  return toLead(rows[0]);
}

/**
 * Restores an archived lead.
 * Clears archived_at and archived_by_user_id.
 * Preserves everything else.
 * Row-scope authorization: SALES_REP can only restore own leads.
 */
export async function restoreLead(
  db: Db,
  leadId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
): Promise<Lead> {
  const lead = await findLeadById(db, leadId, actor);
  if (!lead) throw new LeadNotFoundError(leadId);

  if (lead.archivedAt === null) {
    throw new LeadNotArchivedError();
  }

  const { rows } = await db.query<LeadRow>(
    `UPDATE crm_lead
        SET archived_at = NULL,
            archived_by_user_id = NULL,
            updated_at = now()
      WHERE id = $1
      RETURNING ${LEAD_RETURNING_COLUMNS}`,
    [leadId],
  );

  return toLead(rows[0]);
}

/**
 * Links a lead to an account/clinic.
 *
 * Row-scope authorization: SALES_REP may only change their own leads. The
 * account must exist. The contact <-> account many-to-many link itself is
 * owned by the accounts repository; this function only points the lead's
 * denormalised account reference at the chosen clinic.
 */
export async function updateLeadAccount(
  db: Db,
  leadId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
  accountId: string,
): Promise<Lead> {
  const lead = await findLeadById(db, leadId, actor);
  if (!lead) throw new LeadNotFoundError(leadId);

  const { rows: accountRows } = await db.query<{ id: string }>(
    `SELECT id FROM crm_account WHERE id = $1`,
    [accountId],
  );
  if (!accountRows[0]) throw new Error('ACCOUNT_NOT_FOUND');

  const { rows } = await db.query<LeadRow>(
    `UPDATE crm_lead SET account_id = $2, updated_at = now()
      WHERE id = $1
      RETURNING ${LEAD_RETURNING_COLUMNS}`,
    [leadId, accountId],
  );

  return toLead(rows[0]);
}

/**
 * Updates a lead's editable fields in a single transaction.
 * Editable fields: source, campaign, product category, note, owner (manager/admin only), contact identity.
 * Contact identity changes are validated for conflicts (Cases A-E).
 * All changes succeed or all roll back.
 */
export interface UpdateLeadInput {
  sourceId?: string | null;
  campaignId?: string | null;
  productCategoryId?: string | null;
  note?: string | null;
  ownerUserId?: string | null;
  contact?: {
    fullName?: string;
    phone?: string | null;
    email?: string | null;
  };
}

export async function updateLead(
  db: Db,
  leadId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
  input: UpdateLeadInput,
): Promise<Lead> {
  // First, verify lead exists and actor has access (row-scope)
  const lead = await findLeadById(db, leadId, actor);
  if (!lead) throw new LeadNotFoundError(leadId);

  // Validate catalog references if provided
  if (input.sourceId !== undefined) {
    const { rows } = await db.query<{ id: string; is_active: boolean }>(
      `SELECT id, is_active FROM crm_source WHERE id = $1`,
      [input.sourceId],
    );
    if (!rows[0]) throw new Error('SOURCE_NOT_FOUND');
    if (!rows[0].is_active) throw new Error('SOURCE_NOT_FOUND');
  }

  if (input.campaignId !== undefined && input.campaignId !== null) {
    const { rows } = await db.query<{ id: string; source_id: string; is_active: boolean }>(
      `SELECT id, source_id, is_active FROM crm_source_campaign WHERE id = $1`,
      [input.campaignId],
    );
    if (!rows[0]) throw new Error('CAMPAIGN_MISMATCH');
    if (!rows[0].is_active) throw new Error('CAMPAIGN_MISMATCH');
    if (input.sourceId && rows[0].source_id !== input.sourceId) {
      throw new Error('CAMPAIGN_MISMATCH');
    }
    if (!input.sourceId && lead.sourceId !== rows[0].source_id) {
      throw new Error('CAMPAIGN_MISMATCH');
    }
  }

  if (input.productCategoryId !== undefined && input.productCategoryId !== null) {
    const { rows } = await db.query<{ id: string; is_active: boolean }>(
      `SELECT id, is_active FROM crm_product_category WHERE id = $1`,
      [input.productCategoryId],
    );
    if (!rows[0]) throw new Error('CATEGORY_NOT_FOUND');
    if (!rows[0].is_active) throw new Error('CATEGORY_NOT_FOUND');
  }

  // Validate owner if provided (only for MANAGER/ADMIN)
  if (input.ownerUserId !== undefined && input.ownerUserId !== null) {
    if (actor.role === 'SALES_REP') {
      throw new Error('UNAUTHORISED');
    }
    const { rows } = await db.query<{ id: string; is_active: boolean; role: string }>(
      `SELECT id, is_active, role FROM crm_user WHERE id = $1`,
      [input.ownerUserId],
    );
    if (!rows[0]) throw new Error('OWNER_NOT_FOUND');
    if (!rows[0].is_active) throw new Error('OWNER_NOT_FOUND');
    if (!['SALES_REP', 'SALES_MANAGER'].includes(rows[0].role)) {
      throw new Error('OWNER_NOT_FOUND');
    }
  }

  // Handle contact updates if provided
  let contactId = lead.contactId;
  if (input.contact && (input.contact.fullName !== undefined || input.contact.phone !== undefined || input.contact.email !== undefined)) {
    const contactResult = await resolveContactUpdate(db, lead.contactId, input.contact);
    if (contactResult.conflict) {
      throw contactResult.conflict;
    }
    contactId = contactResult.contactId;
  }

  // Perform all updates in a single transaction
  let client: PoolClient;
  let shouldRelease = false;
  if (db instanceof Pool) {
    client = await db.connect();
    shouldRelease = true;
  } else {
    client = db as PoolClient;
  }

  try {
    await client.query('BEGIN');

    // Update contact if changed
    if (input.contact && (input.contact.fullName !== undefined || input.contact.phone !== undefined || input.contact.email !== undefined)) {
      if (input.contact.fullName !== undefined) {
        await client.query(
          `UPDATE crm_contact SET full_name = $1, updated_at = now() WHERE id = $2`,
          [input.contact.fullName.trim(), contactId],
        );
      }
      if (input.contact.phone !== undefined) {
        // Remove existing phone channels
        await client.query(`DELETE FROM crm_contact_channel WHERE contact_id = $1 AND channel_type = 'PHONE'`, [contactId]);
        if (input.contact.phone !== null && input.contact.phone.trim() !== '') {
          const normalizedPhone = normalisePhoneToE164(input.contact.phone.trim());
          await client.query(
            `INSERT INTO crm_contact_channel (contact_id, channel_type, value) VALUES ($1, 'PHONE', $2)`,
            [contactId, normalizedPhone],
          );
        }
      }
      if (input.contact.email !== undefined) {
        const normalizedEmail = input.contact.email?.trim() ? normaliseEmail(input.contact.email.trim()) : null;
        await client.query(
          `UPDATE crm_contact SET email = $1, updated_at = now() WHERE id = $2`,
          [normalizedEmail, contactId],
        );
      }
    }

    // Update lead fields
    const updates: string[] = [];
    const params: (string | null)[] = [leadId];
    let paramIndex = 2;

    if (input.sourceId !== undefined) {
      updates.push(`source_id = $${paramIndex++}`);
      params.push(input.sourceId);
    }
    if (input.campaignId !== undefined) {
      updates.push(`campaign_id = $${paramIndex++}`);
      params.push(input.campaignId);
    }
    if (input.productCategoryId !== undefined) {
      updates.push(`product_category_id = $${paramIndex++}`);
      params.push(input.productCategoryId);
    }
    if (input.note !== undefined) {
      updates.push(`note = $${paramIndex++}`);
      params.push(input.note?.trim() || null);
    }
    if (input.ownerUserId !== undefined) {
      updates.push(`owner_user_id = $${paramIndex++}`);
      params.push(input.ownerUserId);
    }

    if (updates.length > 0) {
      updates.push('updated_at = now()');
      const query = `UPDATE crm_lead SET ${updates.join(', ')} WHERE id = $1 RETURNING ${LEAD_RETURNING_COLUMNS}`;
      const result = await client.query<LeadRow>(query, params);
      await client.query('COMMIT');
      return toLead(result.rows[0]);
    } else {
      // No lead fields to update, just commit contact changes
      await client.query('COMMIT');
      const lead = await findLeadById(db, leadId, actor);
      if (!lead) throw new LeadNotFoundError(leadId);
      return lead;
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (shouldRelease && 'release' in client) {
      client.release();
    }
  }
}

/**
 * Resolves contact identity updates with conflict detection (Cases A-E).
 * Returns the canonical contact ID or throws IdentityConflictError.
 */
async function resolveContactUpdate(
  db: Db,
  contactId: string,
  input: { fullName?: string; phone?: string | null; email?: string | null },
): Promise<{ contactId: string; conflict?: IdentityConflictError }> {
  const { fullName, phone, email } = input;

  const normalizedPhone = phone?.trim() ? normalisePhoneToE164(phone.trim()) : null;
  const normalizedEmail = email?.trim() ? normaliseEmail(email.trim()) : null;

  // If no phone/email changes, just return current contact
  if (!normalizedPhone && !normalizedEmail) {
    if (fullName !== undefined) {
      // Only name change - safe to update
      return { contactId };
    }
    return { contactId };
  }

  // Look up existing contacts by phone and email (excluding current contact)
  const phoneContact = normalizedPhone
    ? await db
        .query<{ id: string; full_name: string; email: string | null; is_active: boolean }>(
          `SELECT c.id, c.full_name, c.email, c.is_active
             FROM crm_contact c
             JOIN crm_contact_channel ch ON ch.contact_id = c.id
            WHERE ch.channel_type = 'PHONE' AND ch.value = $1 AND c.id != $2`,
          [normalizedPhone, contactId],
        )
        .then(({ rows }) => (rows[0] ? { id: rows[0].id, full_name: rows[0].full_name, email: rows[0].email, is_active: rows[0].is_active } : null))
    : null;

  const emailContact = normalizedEmail
    ? await db
        .query<{ id: string; full_name: string; email: string | null; is_active: boolean }>(
          `SELECT id, full_name, email, is_active FROM crm_contact WHERE email = $1 AND id != $2`,
          [normalizedEmail, contactId],
        )
        .then(({ rows }) => (rows[0] ? { id: rows[0].id, full_name: rows[0].full_name, email: rows[0].email, is_active: rows[0].is_active } : null))
    : null;

  // Case A: Both resolve to SAME contact (different from current)
  if (phoneContact && emailContact && phoneContact.id === emailContact.id) {
    // This would mean moving lead to another contact - conflict
    throw new IdentityConflictError(phoneContact.id, emailContact.id);
  }

  // Case C: Phone resolves to another contact
  if (phoneContact && !emailContact) {
    throw new IdentityConflictError(phoneContact.id, '');
  }

  // Case D: Email resolves to another contact
  if (!phoneContact && emailContact) {
    throw new IdentityConflictError('', emailContact.id);
  }

  // Case E: Phone and email resolve to DIFFERENT contacts
  if (phoneContact && emailContact && phoneContact.id !== emailContact.id) {
    throw new IdentityConflictError(phoneContact.id, emailContact.id);
  }

  // Case B: New phone/email is unused - safe to update current contact
  // Case A (same contact): both resolve to current contact - safe

  return { contactId };
}

/**
 * Extended lead view for the detail page with joined catalog/user data.
 */
export interface LeadDetail extends Lead {
  sourceCode: string;
  sourceName: string;
  campaignCode: string | null;
  campaignName: string | null;
  productCategoryCode: string | null;
  productCategoryName: string | null;
  ownerName: string;
  ownerEmail: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  accountName: string | null;
}

type LeadDetailRow = LeadRow & {
  source_code: string;
  source_name: string;
  source_id: string;
  campaign_code: string | null;
  campaign_name: string | null;
  campaign_id: string | null;
  product_category_code: string | null;
  product_category_name: string | null;
  product_category_id: string | null;
  owner_name: string;
  owner_email: string;
  owner_id: string;
  contact_full_name: string;
  contact_email: string | null;
  contact_id: string;
  contact_phone: string | null;
  account_name: string | null;
  account_id: string | null;
};

function toLeadDetail(row: LeadDetailRow): LeadDetail {
  return {
    ...toLead(row),
    sourceCode: row.source_code,
    sourceName: row.source_name,
    campaignCode: row.campaign_code,
    campaignName: row.campaign_name,
    productCategoryCode: row.product_category_code,
    productCategoryName: row.product_category_name,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    contactName: row.contact_full_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    accountName: row.account_name,
  };
}

const LEAD_DETAIL_COLUMNS = `
  ${LEAD_COLUMNS},
  s.code AS source_code,
  s.name AS source_name,
  s.id AS source_id,
  sc.code AS campaign_code,
  sc.name AS campaign_name,
  sc.id AS campaign_id,
  pc.code AS product_category_code,
  pc.name AS product_category_name,
  pc.id AS product_category_id,
  u.display_name AS owner_name,
  u.email AS owner_email,
  u.id AS owner_id,
  c.full_name AS contact_full_name,
  c.email AS contact_email,
  c.id AS contact_id,
  cc.value AS contact_phone,
  a.name AS account_name,
  a.id AS account_id
`;

export async function findLeadDetailById(
  db: Db,
  leadId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
): Promise<LeadDetail | null> {
  let whereClause = 'WHERE l.id = $1';
  const params: (string | string[]) = [leadId];

  if (actor.role === 'SALES_REP') {
    whereClause += ' AND l.owner_user_id = $2';
    params.push(actor.userId);
  }

  const { rows } = await db.query<LeadDetailRow>(
    `SELECT ${LEAD_DETAIL_COLUMNS}
       FROM crm_lead l
       JOIN crm_source s ON s.id = l.source_id
       LEFT JOIN crm_source_campaign sc ON sc.id = l.campaign_id
       LEFT JOIN crm_product_category pc ON pc.id = l.product_category_id
       JOIN crm_user u ON u.id = l.owner_user_id
       JOIN crm_contact c ON c.id = l.contact_id
       LEFT JOIN crm_account a ON a.id = l.account_id
       LEFT JOIN crm_contact_channel cc ON cc.contact_id = c.id AND cc.channel_type = 'PHONE' AND cc.is_active = true
     ${whereClause}`,
    params,
  );

  return rows[0] ? toLeadDetail(rows[0]) : null;
}