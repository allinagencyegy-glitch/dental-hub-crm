import { describe, expect, it } from 'vitest';
import { messagesFor } from '../../src/i18n/messages';
import { activityTitle } from '../../src/i18n/activity';
import { failureMessage, localise, type OpportunityWrite } from '../../src/server/crm/opportunities/messages';
import type { FailureCode } from '../../src/server/crm/opportunities/service';
import type { OpportunityActivityEntry } from '../../src/server/crm/opportunities/repository';

const ar = messagesFor('ar');
const en = messagesFor('en');

const CODES: FailureCode[] = [
  'VALIDATION',
  'UNAUTHORISED',
  'NOT_FOUND',
  'LEAD_NOT_QUALIFIABLE',
  'ALREADY_QUALIFIED',
  'INVALID_TRANSITION',
  'LOST_REASON_REQUIRED',
  'OWNER_NOT_FOUND',
  'CATEGORY_NOT_FOUND',
  'CLOSED_OPPORTUNITY',
  'LEAD_NOT_SCHEDULABLE',
  'ALREADY_COMPLETED',
  'DUE_IN_PAST',
  'INTERNAL',
];

const WRITES: OpportunityWrite[] = [
  'qualify',
  'changeStage',
  'update',
  'reassign',
  'scheduleOnOpportunity',
  'scheduleOnLead',
  'complete',
  'reschedule',
];

describe('opportunity failure messages', () => {
  it('has text in both languages for every write and failure', () => {
    for (const write of WRITES) {
      for (const code of CODES) {
        const arabic = failureMessage(write, code, ar);
        expect(arabic, `${write} ${code}`).toMatch(/[؀-ۿ]/);
        expect(failureMessage(write, code, en), `${write} ${code}`).not.toBe(arabic);
      }
    }
  });

  it('names what went missing for each write', () => {
    expect(failureMessage('qualify', 'NOT_FOUND', ar)).toBe(ar.opportunities.errors.leadNotFound);
    expect(failureMessage('scheduleOnLead', 'NOT_FOUND', ar)).toBe(ar.opportunities.errors.leadNotFound);
    expect(failureMessage('changeStage', 'NOT_FOUND', ar)).toBe(ar.opportunities.errors.opportunityNotFound);
    expect(failureMessage('complete', 'NOT_FOUND', ar)).toBe(ar.opportunities.errors.followUpNotFound);
    expect(failureMessage('reschedule', 'NOT_FOUND', ar)).toBe(ar.opportunities.errors.followUpNotFound);
  });

  it('tells a rep or a team leader who they may not hand work to', () => {
    expect(failureMessage('reassign', 'UNAUTHORISED', en)).toBe(
      'You cannot give this opportunity to that person. A rep keeps their own deals, and a team leader assigns only within their team.',
    );
    expect(failureMessage('scheduleOnOpportunity', 'UNAUTHORISED', en)).toBe(
      'You cannot give this follow-up to that person. A rep keeps their own follow-ups, and a team leader assigns only within their team.',
    );
  });

  it('explains the validation each write can fail', () => {
    expect(failureMessage('qualify', 'VALIDATION', ar)).toBe('القيمة المتوقعة لا يمكن أن تكون سالبة.');
    expect(failureMessage('complete', 'VALIDATION', ar)).toBe('النتيجة مطلوبة لإنهاء المتابعة.');
    expect(failureMessage('changeStage', 'VALIDATION', en)).toBe('Unknown opportunity stage.');
  });

  it('replaces only the message of a failure', () => {
    const failure = { ok: false as const, error: 'DUE_IN_PAST' as const, message: 'A follow-up cannot be scheduled in the past.' };
    expect(localise('scheduleOnOpportunity', failure, ar)).toEqual({
      ok: false,
      error: 'DUE_IN_PAST',
      message: 'لا يمكن جدولة متابعة في وقت مضى.',
    });

    const success = { ok: true as const, followUpId: 'f-1' };
    expect(localise('complete', success, ar)).toBe(success);
  });
});

describe('activity titles', () => {
  function entry(
    activityType: OpportunityActivityEntry['activityType'],
    metadata: Record<string, unknown> | null,
    description = 'stored description',
  ): OpportunityActivityEntry {
    return {
      id: 'a-1',
      opportunityId: 'o-1',
      activityType,
      description,
      metadata,
      actorUserId: null,
      actorName: null,
      createdAt: new Date('2026-10-25T10:00:00Z'),
    };
  }

  it('writes the quotation events from the quote numbers', () => {
    const created = entry('QUOTATION_CREATED', { quoteNumber: 'Q-2026-0007' }, 'Quotation Q-2026-0007 created');
    const revised = entry(
      'QUOTATION_REVISED',
      { quoteNumber: 'Q-2026-0008', previousQuoteNumber: 'Q-2026-0007' },
      'Quotation Q-2026-0007 revised as Q-2026-0008',
    );
    const decided = (['SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const).map((status) =>
      entry(`QUOTATION_${status}`, { quoteNumber: 'Q-2026-0008' }, `Quotation Q-2026-0008 ${status.toLowerCase()}`),
    );

    // English matches what the repository stores, word for word.
    for (const item of [created, revised, ...decided]) expect(activityTitle(item, en)).toBe(item.description);

    expect(activityTitle(created, ar)).toBe('إنشاء عرض السعر Q-2026-0007');
    expect(activityTitle(revised, ar)).toBe('تعديل عرض السعر Q-2026-0007 في Q-2026-0008');
    expect(decided.map((item) => activityTitle(item, ar))).toEqual([
      'إرسال عرض السعر Q-2026-0008',
      'قبول عرض السعر Q-2026-0008',
      'رفض عرض السعر Q-2026-0008',
      'انتهاء صلاحية عرض السعر Q-2026-0008',
    ]);
  });

  it('counts the follow-ups carried over from the lead', () => {
    expect(activityTitle(entry('FOLLOW_UP_MOVED', { count: 3 }), ar)).toBe('نُقلت 3 متابعات معلّقة من العميل المحتمل');
    expect(activityTitle(entry('FOLLOW_UP_MOVED', { count: 2 }), en)).toBe(
      '2 pending follow-ups carried over from the lead',
    );
  });

  it('shows the stored description when the metadata lacks the facts', () => {
    expect(activityTitle(entry('OWNER_CHANGED', { toOwnerUserId: 'u-1' }, 'Owner changed to Old Rep'), ar)).toBe(
      'Owner changed to Old Rep',
    );
    expect(activityTitle(entry('STAGE_CHANGE', null, 'Stage moved'), ar)).toBe('Stage moved');
    expect(activityTitle(entry('STAGE_CHANGE', { fromStage: 'BOGUS', toStage: 'WON' }, 'Stage moved'), ar)).toBe(
      'Stage moved',
    );
    expect(activityTitle(entry('FOLLOW_UP_CREATED', { actionType: 'FAX' }, 'Follow-up scheduled: Fax'), ar)).toBe(
      'Follow-up scheduled: Fax',
    );
    expect(activityTitle(entry('QUOTATION_SENT', {}, 'Quotation Q-1 sent'), ar)).toBe('Quotation Q-1 sent');
  });
});
