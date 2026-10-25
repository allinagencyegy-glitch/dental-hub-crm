/**
 * The reader's-language text for failed opportunity and follow-up writes.
 *
 * The domain layer keeps its English messages for logs and tests. The actions
 * replace them, at the edge, with text chosen from the failure's code. A code
 * such as NOT_FOUND means a different thing for each write (the lead, the
 * opportunity or the follow-up is gone), so the write is named too.
 */
import type { Messages } from '@/i18n/messages';
import type { FailureCode } from './service';

export type OpportunityWrite =
  | 'qualify'
  | 'changeStage'
  | 'update'
  | 'reassign'
  | 'scheduleOnOpportunity'
  | 'scheduleOnLead'
  | 'complete'
  | 'reschedule';

/** What the reader sees when `write` fails with `code`. */
export function failureMessage(write: OpportunityWrite, code: FailureCode, m: Messages): string {
  const errors = m.opportunities.errors;
  switch (code) {
    case 'NOT_FOUND':
      if (write === 'qualify' || write === 'scheduleOnLead') return errors.leadNotFound;
      if (write === 'complete' || write === 'reschedule') return errors.followUpNotFound;
      return errors.opportunityNotFound;
    case 'UNAUTHORISED':
      return write === 'scheduleOnOpportunity' || write === 'scheduleOnLead'
        ? errors.repCannotAssignFollowUp
        : errors.repCannotReassign;
    case 'VALIDATION':
      // The one rule each write checks beyond what its action already parsed.
      if (write === 'qualify' || write === 'update') return errors.valueNegative;
      if (write === 'changeStage') return errors.unknownStage;
      if (write === 'complete') return errors.outcomeRequired;
      if (write === 'reschedule') return errors.dueRequired;
      return m.common.invalidInput;
    case 'LEAD_NOT_QUALIFIABLE':
      return errors.leadDisqualified;
    case 'ALREADY_QUALIFIED':
      return errors.alreadyQualified;
    case 'INVALID_TRANSITION':
      return errors.invalidTransition;
    case 'LOST_REASON_REQUIRED':
      return errors.lostReasonRequired;
    case 'OWNER_NOT_FOUND':
      return errors.ownerInvalid;
    case 'CATEGORY_NOT_FOUND':
      return errors.categoryNotFound;
    case 'CLOSED_OPPORTUNITY':
      return errors.closedOpportunity;
    case 'LEAD_NOT_SCHEDULABLE':
      return errors.leadNotSchedulable;
    case 'ALREADY_COMPLETED':
      return errors.alreadyCompleted;
    case 'DUE_IN_PAST':
      return errors.dueInPast;
    case 'INTERNAL':
      return m.common.unexpectedError;
  }
}

/** The result with a failure's message in the reader's language. */
export function localise<R extends { ok: true } | { ok: false; error: FailureCode; message: string }>(
  write: OpportunityWrite,
  result: R,
  m: Messages,
): R {
  if (result.ok) return result;
  return { ...result, message: failureMessage(write, result.error, m) };
}
