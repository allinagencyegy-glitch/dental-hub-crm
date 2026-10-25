import { describe, expect, it } from 'vitest';
import { messagesFor } from '../../src/i18n/messages';
import { failureMessage, localise, statusFailure, type LeadFailureCode } from '../../src/server/crm/leads/messages';
import {
  DuplicateOpenLeadError,
  InvalidDisqualifyReasonError,
  InvalidLeadStatusTransitionError,
  LeadAlreadyArchivedError,
  LeadForbiddenError,
  LeadNotArchivedError,
  LeadNotFoundError,
} from '../../src/server/crm/leads/repository';

const ar = messagesFor('ar');
const en = messagesFor('en');

const CODES: LeadFailureCode[] = [
  'VALIDATION',
  'UNAUTHORISED',
  'NOT_FOUND',
  'IDENTITY_CONFLICT',
  'SOURCE_NOT_FOUND',
  'CAMPAIGN_MISMATCH',
  'CATEGORY_NOT_FOUND',
  'OWNER_NOT_FOUND',
  'DUPLICATE_LEAD',
  'ACCOUNT_NOT_FOUND',
  'INTERNAL',
];

const ARABIC = /[؀-ۿ]/;

describe('lead failure messages', () => {
  it('has text for every failure code, in both languages', () => {
    for (const code of CODES) {
      expect(failureMessage(code, en, 'Omar').trim(), code).not.toBe('');
      expect(failureMessage(code, ar, 'Omar'), code).toMatch(ARABIC);
    }
  });

  it('names who already works a duplicate contact', () => {
    expect(failureMessage('DUPLICATE_LEAD', ar, 'عمر')).toContain('عمر');
    expect(failureMessage('DUPLICATE_LEAD', en, 'Omar')).toContain('owned by Omar');
  });

  it('replaces only the message of a failed result', () => {
    const failed = localise(
      {
        ok: false as const,
        error: 'DUPLICATE_LEAD' as const,
        message: 'This contact already has an open lead, owned by Omar.',
        existingLeadId: 'lead-1',
        existingOwnerName: 'Omar',
      },
      ar,
    );
    expect(failed).toEqual({
      ok: false,
      error: 'DUPLICATE_LEAD',
      message: ar.leads.errors.duplicateLead('Omar'),
      existingLeadId: 'lead-1',
      existingOwnerName: 'Omar',
    });

    const conflict = localise(
      {
        ok: false as const,
        error: 'IDENTITY_CONFLICT' as const,
        message: 'Phone and email resolve to different contacts.',
        conflict: { phoneContactId: 'a', emailContactId: 'b' },
      },
      ar,
    );
    expect(conflict).toMatchObject({ message: ar.leads.errors.identityConflict, conflict: { phoneContactId: 'a' } });

    const succeeded = { ok: true as const, leadId: 'lead-2' };
    expect(localise(succeeded, ar)).toBe(succeeded);
  });

  it('translates the failures of the status actions', () => {
    const cases: [unknown, string, string][] = [
      [new LeadNotFoundError('x'), 'NOT_FOUND', ar.leads.errors.notFound],
      [new LeadForbiddenError(), 'FORBIDDEN', ar.leads.errors.notAuthorised],
      [new InvalidLeadStatusTransitionError('DISQUALIFIED', 'CONTACTED'), 'INVALID_TRANSITION', ar.leads.errors.invalidTransition],
      [new LeadAlreadyArchivedError(), 'VALIDATION', ar.leads.errors.alreadyArchived],
      [new LeadNotArchivedError(), 'VALIDATION', ar.leads.errors.notArchived],
      [new DuplicateOpenLeadError('lead-1', 'user-1', 'عمر'), 'DUPLICATE_LEAD', ar.leads.errors.duplicateLead('عمر')],
      [new InvalidDisqualifyReasonError('requires a note', 'NOTE_REQUIRED'), 'INVALID_REASON', ar.leads.detail.reasonNoteRequired],
      [new InvalidDisqualifyReasonError('wrong kind', 'WRONG_KIND'), 'INVALID_REASON', ar.leads.errors.reasonWrongKind],
      [new InvalidDisqualifyReasonError('not active', 'INACTIVE'), 'INVALID_REASON', ar.leads.errors.reasonNotFound],
      [new InvalidDisqualifyReasonError('not found', 'NOT_FOUND'), 'INVALID_REASON', ar.leads.errors.reasonNotFound],
    ];
    for (const [error, code, message] of cases) {
      expect(statusFailure(error, ar)).toEqual({ ok: false, error: code, message });
    }
  });

  it('leaves an unexpected error to be thrown', () => {
    expect(statusFailure(new Error('boom'), ar)).toBeNull();
  });
});
