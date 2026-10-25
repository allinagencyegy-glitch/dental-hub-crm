/**
 * The quotation status vocabulary and its legal transitions.
 *
 * A quotation moves DRAFT -> SENT -> (ACCEPTED | REJECTED | EXPIRED). A DRAFT
 * may also expire outright (its validity window passed before it was sent).
 * ACCEPTED, REJECTED and EXPIRED are terminal for that row: the only way past
 * them is a revision, which is a NEW quotation row chained through
 * previous_quote_id. Editing is only ever allowed on a DRAFT, so a sent or
 * decided document is never mutated in place.
 */

export const QUOTATION_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export function isQuotationStatus(value: unknown): value is QuotationStatus {
  return typeof value === 'string' && (QUOTATION_STATUSES as readonly string[]).includes(value);
}

export const QUOTATION_TRANSITIONS: Record<QuotationStatus, readonly QuotationStatus[]> = {
  DRAFT: ['SENT', 'EXPIRED'],
  SENT: ['ACCEPTED', 'REJECTED', 'EXPIRED'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
};

export function canTransition(from: QuotationStatus, to: QuotationStatus): boolean {
  return (QUOTATION_TRANSITIONS[from] as readonly string[]).includes(to);
}

/**
 * A revision may start from a sent, rejected or expired quotation: each can be
 * superseded by a new draft. A draft is simply edited in place instead.
 *
 * An ACCEPTED quotation is final. An opportunity holds at most one accepted
 * quotation (migration 0011), so a revision of it could never be accepted;
 * offering one would only produce a dead document.
 */
export function isRevisionAllowed(status: QuotationStatus): boolean {
  return status !== 'DRAFT' && status !== 'ACCEPTED';
}
