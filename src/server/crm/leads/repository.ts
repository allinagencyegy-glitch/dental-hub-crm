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
import { normaliseEmail } from '@/server/users/repository';
import { normalisePhoneToE164 } from '@/server/crm/contacts/phone';
import { createContact, findContactByPhone, DuplicatePhoneError, DuplicateContactEmailError } from '@/server/crm/contacts/repository';
import { listAccountsForContact } from '@/server/crm/accounts/repository';

export type LeadStatus = 'NEW' | 'CONTACTED' | 'DISQUALIFIED';

export interface Lead {
  id: string;
  sourceId: string;
  sourceName: string; // Added for list view
  campaignId: string | null;
  contactId: string;
  accountId: string | null;
  productCategoryId: string | null;
  status: LeadStatus;
  note: string | null;
  ownerUserId: string;
  receivedAt: Date;
  disqualifiedAt: Date | null;
  disqualifyReasonId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type LeadRow = {
  id: string;
  source_id: string;
  source_name: string; // Added for list view
  campaign_id: string | null;
  contact_id: string;
  account_id: string | null;
  product_category_id: string | null;
  status: LeadStatus;
  note: string | null;
  owner_user_id: string;
  received_at: Date;
  disqualified_at: Date | null;
  disqualify_reason_id: string | null;
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
    accountId: row.account_id,
    productCategoryId: row.product_category_id,
    status: row.status,
    note: row.note,
    ownerUserId: row.owner_user_id,
    receivedAt: row.received_at,
    disqualifiedAt: row.disqualified_at,
    disqualifyReasonId: row.disqualify_reason_id,
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
  created_at,
  updated_at
`;

const LEAD_LIST_COLUMNS = `
  ${LEAD_COLUMNS},
  s.name AS source_name
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
 * Lists leads with row-scope authorization and pagination.
 * SALES_REP sees only own leads.
 * SALES_MANAGER/ADMIN see all leads.
 */
export async function listLeads(
  db: Db,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
  options: { status?: LeadStatus; limit?: number; offset?: number } = {},
): Promise<{ leads: Lead[]; total: number }> {
  const { status, limit = 50, offset = 0 } = options;

  let whereClause = '';
  const params: (string | number)[] = [];

  if (actor.role === 'SALES_REP') {
    whereClause = 'WHERE l.owner_user_id = $1';
    params.push(actor.userId);
  }

  if (status) {
    if (whereClause) {
      whereClause += ` AND l.status = $${params.length + 1}`;
    } else {
      whereClause = `WHERE l.status = $${params.length + 1}`;
    }
    params.push(status);
  }

  const countParams = [...params];
  const countWhereClause = whereClause ? whereClause.replace(/l\./g, '') : whereClause;
  const { rows: countRows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM crm_lead ${countWhereClause}`,
    countParams,
  );
  const total = Number(countRows[0].count);

  params.push(limit, offset);
  const { rows } = await db.query<LeadRow>(
    `SELECT ${LEAD_LIST_COLUMNS}
       FROM crm_lead l
       JOIN crm_source s ON s.id = l.source_id
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