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
import { findProductsByIds } from '@/server/crm/catalog/repository';
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

export type FailureCode =
  | 'VALIDATION'
  | 'UNAUTHORISED'
  | 'NOT_FOUND'
  | 'CLOSED_OPPORTUNITY'
  | 'INVALID_TRANSITION'
  | 'NOT_DRAFT'
  | 'ALREADY_ACCEPTED'
  | 'INTERNAL';

/** Which rule a VALIDATION failure broke, so the reader can be told which one. */
export type QuotationProblem =
  | 'ITEMS_REQUIRED'
  | 'TOO_MANY_ITEMS'
  | 'DESCRIPTION_REQUIRED'
  | 'DESCRIPTION_TOO_LONG'
  | 'QUANTITY_NOT_POSITIVE'
  | 'UNIT_PRICE_NEGATIVE'
  | 'DISCOUNT_NEGATIVE'
  | 'TAX_NEGATIVE'
  | 'VALID_UNTIL_UNREADABLE'
  | 'DISCOUNT_EXCEEDS_SUBTOTAL'
  | 'UNKNOWN_PRODUCT'
  | 'UNKNOWN_STATUS';

type Failure = {
  ok: false;
  error: FailureCode;
  message: string;
  problem?: QuotationProblem;
  /** On ALREADY_ACCEPTED: the quotation that holds the acceptance. */
  acceptedQuoteNumber?: string;
};

function invalid(problem: QuotationProblem, message: string): Failure {
  return { ok: false, error: 'VALIDATION', message, problem };
}

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
    return invalid('ITEMS_REQUIRED', 'At least one line item is required.');
  }
  if (input.items.length > 200) {
    return invalid('TOO_MANY_ITEMS', 'A quotation can hold at most 200 line items.');
  }

  for (const item of input.items) {
    if (!item || typeof item.description !== 'string' || item.description.trim() === '') {
      return invalid('DESCRIPTION_REQUIRED', 'Every line item needs a description.');
    }
    if (item.description.trim().length > MAX_ITEM_DESCRIPTION_LENGTH) {
      return invalid('DESCRIPTION_TOO_LONG', 'A line item description is too long.');
    }
    if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) {
      return invalid('QUANTITY_NOT_POSITIVE', 'Every line item needs a quantity greater than zero.');
    }
    if (typeof item.unitPrice !== 'number' || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      return invalid('UNIT_PRICE_NEGATIVE', 'Unit prices cannot be negative.');
    }
  }

  if (input.discountAmount !== undefined && input.discountAmount !== null) {
    if (typeof input.discountAmount !== 'number' || !Number.isFinite(input.discountAmount) || input.discountAmount < 0) {
      return invalid('DISCOUNT_NEGATIVE', 'Discount cannot be negative.');
    }
  }
  if (input.taxAmount !== undefined && input.taxAmount !== null) {
    if (typeof input.taxAmount !== 'number' || !Number.isFinite(input.taxAmount) || input.taxAmount < 0) {
      return invalid('TAX_NEGATIVE', 'Tax cannot be negative.');
    }
  }

  if (input.validUntil !== undefined && input.validUntil !== null) {
    const parsed = new Date(input.validUntil);
    if (Number.isNaN(parsed.getTime())) {
      return invalid('VALID_UNTIL_UNREADABLE', 'The valid-until date could not be read.');
    }
  }

  return null;
}

/**
 * Every catalogue model a line names must exist. A retired model is fine: a
 * draft written before it was retired still saves. The picker only offers
 * active ones.
 */
async function checkProducts(db: Db, items: QuotationItemInput[]): Promise<Failure | null> {
  const ids = [...new Set(items.map((item) => item.productId).filter((id): id is string => !!id))];
  const found = await findProductsByIds(db, ids);
  if (found.length !== ids.length) {
    return invalid('UNKNOWN_PRODUCT', 'A line item names a product that is not in the catalogue.');
  }
  return null;
}

function toItemInputs(items: QuotationItemInput[]): QuotationItemInput[] {
  return items.map((item) => ({
    productId: item.productId ?? null,
    description: item.description.trim(),
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  }));
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
    return {
      ok: false,
      error: 'ALREADY_ACCEPTED',
      message: error.message,
      acceptedQuoteNumber: error.acceptedQuoteNumber,
    };
  }
  // The repository re-checks two rules inside the transaction.
  if (error instanceof InvalidQuotationItemsError) return invalid('ITEMS_REQUIRED', error.message);
  if (error instanceof InvalidQuotationAmountsError) return invalid('DISCOUNT_EXCEEDS_SUBTOTAL', error.message);
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

  const invalid = validateCommercialInput(input) ?? (await checkProducts(database, input.items));
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
      items: toItemInputs(input.items),
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

  const invalid = validateCommercialInput(input) ?? (await checkProducts(database, input.items));
  if (invalid) return invalid;

  try {
    const quotation = await updateDraftQuotation(database, quotationId, actor, {
      items: toItemInputs(input.items),
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
    return invalid('UNKNOWN_STATUS', 'Unknown quotation status.');
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
