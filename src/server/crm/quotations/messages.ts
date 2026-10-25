/**
 * The reader's-language text for failed quotation writes.
 *
 * The domain layer keeps its English messages for logs and tests. The actions
 * replace them, at the edge, with text chosen from the failure's code, and for
 * a VALIDATION failure from the rule it broke. NOT_FOUND means the opportunity
 * when a quotation is being created, and the quotation for every other write.
 */
import type { Messages } from '@/i18n/messages';
import type { FailureCode, QuotationProblem } from './service';

export type QuotationWrite = 'create' | 'change';

export interface QuotationFailureFacts {
  error: FailureCode;
  problem?: QuotationProblem;
  acceptedQuoteNumber?: string;
}

/** What the reader sees when a quotation write fails. */
export function failureMessage(write: QuotationWrite, failure: QuotationFailureFacts, m: Messages): string {
  const errors = m.quotations.errors;
  switch (failure.error) {
    case 'VALIDATION':
      return failure.problem ? m.quotations.problems[failure.problem] : errors.unreadable;
    case 'UNAUTHORISED':
      return errors.notAuthorised;
    case 'NOT_FOUND':
      return write === 'create' ? errors.opportunityNotFound : errors.notFound;
    case 'CLOSED_OPPORTUNITY':
      return errors.closedOpportunity;
    case 'INVALID_TRANSITION':
      return errors.invalidTransition;
    case 'NOT_DRAFT':
      return errors.notDraft;
    case 'ALREADY_ACCEPTED':
      return errors.alreadyAccepted(failure.acceptedQuoteNumber ?? null);
    case 'INTERNAL':
      return m.common.unexpectedError;
  }
}

/** The result with a failure's message in the reader's language. */
export function localise<R extends { ok: true } | ({ ok: false; message: string } & QuotationFailureFacts)>(
  write: QuotationWrite,
  result: R,
  m: Messages,
): R {
  if (result.ok) return result;
  return { ...result, message: failureMessage(write, result, m) };
}
