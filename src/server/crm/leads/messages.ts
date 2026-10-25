/**
 * The reader's-language text for failed lead writes.
 *
 * The domain layer keeps its English messages for logs and tests. The actions
 * replace them, at the edge, with text chosen from the failure's code in the
 * reader's language.
 */
import type { Messages } from '@/i18n/messages';
import type { CaptureLeadResult, LinkLeadAccountResult, UpdateLeadResult } from './service';
import {
  DuplicateOpenLeadError,
  InvalidDisqualifyReasonError,
  InvalidLeadStatusTransitionError,
  LeadAlreadyArchivedError,
  LeadForbiddenError,
  LeadNotArchivedError,
  LeadNotFoundError,
} from './repository';

type FailureCode<R> = Extract<R, { ok: false }> extends { error: infer E } ? E : never;
export type LeadFailureCode =
  | FailureCode<CaptureLeadResult>
  | FailureCode<UpdateLeadResult>
  | FailureCode<LinkLeadAccountResult>;

/** What the reader sees for a failed lead write. */
export function failureMessage(code: LeadFailureCode, m: Messages, ownerName?: string): string {
  const errors = m.leads.errors;
  switch (code) {
    case 'NOT_FOUND':
      return errors.notFound;
    case 'UNAUTHORISED':
      // The only write a rep is refused outright: handing the lead to someone else.
      return errors.repCannotReassign;
    case 'SOURCE_NOT_FOUND':
      return errors.sourceNotFound;
    case 'CAMPAIGN_MISMATCH':
      return errors.campaignMismatch;
    case 'CATEGORY_NOT_FOUND':
      return errors.categoryNotFound;
    case 'OWNER_NOT_FOUND':
      return errors.ownerInvalid;
    case 'IDENTITY_CONFLICT':
      return errors.identityConflict;
    case 'DUPLICATE_LEAD':
      return errors.duplicateLead(ownerName ?? '');
    case 'ACCOUNT_NOT_FOUND':
      return errors.clinicNotFound;
    case 'VALIDATION':
      return m.common.invalidInput;
    case 'INTERNAL':
      return m.common.unexpectedError;
  }
}

export function localise<R extends { ok: boolean }>(result: R, m: Messages): R {
  if (result.ok) return result;
  const failure = result as unknown as { error: LeadFailureCode; existingOwnerName?: string };
  return { ...result, message: failureMessage(failure.error, m, failure.existingOwnerName) };
}

export type StatusFailure = { ok: false; error: string; message: string };

/** The failures shared by the lead status actions, in the reader's language. */
export function statusFailure(error: unknown, m: Messages): StatusFailure | null {
  const errors = m.leads.errors;
  if (error instanceof LeadNotFoundError) return { ok: false, error: 'NOT_FOUND', message: errors.notFound };
  if (error instanceof LeadForbiddenError) return { ok: false, error: 'FORBIDDEN', message: errors.notAuthorised };
  if (error instanceof InvalidLeadStatusTransitionError) {
    return { ok: false, error: 'INVALID_TRANSITION', message: errors.invalidTransition };
  }
  if (error instanceof LeadAlreadyArchivedError) return { ok: false, error: 'VALIDATION', message: errors.alreadyArchived };
  if (error instanceof LeadNotArchivedError) return { ok: false, error: 'VALIDATION', message: errors.notArchived };
  if (error instanceof DuplicateOpenLeadError) {
    return { ok: false, error: 'DUPLICATE_LEAD', message: errors.duplicateLead(error.ownerName) };
  }
  if (error instanceof InvalidDisqualifyReasonError) {
    const message =
      error.problem === 'NOTE_REQUIRED'
        ? m.leads.detail.reasonNoteRequired
        : error.problem === 'WRONG_KIND'
          ? errors.reasonWrongKind
          : errors.reasonNotFound;
    return { ok: false, error: 'INVALID_REASON', message };
  }
  return null;
}
