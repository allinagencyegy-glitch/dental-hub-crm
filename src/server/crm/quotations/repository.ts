/**
 * All SQL touching crm_quotation, crm_quotation_item and crm_quotation_revision.
 *
 * Commercial truth is never mutated silently:
 *   * only a DRAFT may be edited, and every edit snapshots the outgoing state
 *     into crm_quotation_revision first;
 *   * a SENT / ACCEPTED / REJECTED / EXPIRED row is immutable - the only way
 *     past a SENT / REJECTED / EXPIRED one is a revision, which is a NEW row
 *     chained through previous_quote_id (version = parent version + 1, new
 *     quote number); an ACCEPTED one is final;
 *   * an opportunity holds at most one ACCEPTED quotation, and once the
 *     opportunity is WON or LOST its quotations are frozen;
 *   * nothing here ever deletes a quotation.
 *
 * Row scope: SALES_REP sees only quotations whose opportunity they own (a team
 * leader also their team's, see crm/scope.ts). A row
 * outside the actor's scope reads as absent, so an unauthorised lookup cannot
 * be used to discover that a record exists.
 */
import type { Db } from '@/server/db/types';
import {
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
} from '@/server/db/transaction';
import { findOpportunityById, recordOpportunityActivity } from '@/server/crm/opportunities/repository';
import { notify } from '@/server/crm/notifications/repository';
import {
  canTransition,
  isRevisionAllowed,
  isQuotationStatus,
  type QuotationStatus,
} from './status';
import type { Role } from '@/server/authz/permissions';
import { ownerScopeSql } from '@/server/crm/scope';
import { likePattern } from '@/server/db/like';

export type Actor = { userId: string; role: Role };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class QuotationNotFoundError extends Error {
  constructor(id: string) {
    super(`Quotation ${id} not found.`);
    this.name = 'QuotationNotFoundError';
  }
}

export class InvalidQuotationTransitionError extends Error {
  constructor(from: QuotationStatus, to: QuotationStatus) {
    super(`Invalid quotation status transition: ${from} → ${to}.`);
    this.name = 'InvalidQuotationTransitionError';
  }
}

export class QuotationNotDraftError extends Error {
  constructor(status: QuotationStatus) {
    super(`Only a draft quotation can be edited (current status: ${status}).`);
    this.name = 'QuotationNotDraftError';
  }
}

export class QuotationRevisionNotAllowedError extends Error {
  constructor(status: QuotationStatus) {
    super(`A ${status} quotation cannot be revised.`);
    this.name = 'QuotationRevisionNotAllowedError';
  }
}

export class ClosedOpportunityError extends Error {
  constructor() {
    super('This opportunity is closed, so its quotations can no longer be created or changed.');
    this.name = 'ClosedOpportunityError';
  }
}

export class QuotationAlreadyAcceptedError extends Error {
  readonly acceptedQuoteNumber: string;

  constructor(acceptedQuoteNumber: string) {
    super(
      `Quotation ${acceptedQuoteNumber} is already accepted on this opportunity. ` +
        'An opportunity can have only one accepted quotation.',
    );
    this.name = 'QuotationAlreadyAcceptedError';
    this.acceptedQuoteNumber = acceptedQuoteNumber;
  }
}

export class InvalidQuotationItemsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQuotationItemsError';
  }
}

export class InvalidQuotationAmountsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQuotationAmountsError';
  }
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface QuotationItem {
  id: string;
  quotationId: string;
  sequence: number;
  /** The catalogue model this line sells. Null for a free-text line. */
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface QuotationItemInput {
  productId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface QuotationCommercialInput {
  items: QuotationItemInput[];
  discountAmount?: number;
  taxAmount?: number;
  notes?: string | null;
  termsConditions?: string | null;
  validUntil?: Date | null;
}

export interface Quotation {
  id: string;
  opportunityId: string;
  contactId: string;
  accountId: string | null;
  quoteNumber: string;
  version: number;
  status: QuotationStatus;
  currency: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  notes: string | null;
  termsConditions: string | null;
  validUntil: Date | null;
  sentAt: Date | null;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  expiredAt: Date | null;
  previousQuoteId: string | null;
  previousQuoteNumber: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A quotation plus the identity data the UI and the printable document show. */
export interface QuotationDetail extends Quotation {
  items: QuotationItem[];
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contactPhoneIsWhatsApp: boolean;
  accountName: string | null;
  opportunityStage: string;
  ownerName: string;
  createdByName: string;
}

/** The light row the opportunity page lists; items live on the detail query. */
export interface QuotationListItem {
  id: string;
  quoteNumber: string;
  version: number;
  status: QuotationStatus;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  previousQuoteNumber: string | null;
}

/** One row of the quotations page: the quotation with its customer and owner. */
export interface QuotationIndexRow {
  id: string;
  opportunityId: string;
  quoteNumber: string;
  version: number;
  status: QuotationStatus;
  totalAmount: number;
  validUntil: Date | null;
  /** Still open (draft or sent) although its valid-until date has passed. */
  pastValidity: boolean;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  contactName: string;
  accountName: string | null;
  ownerName: string;
}

export type QuotationIndexFilter = 'ALL' | QuotationStatus;

/** How many quotations, and what they are worth, under each status tab. */
export type QuotationIndexCounts = Record<QuotationIndexFilter, { count: number; value: number }>;

export interface QuotationRevisionSnapshot {
  id: string;
  quotationId: string;
  version: number;
  status: QuotationStatus;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  notes: string | null;
  termsConditions: string | null;
  validUntil: Date | null;
  changedBy: string;
  changedByName: string | null;
  changedAt: Date;
  changeReason: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type QuotationRow = {
  id: string;
  opportunity_id: string;
  contact_id: string;
  account_id: string | null;
  quote_number: string;
  version: number;
  status: QuotationStatus;
  currency: string;
  subtotal: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  notes: string | null;
  terms_conditions: string | null;
  valid_until: Date | null;
  sent_at: Date | null;
  accepted_at: Date | null;
  rejected_at: Date | null;
  expired_at: Date | null;
  previous_quote_id: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

const QUOTATION_COLUMNS = `
  id, opportunity_id, contact_id, account_id, quote_number, version, status,
  currency, subtotal, discount_amount, tax_amount, total_amount, notes,
  terms_conditions, valid_until, sent_at, accepted_at, rejected_at, expired_at,
  previous_quote_id, created_by, created_at, updated_at
`;

const QUOTATION_COLUMNS_Q = `
  q.id, q.opportunity_id, q.contact_id, q.account_id, q.quote_number, q.version,
  q.status, q.currency, q.subtotal, q.discount_amount, q.tax_amount,
  q.total_amount, q.notes, q.terms_conditions, q.valid_until, q.sent_at,
  q.accepted_at, q.rejected_at, q.expired_at, q.previous_quote_id, q.created_by,
  q.created_at, q.updated_at
`;

function toQuotation(row: QuotationRow & { previous_quote_number?: string | null }): Quotation {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    contactId: row.contact_id,
    accountId: row.account_id,
    quoteNumber: row.quote_number,
    version: row.version,
    status: row.status,
    currency: row.currency,
    subtotal: Number(row.subtotal),
    discountAmount: Number(row.discount_amount),
    taxAmount: Number(row.tax_amount),
    totalAmount: Number(row.total_amount),
    notes: row.notes,
    termsConditions: row.terms_conditions,
    validUntil: row.valid_until,
    sentAt: row.sent_at,
    acceptedAt: row.accepted_at,
    rejectedAt: row.rejected_at,
    expiredAt: row.expired_at,
    previousQuoteId: row.previous_quote_id,
    previousQuoteNumber: row.previous_quote_number ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type QuotationItemRow = {
  id: string;
  quotation_id: string;
  sequence: number;
  product_id: string | null;
  description: string;
  quantity: string;
  unit_price: string;
  line_total: string;
};

function toQuotationItem(row: QuotationItemRow): QuotationItem {
  return {
    id: row.id,
    quotationId: row.quotation_id,
    sequence: row.sequence,
    productId: row.product_id,
    description: row.description,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    lineTotal: Number(row.line_total),
  };
}

/** numeric(14,2) inputs travel as two-decimal strings so no float rounding sneaks in. */
export function money(value: number): string {
  return Number(value).toFixed(2);
}

/** numeric(10,2) quantities, same reasoning. */
export function quantity(value: number): string {
  return Number(value).toFixed(2);
}

/** Appends the rep / team leader row-scope clause. `o` is the crm_opportunity alias. */
function pushScope(
  clauses: string[],
  params: (string | number | Date | null)[],
  actor: Actor,
): void {
  const scope = ownerScopeSql(actor, params, ['o.owner_user_id']);
  if (scope) clauses.push(scope);
}

/** Generates the next unique, human-readable quotation number. */
async function nextQuoteNumber(db: Db): Promise<string> {
  const { rows } = await db.query<{ nextval: string }>(
    `SELECT nextval('crm_quotation_number_seq')::text AS nextval`,
  );
  return `Q-${String(rows[0].nextval).padStart(5, '0')}`;
}

/**
 * Sum of the items the caller is about to insert, computed by PostgreSQL in
 * exact numeric arithmetic. The value is validated by the service before the
 * write, and again derived from the actually-inserted rows afterwards.
 */
async function sumItemTotals(db: Db, items: QuotationItemInput[]): Promise<number> {
  const { rows } = await db.query<{ subtotal: string }>(
    `SELECT round(sum(quantity * unit_price), 2)::text AS subtotal
       FROM unnest($1::numeric[], $2::numeric[]) AS t(quantity, unit_price)`,
    [items.map((item) => quantity(item.quantity)), items.map((item) => money(item.unitPrice))],
  );
  return Number(rows[0].subtotal);
}

/**
 * Appends an immutable snapshot of a quotation's commercial content. The
 * snapshot version is per-quotation, so the log reads 1, 2, 3... for one row.
 */
async function snapshotQuotation(
  db: Db,
  quotation: Quotation,
  changedBy: string,
  changeReason: string,
): Promise<void> {
  await db.query(
    `INSERT INTO crm_quotation_revision
       (quotation_id, version, status, subtotal, discount_amount, tax_amount,
        total_amount, notes, terms_conditions, valid_until, changed_by, change_reason)
     VALUES (
       $1,
       (SELECT COALESCE(MAX(version), 0) + 1 FROM crm_quotation_revision WHERE quotation_id = $1),
       $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
     )`,
    [
      quotation.id,
      quotation.status,
      money(quotation.subtotal),
      money(quotation.discountAmount),
      money(quotation.taxAmount),
      money(quotation.totalAmount),
      quotation.notes,
      quotation.termsConditions,
      quotation.validUntil,
      changedBy,
      changeReason,
    ],
  );
}

function insertItemRows(
  db: Db,
  quotationId: string,
  items: QuotationItemInput[],
): Promise<unknown> {
  // One statement for all rows; line totals are rounded in SQL so the CHECK
  // (line_total = round(quantity * unit_price, 2)) and the stored value agree.
  return db.query(
    `INSERT INTO crm_quotation_item
       (quotation_id, sequence, product_id, description, quantity, unit_price, line_total)
     SELECT $1::uuid, t.ord::int, t.product_id, t.description, t.quantity::numeric, t.unit_price::numeric,
            round(t.quantity::numeric * t.unit_price::numeric, 2)
       FROM unnest($5::uuid[], $2::text[], $3::numeric[], $4::numeric[])
         WITH ORDINALITY AS t(product_id, description, quantity, unit_price, ord)`,
    [
      quotationId,
      items.map((item) => item.description),
      items.map((item) => quantity(item.quantity)),
      items.map((item) => money(item.unitPrice)),
      items.map((item) => item.productId ?? null),
    ],
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Reads one quotation within the actor's row scope. Null = missing or out of scope. */
export async function findQuotationById(
  db: Db,
  quotationId: string,
  actor: Actor,
): Promise<Quotation | null> {
  const clauses = ['q.id = $1'];
  const params: (string | number | Date | null)[] = [quotationId];
  pushScope(clauses, params, actor);

  const { rows } = await db.query<QuotationRow & { previous_quote_number: string | null }>(
    `SELECT ${QUOTATION_COLUMNS_Q}, prev.quote_number AS previous_quote_number
       FROM crm_quotation q
       JOIN crm_opportunity o ON o.id = q.opportunity_id
       LEFT JOIN crm_quotation prev ON prev.id = q.previous_quote_id
      WHERE ${clauses.join(' AND ')}`,
    params,
  );

  return rows[0] ? toQuotation(rows[0]) : null;
}

async function listItems(db: Db, quotationId: string): Promise<QuotationItem[]> {
  const { rows } = await db.query<QuotationItemRow>(
    `SELECT id, quotation_id, sequence, product_id, description, quantity, unit_price, line_total
       FROM crm_quotation_item
      WHERE quotation_id = $1
      ORDER BY sequence ASC`,
    [quotationId],
  );
  return rows.map(toQuotationItem);
}

/** A quotation plus its items and the identity data the document shows. */
export async function findQuotationDetailById(
  db: Db,
  quotationId: string,
  actor: Actor,
): Promise<QuotationDetail | null> {
  const clauses = ['q.id = $1'];
  const params: (string | number | Date | null)[] = [quotationId];
  pushScope(clauses, params, actor);

  const { rows } = await db.query<
    QuotationRow & {
      previous_quote_number: string | null;
      contact_name: string;
      contact_email: string | null;
      contact_phone: string | null;
      contact_phone_is_whatsapp: boolean;
      account_name: string | null;
      opportunity_stage: string;
      owner_name: string;
      created_by_name: string;
    }
  >(
    `SELECT ${QUOTATION_COLUMNS_Q},
            prev.quote_number AS previous_quote_number,
            c.full_name      AS contact_name,
            c.email          AS contact_email,
            phone.value      AS contact_phone,
            COALESCE(phone.is_whatsapp, false) AS contact_phone_is_whatsapp,
            a.name           AS account_name,
            o.stage          AS opportunity_stage,
            owner.display_name AS owner_name,
            creator.display_name AS created_by_name
       FROM crm_quotation q
       JOIN crm_opportunity o ON o.id = q.opportunity_id
       JOIN crm_contact c     ON c.id = q.contact_id
       JOIN crm_user owner    ON owner.id = o.owner_user_id
       JOIN crm_user creator  ON creator.id = q.created_by
       LEFT JOIN crm_account a ON a.id = q.account_id
       LEFT JOIN crm_quotation prev ON prev.id = q.previous_quote_id
       LEFT JOIN LATERAL (
         SELECT cc.value, cc.is_whatsapp
           FROM crm_contact_channel cc
          WHERE cc.contact_id = c.id AND cc.channel_type = 'PHONE' AND cc.is_active = true
          ORDER BY cc.created_at ASC, cc.id ASC
          LIMIT 1
       ) phone ON true
      WHERE ${clauses.join(' AND ')}`,
    params,
  );

  const row = rows[0];
  if (!row) return null;

  const items = await listItems(db, row.id);
  return {
    ...toQuotation(row),
    items,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    contactPhoneIsWhatsApp: row.contact_phone_is_whatsapp,
    accountName: row.account_name,
    opportunityStage: row.opportunity_stage,
    ownerName: row.owner_name,
    createdByName: row.created_by_name,
  };
}

/**
 * The commercial history of one opportunity, oldest first (a chain is read
 * top-down). Authorised against the opportunity: an actor who cannot see the
 * deal gets an empty list, exactly like the activity feed.
 */
export async function listQuotationsForOpportunity(
  db: Db,
  opportunityId: string,
  actor: Actor,
): Promise<QuotationListItem[]> {
  const opportunity = await findOpportunityById(db, opportunityId, actor);
  if (!opportunity) return [];

  const { rows } = await db.query<
    QuotationRow & { previous_quote_number: string | null }
  >(
    `SELECT ${QUOTATION_COLUMNS_Q}, prev.quote_number AS previous_quote_number
       FROM crm_quotation q
       JOIN crm_opportunity o ON o.id = q.opportunity_id
       LEFT JOIN crm_quotation prev ON prev.id = q.previous_quote_id
      WHERE q.opportunity_id = $1
      ORDER BY q.created_at ASC, q.id ASC`,
    [opportunityId],
  );

  return rows.map((row) => {
    const quotation = toQuotation(row);
    return {
      id: quotation.id,
      quoteNumber: quotation.quoteNumber,
      version: quotation.version,
      status: quotation.status,
      subtotal: quotation.subtotal,
      discountAmount: quotation.discountAmount,
      taxAmount: quotation.taxAmount,
      totalAmount: quotation.totalAmount,
      createdAt: quotation.createdAt,
      updatedAt: quotation.updatedAt,
      sentAt: quotation.sentAt,
      previousQuoteNumber: quotation.previousQuoteNumber,
    };
  });
}

/**
 * The quotations page: every quotation in the actor's scope, newest activity
 * first. A quotation that a revision has replaced is left out - the chain is
 * read on its opportunity - so a deal shows once, at its current offer.
 * The tab counts cover the whole scope (and the search and owner filter), not
 * just the page.
 */
export async function listQuotationIndex(
  db: Db,
  actor: Actor,
  options: {
    status?: QuotationStatus;
    ownerUserId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ quotations: QuotationIndexRow[]; total: number; counts: QuotationIndexCounts }> {
  const { status, ownerUserId, search, limit = 25, offset = 0 } = options;

  const clauses = [
    'NOT EXISTS (SELECT 1 FROM crm_quotation next WHERE next.previous_quote_id = q.id)',
  ];
  const params: (string | number | Date | null)[] = [];
  pushScope(clauses, params, actor);

  if (ownerUserId) {
    params.push(ownerUserId);
    clauses.push(`o.owner_user_id = $${params.length}`);
  }

  if (search !== undefined && search.trim() !== '') {
    params.push(likePattern(search.trim()));
    const placeholder = `$${params.length}`;
    clauses.push(`(
      q.quote_number ILIKE ${placeholder} ESCAPE '\\'
      OR c.full_name ILIKE ${placeholder} ESCAPE '\\'
      OR COALESCE(a.name, '') ILIKE ${placeholder} ESCAPE '\\'
      OR owner.display_name ILIKE ${placeholder} ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM crm_contact_channel ch
         WHERE ch.contact_id = c.id AND ch.value ILIKE ${placeholder} ESCAPE '\\'
      )
    )`);
  }

  const joins = `
       JOIN crm_opportunity o ON o.id = q.opportunity_id
       JOIN crm_contact c     ON c.id = q.contact_id
       JOIN crm_user owner    ON owner.id = o.owner_user_id
       LEFT JOIN crm_account a ON a.id = q.account_id`;

  const { rows: groups } = await db.query<{ status: QuotationStatus; count: string; value: string }>(
    `SELECT q.status, count(*)::text AS count, COALESCE(sum(q.total_amount), 0)::text AS value
       FROM crm_quotation q
       ${joins}
      WHERE ${clauses.join(' AND ')}
      GROUP BY q.status`,
    params,
  );
  const empty = () => ({ count: 0, value: 0 });
  const counts: QuotationIndexCounts = {
    ALL: empty(),
    DRAFT: empty(),
    SENT: empty(),
    ACCEPTED: empty(),
    REJECTED: empty(),
    EXPIRED: empty(),
  };
  for (const group of groups) {
    const count = Number(group.count);
    const value = Number(group.value);
    counts[group.status] = { count, value };
    counts.ALL.count += count;
    counts.ALL.value += value;
  }
  const total = counts[status ?? 'ALL'].count;

  if (status) {
    params.push(status);
    clauses.push(`q.status = $${params.length}::crm_quotation_status`);
  }
  params.push(limit, offset);

  const { rows } = await db.query<{
    id: string;
    opportunity_id: string;
    quote_number: string;
    version: number;
    status: QuotationStatus;
    total_amount: string;
    valid_until: Date | null;
    past_validity: boolean;
    sent_at: Date | null;
    created_at: Date;
    updated_at: Date;
    contact_name: string;
    account_name: string | null;
    owner_name: string;
  }>(
    `SELECT q.id, q.opportunity_id, q.quote_number, q.version, q.status, q.total_amount,
            q.valid_until, q.sent_at, q.created_at, q.updated_at,
            (q.status IN ('DRAFT', 'SENT') AND q.valid_until < now()) AS past_validity,
            c.full_name AS contact_name, a.name AS account_name, owner.display_name AS owner_name
       FROM crm_quotation q
       ${joins}
      WHERE ${clauses.join(' AND ')}
      ORDER BY q.updated_at DESC, q.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return {
    quotations: rows.map((row) => ({
      id: row.id,
      opportunityId: row.opportunity_id,
      quoteNumber: row.quote_number,
      version: row.version,
      status: row.status,
      totalAmount: Number(row.total_amount),
      validUntil: row.valid_until,
      pastValidity: row.past_validity === true,
      sentAt: row.sent_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      contactName: row.contact_name,
      accountName: row.account_name,
      ownerName: row.owner_name,
    })),
    total,
    counts,
  };
}

/** The immutable snapshot log of one quotation, newest first. Empty out of scope. */
export async function listQuotationSnapshots(
  db: Db,
  quotationId: string,
  actor: Actor,
): Promise<QuotationRevisionSnapshot[]> {
  const quotation = await findQuotationById(db, quotationId, actor);
  if (!quotation) return [];

  const { rows } = await db.query<{
    id: string;
    quotation_id: string;
    version: number;
    status: QuotationStatus;
    subtotal: string;
    discount_amount: string;
    tax_amount: string;
    total_amount: string;
    notes: string | null;
    terms_conditions: string | null;
    valid_until: Date | null;
    changed_by: string;
    changed_by_name: string | null;
    changed_at: Date;
    change_reason: string | null;
  }>(
    `SELECT r.id, r.quotation_id, r.version, r.status, r.subtotal,
            r.discount_amount, r.tax_amount, r.total_amount, r.notes,
            r.terms_conditions, r.valid_until, r.changed_by,
            u.display_name AS changed_by_name, r.changed_at, r.change_reason
       FROM crm_quotation_revision r
       LEFT JOIN crm_user u ON u.id = r.changed_by
      WHERE r.quotation_id = $1
      ORDER BY r.version DESC`,
    [quotationId],
  );

  return rows.map((row) => ({
    id: row.id,
    quotationId: row.quotation_id,
    version: row.version,
    status: row.status,
    subtotal: Number(row.subtotal),
    discountAmount: Number(row.discount_amount),
    taxAmount: Number(row.tax_amount),
    totalAmount: Number(row.total_amount),
    notes: row.notes,
    termsConditions: row.terms_conditions,
    validUntil: row.valid_until,
    changedBy: row.changed_by,
    changedByName: row.changed_by_name,
    changedAt: row.changed_at,
    changeReason: row.change_reason,
  }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Creates a new DRAFT quotation for an open opportunity.
 *
 * The number comes from the sequence inside the same transaction as the row,
 * so two concurrent creations can never observe the same number; the UNIQUE
 * constraint is the final arbiter. Items, the quotation row, the opening
 * revision snapshot and the activity event land together.
 */
export async function createQuotation(
  db: Db,
  actor: Actor,
  input: {
    opportunityId: string;
    items: QuotationItemInput[];
    discountAmount?: number;
    taxAmount?: number;
    notes?: string | null;
    termsConditions?: string | null;
    validUntil?: Date | null;
  },
): Promise<QuotationDetail> {
  if (input.items.length === 0) {
    throw new InvalidQuotationItemsError('At least one line item is required.');
  }

  const transaction = await beginTransaction(db);
  const client = transaction.client;
  try {
    const opportunity = await findOpportunityById(client, input.opportunityId, actor);
    if (!opportunity) throw new QuotationNotFoundError(input.opportunityId);
    if (opportunity.stage === 'WON' || opportunity.stage === 'LOST') {
      throw new ClosedOpportunityError();
    }

    const quoteNumber = await nextQuoteNumber(client);
    const discount = input.discountAmount ?? 0;
    const tax = input.taxAmount ?? 0;
    const subtotal = await sumItemTotals(client, input.items);
    if (discount > subtotal) {
      throw new InvalidQuotationAmountsError('Discount cannot exceed the subtotal.');
    }

    const { rows } = await client.query<QuotationRow>(
      `INSERT INTO crm_quotation
         (opportunity_id, contact_id, account_id, quote_number, version, status, currency,
          subtotal, discount_amount, tax_amount, total_amount, notes, terms_conditions,
          valid_until, created_by, previous_quote_id)
       VALUES ($1, $2, $3, $4, 1, 'DRAFT', 'EGP', $5, $6, $7, $8, $9, $10, $11, $12, NULL)
       RETURNING ${QUOTATION_COLUMNS}`,
      [
        opportunity.id,
        opportunity.contactId,
        opportunity.accountId,
        quoteNumber,
        money(subtotal),
        money(discount),
        money(tax),
        money(subtotal - discount + tax),
        input.notes?.trim() || null,
        input.termsConditions?.trim() || null,
        input.validUntil ?? null,
        actor.userId,
      ],
    );
    const quotation = toQuotation(rows[0]);

    await insertItemRows(client, quotation.id, input.items);

    await snapshotQuotation(client, quotation, actor.userId, 'Quotation created');

    await recordOpportunityActivity(client, {
      opportunityId: opportunity.id,
      activityType: 'QUOTATION_CREATED',
      description: `Quotation ${quoteNumber} created`,
      metadata: { quotationId: quotation.id, quoteNumber, totalAmount: quotation.totalAmount },
      actorUserId: actor.userId,
    });

    await commitTransaction(client);
    const detail = await findQuotationDetailById(db, quotation.id, actor);
    return detail!;
  } catch (error) {
    await rollbackTransaction(client);
    throw error;
  } finally {
    transaction.release();
  }
}

/**
 * Edits a DRAFT in place. Every snapshot in the log is a full state the
 * document was in, so consecutive snapshots show exactly what each edit
 * changed and the pre-edit content is never lost.
 */
export async function updateDraftQuotation(
  db: Db,
  quotationId: string,
  actor: Actor,
  input: QuotationCommercialInput & { changeReason?: string | null },
): Promise<QuotationDetail> {
  if (input.items.length === 0) {
    throw new InvalidQuotationItemsError('At least one line item is required.');
  }

  const transaction = await beginTransaction(db);
  const client = transaction.client;
  try {
    const current = await lockQuotationRow(client, quotationId, actor);
    await lockOpenOpportunity(client, current.opportunityId);
    if (current.status !== 'DRAFT') throw new QuotationNotDraftError(current.status);

    const discount = input.discountAmount ?? 0;
    const tax = input.taxAmount ?? 0;
    const subtotal = await sumItemTotals(client, input.items);
    if (discount > subtotal) {
      throw new InvalidQuotationAmountsError('Discount cannot exceed the subtotal.');
    }

    await client.query(`DELETE FROM crm_quotation_item WHERE quotation_id = $1`, [quotationId]);
    await insertItemRows(client, quotationId, input.items);

    const { rows } = await client.query<QuotationRow>(
      `UPDATE crm_quotation
          SET subtotal = $2, discount_amount = $3, tax_amount = $4,
              total_amount = $2::numeric - $3::numeric + $4::numeric,
              notes = $5, terms_conditions = $6, valid_until = $7, updated_at = now()
        WHERE id = $1
        RETURNING ${QUOTATION_COLUMNS}`,
      [
        quotationId,
        money(subtotal),
        money(discount),
        money(tax),
        input.notes?.trim() || null,
        input.termsConditions?.trim() || null,
        input.validUntil ?? null,
      ],
    );
    const updated = toQuotation(rows[0]);

    await snapshotQuotation(
      client,
      updated,
      actor.userId,
      input.changeReason?.trim() || 'Draft updated',
    );

    await commitTransaction(client);
    const detail = await findQuotationDetailById(db, quotationId, actor);
    return detail!;
  } catch (error) {
    await rollbackTransaction(client);
    throw error;
  } finally {
    transaction.release();
  }
}

/**
 * Moves a quotation along the legal status graph, stamping exactly the
 * timestamp its new status requires. The status write, the snapshot and the
 * activity event land in one transaction under a row lock, so two concurrent
 * decisions cannot both win - the second re-reads the row and fails the
 * transition check.
 */
export async function transitionQuotation(
  db: Db,
  quotationId: string,
  actor: Actor,
  to: QuotationStatus,
): Promise<QuotationDetail> {
  if (!isQuotationStatus(to)) throw new InvalidQuotationTransitionError('DRAFT', to);

  const transaction = await beginTransaction(db);
  const client = transaction.client;
  try {
    const current = await lockQuotationRow(client, quotationId, actor);
    await lockOpenOpportunity(client, current.opportunityId);
    if (!canTransition(current.status, to)) {
      throw new InvalidQuotationTransitionError(current.status, to);
    }
    // A DRAFT is never a legal target, so every remaining branch has an event.
    if (to === 'DRAFT') throw new InvalidQuotationTransitionError(current.status, to);

    // One accepted quotation per opportunity. The opportunity row is locked
    // above, so two acceptances on the same deal run one after the other and
    // the second one sees the first; the partial unique index from migration
    // 0011 is the database's own backstop.
    if (to === 'ACCEPTED') {
      const { rows: accepted } = await client.query<{ quote_number: string }>(
        `SELECT quote_number
           FROM crm_quotation
          WHERE opportunity_id = $1
            AND status = 'ACCEPTED'
            AND id <> $2
          LIMIT 1`,
        [current.opportunityId, current.id],
      );
      if (accepted[0]) throw new QuotationAlreadyAcceptedError(accepted[0].quote_number);
    }

    const { rows } = await client.query<QuotationRow>(
      `UPDATE crm_quotation
          SET status = $2,
              sent_at = CASE WHEN $2 = 'SENT'::crm_quotation_status THEN now() ELSE sent_at END,
              accepted_at = CASE WHEN $2 = 'ACCEPTED'::crm_quotation_status THEN now() ELSE accepted_at END,
              rejected_at = CASE WHEN $2 = 'REJECTED'::crm_quotation_status THEN now() ELSE rejected_at END,
              expired_at = CASE WHEN $2 = 'EXPIRED'::crm_quotation_status THEN now() ELSE expired_at END,
              updated_at = now()
        WHERE id = $1
        RETURNING ${QUOTATION_COLUMNS}`,
      [quotationId, to],
    );
    const updated = toQuotation(rows[0]);

    await snapshotQuotation(client, updated, actor.userId, `Status moved to ${to}`);

    const activityType = {
      SENT: 'QUOTATION_SENT',
      ACCEPTED: 'QUOTATION_ACCEPTED',
      REJECTED: 'QUOTATION_REJECTED',
      EXPIRED: 'QUOTATION_EXPIRED',
    }[to] as 'QUOTATION_SENT' | 'QUOTATION_ACCEPTED' | 'QUOTATION_REJECTED' | 'QUOTATION_EXPIRED';

    await recordOpportunityActivity(client, {
      opportunityId: updated.opportunityId,
      activityType,
      description: `Quotation ${updated.quoteNumber} ${to.toLowerCase()}`,
      metadata: {
        quotationId: updated.id,
        quoteNumber: updated.quoteNumber,
        fromStatus: current.status,
        toStatus: to,
        totalAmount: updated.totalAmount,
      },
      actorUserId: actor.userId,
    });

    // The customer's answer goes to whoever owns the deal.
    if (to === 'ACCEPTED' || to === 'REJECTED') {
      const { rows: owners } = await client.query<{ owner_user_id: string }>(
        `SELECT owner_user_id FROM crm_opportunity WHERE id = $1`,
        [updated.opportunityId],
      );
      await notify(client, {
        recipientUserId: owners[0].owner_user_id,
        kind: to === 'ACCEPTED' ? 'QUOTATION_ACCEPTED' : 'QUOTATION_REJECTED',
        actorUserId: actor.userId,
        quotationId: updated.id,
      });
    }

    await commitTransaction(client);
    const detail = await findQuotationDetailById(db, quotationId, actor);
    return detail!;
  } catch (error) {
    await rollbackTransaction(client);
    throw error;
  } finally {
    transaction.release();
  }
}

/**
 * Supersedes a sent, rejected or expired quotation with a new DRAFT: version
 * + 1, a new quote number, chained through previous_quote_id. The original row
 * is untouched - the sent/rejected commercial truth stays exactly as it was.
 * An ACCEPTED quotation is final and cannot be revised (see isRevisionAllowed).
 */
export async function createRevision(
  db: Db,
  quotationId: string,
  actor: Actor,
): Promise<QuotationDetail> {
  const transaction = await beginTransaction(db);
  const client = transaction.client;
  try {
    const parent = await lockQuotationRow(client, quotationId, actor);
    await lockOpenOpportunity(client, parent.opportunityId);
    if (!isRevisionAllowed(parent.status)) {
      throw new QuotationRevisionNotAllowedError(parent.status);
    }

    const quoteNumber = await nextQuoteNumber(client);
    const version = parent.version + 1;

    const { rows } = await client.query<QuotationRow>(
      `INSERT INTO crm_quotation
         (opportunity_id, contact_id, account_id, quote_number, version, status, currency,
          subtotal, discount_amount, tax_amount, total_amount, notes, terms_conditions,
          valid_until, created_by, previous_quote_id)
       VALUES ($1, $2, $3, $4, $5, 'DRAFT', 'EGP', $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING ${QUOTATION_COLUMNS}`,
      [
        parent.opportunityId,
        parent.contactId,
        parent.accountId,
        quoteNumber,
        version,
        money(parent.subtotal),
        money(parent.discountAmount),
        money(parent.taxAmount),
        money(parent.totalAmount),
        parent.notes,
        parent.termsConditions,
        parent.validUntil,
        actor.userId,
        parent.id,
      ],
    );
    const revision = toQuotation(rows[0]);

    await client.query(
      `INSERT INTO crm_quotation_item
         (quotation_id, sequence, product_id, description, quantity, unit_price, line_total)
       SELECT $1, sequence, product_id, description, quantity, unit_price, line_total
         FROM crm_quotation_item
        WHERE quotation_id = $2`,
      [revision.id, parent.id],
    );

    await snapshotQuotation(
      client,
      revision,
      actor.userId,
      `Revision of ${parent.quoteNumber}`,
    );

    await recordOpportunityActivity(client, {
      opportunityId: parent.opportunityId,
      activityType: 'QUOTATION_REVISED',
      description: `Quotation ${parent.quoteNumber} revised as ${quoteNumber}`,
      metadata: {
        quotationId: revision.id,
        quoteNumber,
        previousQuotationId: parent.id,
        previousQuoteNumber: parent.quoteNumber,
        version,
      },
      actorUserId: actor.userId,
    });

    await commitTransaction(client);
    const detail = await findQuotationDetailById(db, revision.id, actor);
    return detail!;
  } catch (error) {
    await rollbackTransaction(client);
    throw error;
  } finally {
    transaction.release();
  }
}

/**
 * The row under an UPDATE lock, within the actor's scope. Used by every write:
 * an out-of-scope id raises the same not-found error as a missing one.
 */
async function lockQuotationRow(db: Db, quotationId: string, actor: Actor): Promise<Quotation> {
  const clauses = ['q.id = $1'];
  const params: (string | number | Date | null)[] = [quotationId];
  pushScope(clauses, params, actor);

  const { rows } = await db.query<QuotationRow & { previous_quote_number: string | null }>(
    `SELECT ${QUOTATION_COLUMNS_Q}, prev.quote_number AS previous_quote_number
       FROM crm_quotation q
       JOIN crm_opportunity o ON o.id = q.opportunity_id
       LEFT JOIN crm_quotation prev ON prev.id = q.previous_quote_id
      WHERE ${clauses.join(' AND ')}
      FOR UPDATE OF q`,
    params,
  );

  if (!rows[0]) throw new QuotationNotFoundError(quotationId);
  return toQuotation(rows[0]);
}

/**
 * Locks the parent opportunity for the rest of the transaction and refuses a
 * closed one. Every quotation write after creation goes through here, so a
 * WON or LOST deal's quotations are frozen exactly like its stage is.
 *
 * Lock order is always quotation row first (lockQuotationRow), then the
 * opportunity, so two quotation writes cannot deadlock on each other.
 */
async function lockOpenOpportunity(db: Db, opportunityId: string): Promise<void> {
  const { rows } = await db.query<{ stage: string }>(
    `SELECT stage FROM crm_opportunity WHERE id = $1 FOR UPDATE`,
    [opportunityId],
  );
  const stage = rows[0]?.stage;
  if (stage === 'WON' || stage === 'LOST') throw new ClosedOpportunityError();
}
