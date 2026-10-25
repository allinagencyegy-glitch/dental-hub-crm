/**
 * Quotation use cases.
 *
 * The service layer owns the rules that need more than one query: item shape,
 * amount sanity, and which repository errors become which user-facing
 * outcomes. Row scope stays in the repository - these functions shape the
 * answer, they do not decide who may ask.
 */
import { db as defaultDb } from '@/server/db/client';
import type { Db } from '@/server/db/types';
import { findOpportunityById } from '@/server/crm/opportunities/repository';
import {
  createQuotation,
  createRevision,
  findQuotationById,
  findQuotationDetailById,
  listQuotationSnapshots,
  listQuotationsForOpportunity,
  transitionQuotation,
  updateDraftQuotation,
  ClosedOpportunityError,
  InvalidQuotationAmountsError,
  InvalidQuotationItemsError,
  InvalidQuotationTransitionError,
  QuotationAlreadyAcceptedError,
  QuotationNotDraftError,
  QuotationNotFoundError,
  QuotationRevisionNotAllowedError,
  type Actor,
  type QuotationDetail,
  type QuotationItemInput,
  type QuotationListItem,
  type QuotationRevisionSnapshot,
} from './repository';
import { isQuotationStatus, type QuotationStatus } from './status';

export type { Actor } from './repository';

function getDb(db?: Db): Db {
  return db ?? defaultDb();
}

type FailureCode =
  | 'VALIDATION'
  | 'UNAUTHORISED'
  | 'NOT_FOUND'
  | 'CLOSED_OPPORTUNITY'
  | 'INVALID_TRANSITION'
  | 'NOT_DRAFT'
  | 'ALREADY_ACCEPTED'
  | 'INTERNAL';

type Failure = { ok: false; error: FailureCode; message: string };

export type QuotationCommercialInput = {
  items: QuotationItemInput[];
  discountAmount?: number | null;
  taxAmount?: number | null;
  notes?: string | null;
  termsConditions?: string | null;
  validUntil?: string | null;
};

const MAX_ITEM_DESCRIPTION_LENGTH = 2000;

/**
 * The shape every quotation write must satisfy before it reaches SQL. Returns
 * a failure message for the first rule that fails, or null when the input is
 * acceptable.
 */
function validateCommercialInput(input: QuotationCommercialInput): Failure | null {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, error: 'VALIDATION', message: 'At least one line item is required.' };
  }
  if (input.items.length > 200) {
    return { ok: false, error: 'VALIDATION', message: 'A quotation can hold at most 200 line items.' };
  }

  for (const item of input.items) {
    if (!item || typeof item.description !== 'string' || item.description.trim() === '') {
      return { ok: false, error: 'VALIDATION', message: 'Every line item needs a description.' };
    }
    if (item.description.trim().length > MAX_ITEM_DESCRIPTION_LENGTH) {
      return { ok: false, error: 'VALIDATION', message: 'A line item description is too long.' };
    }
    if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) {
      return { ok: false, error: 'VALIDATION', message: 'Every line item needs a quantity greater than zero.' };
    }
    if (typeof item.unitPrice !== 'number' || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      return { ok: false, error: 'VALIDATION', message: 'Unit prices cannot be negative.' };
    }
  }

  if (input.discountAmount !== undefined && input.discountAmount !== null) {
    if (typeof input.discountAmount !== 'number' || !Number.isFinite(input.discountAmount) || input.discountAmount < 0) {
      return { ok: false, error: 'VALIDATION', message: 'Discount cannot be negative.' };
    }
  }
  if (input.taxAmount !== undefined && input.taxAmount !== null) {
    if (typeof input.taxAmount !== 'number' || !Number.isFinite(input.taxAmount) || input.taxAmount < 0) {
      return { ok: false, error: 'VALIDATION', message: 'Tax cannot be negative.' };
    }
  }

  if (input.validUntil !== undefined && input.validUntil !== null) {
    const parsed = new Date(input.validUntil);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: 'VALIDATION', message: 'The valid-until date could not be read.' };
    }
  }

  return null;
}

function mapWriteFailure(error: unknown): Failure {
  if (error instanceof QuotationNotFoundError) {
    return { ok: false, error: 'NOT_FOUND', message: 'Quotation not found.' };
  }
  if (error instanceof ClosedOpportunityError) {
    return { ok: false, error: 'CLOSED_OPPORTUNITY', message: error.message };
  }
  if (error instanceof InvalidQuotationTransitionError || error instanceof QuotationRevisionNotAllowedError) {
    return { ok: false, error: 'INVALID_TRANSITION', message: error.message };
  }
  if (error instanceof QuotationNotDraftError) {
    return { ok: false, error: 'NOT_DRAFT', message: error.message };
  }
  if (error instanceof QuotationAlreadyAcceptedError) {
    return { ok: false, error: 'ALREADY_ACCEPTED', message: error.message };
  }
  if (error instanceof InvalidQuotationItemsError || error instanceof InvalidQuotationAmountsError) {
    return { ok: false, error: 'VALIDATION', message: error.message };
  }
  if (error instanceof Error && error.message === 'UNAUTHORISED') {
    return { ok: false, error: 'UNAUTHORISED', message: 'You cannot perform this action.' };
  }
  throw error;
}

export type QuotationResult = { ok: true; quotation: QuotationDetail } | Failure;

/** Creates a DRAFT quotation on an open opportunity the actor may see. */
export async function createQuotationUseCase(
  actor: Actor,
  opportunityId: string,
  input: QuotationCommercialInput,
  db?: Db,
): Promise<QuotationResult> {
  const database = getDb(db);

  const invalid = validateCommercialInput(input);
  if (invalid) return invalid;

  // Checked here for an accurate message; the repository re-checks inside the
  // transaction. A missing opportunity and an out-of-scope one are the same
  // answer, so no existence leak.
  const opportunity = await findOpportunityById(database, opportunityId, actor);
  if (!opportunity) {
    return { ok: false, error: 'NOT_FOUND', message: 'Opportunity not found.' };
  }

  try {
    const quotation = await createQuotation(database, actor, {
      opportunityId,
      items: input.items.map((item) => ({
        description: item.description.trim(),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      discountAmount: input.discountAmount ?? 0,
      taxAmount: input.taxAmount ?? 0,
      notes: input.notes ?? null,
      termsConditions: input.termsConditions ?? null,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
    });
    return { ok: true, quotation };
  } catch (error) {
    return mapWriteFailure(error);
  }
}

/** One quotation with its items, or null when missing / out of the actor's scope. */
export async function getQuotationUseCase(
  actor: Actor,
  quotationId: string,
  db?: Db,
): Promise<QuotationDetail | null> {
  const database = getDb(db);
  return findQuotationDetailById(database, quotationId, actor);
}

/** The commercial history of one opportunity, oldest first. Empty out of scope. */
export async function listQuotationsUseCase(
  actor: Actor,
  opportunityId: string,
  db?: Db,
): Promise<QuotationListItem[]> {
  const database = getDb(db);
  return listQuotationsForOpportunity(database, opportunityId, actor);
}

/** Edits a DRAFT quotation's items and commercial fields. */
export async function updateDraftQuotationUseCase(
  actor: Actor,
  quotationId: string,
  input: QuotationCommercialInput & { changeReason?: string | null },
  db?: Db,
): Promise<QuotationResult> {
  const database = getDb(db);

  const invalid = validateCommercialInput(input);
  if (invalid) return invalid;

  try {
    const quotation = await updateDraftQuotation(database, quotationId, actor, {
      items: input.items.map((item) => ({
        description: item.description.trim(),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      discountAmount: input.discountAmount ?? 0,
      taxAmount: input.taxAmount ?? 0,
      notes: input.notes ?? null,
      termsConditions: input.termsConditions ?? null,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      changeReason: input.changeReason ?? null,
    });
    return { ok: true, quotation };
  } catch (error) {
    return mapWriteFailure(error);
  }
}

/** Sends a DRAFT, or records the customer's decision on a SENT quotation. */
export async function transitionQuotationUseCase(
  actor: Actor,
  quotationId: string,
  to: QuotationStatus,
  db?: Db,
): Promise<QuotationResult> {
  const database = getDb(db);

  if (!isQuotationStatus(to)) {
    return { ok: false, error: 'VALIDATION', message: 'Unknown quotation status.' };
  }

  try {
    const quotation = await transitionQuotation(database, quotationId, actor, to);
    return { ok: true, quotation };
  } catch (error) {
    return mapWriteFailure(error);
  }
}

/** Supersedes a committed quotation with a new DRAFT revision. */
export async function reviseQuotationUseCase(
  actor: Actor,
  quotationId: string,
  db?: Db,
): Promise<QuotationResult> {
  const database = getDb(db);
  try {
    const quotation = await createRevision(database, quotationId, actor);
    return { ok: true, quotation };
  } catch (error) {
    return mapWriteFailure(error);
  }
}

/** The immutable snapshot log of one quotation, newest first. Empty out of scope. */
export async function listQuotationSnapshotsUseCase(
  actor: Actor,
  quotationId: string,
  db?: Db,
): Promise<QuotationRevisionSnapshot[]> {
  const database = getDb(db);
  return listQuotationSnapshots(database, quotationId, actor);
}

/** True when the actor may read this quotation at all - a scope probe for pages. */
export async function canAccessQuotationUseCase(
  actor: Actor,
  quotationId: string,
  db?: Db,
): Promise<boolean> {
  const database = getDb(db);
  const quotation = await findQuotationById(database, quotationId, actor);
  return quotation !== null;
}
