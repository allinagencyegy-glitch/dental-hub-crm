import { describe, expect, it } from 'vitest';
import { messagesFor } from '../../src/i18n/messages';
import { formatters } from '../../src/i18n/format';
import { snapshotReason } from '../../src/i18n/quotation';
import { failureMessage, localise } from '../../src/server/crm/quotations/messages';
import type { FailureCode, QuotationProblem } from '../../src/server/crm/quotations/service';

const ar = messagesFor('ar');
const en = messagesFor('en');

const CODES: FailureCode[] = [
  'VALIDATION',
  'UNAUTHORISED',
  'NOT_FOUND',
  'CLOSED_OPPORTUNITY',
  'INVALID_TRANSITION',
  'NOT_DRAFT',
  'ALREADY_ACCEPTED',
  'INTERNAL',
];

const PROBLEMS: QuotationProblem[] = [
  'ITEMS_REQUIRED',
  'TOO_MANY_ITEMS',
  'DESCRIPTION_REQUIRED',
  'DESCRIPTION_TOO_LONG',
  'QUANTITY_NOT_POSITIVE',
  'UNIT_PRICE_NEGATIVE',
  'DISCOUNT_NEGATIVE',
  'TAX_NEGATIVE',
  'VALID_UNTIL_UNREADABLE',
  'DISCOUNT_EXCEEDS_SUBTOTAL',
  'UNKNOWN_STATUS',
];

describe('quotation failure messages', () => {
  it('has text in both languages for every failure', () => {
    for (const write of ['create', 'change'] as const) {
      for (const error of CODES) {
        const arabic = failureMessage(write, { error }, ar);
        expect(arabic, `${write} ${error}`).toMatch(/[؀-ۿ]/);
        expect(failureMessage(write, { error }, en), `${write} ${error}`).not.toBe(arabic);
      }
    }
  });

  it('names the rule a validation failure broke', () => {
    const texts = PROBLEMS.map((problem) => failureMessage('change', { error: 'VALIDATION', problem }, ar));
    for (const text of texts) expect(text).toMatch(/[؀-ۿ]/);
    // Each rule has its own sentence.
    expect(new Set(texts).size).toBe(PROBLEMS.length);
    expect(failureMessage('create', { error: 'VALIDATION', problem: 'DISCOUNT_EXCEEDS_SUBTOTAL' }, en)).toBe(
      'Discount cannot exceed the subtotal.',
    );
    // Without a rule, the input as a whole could not be read.
    expect(failureMessage('create', { error: 'VALIDATION' }, ar)).toBe('تعذّرت قراءة بيانات عرض السعر.');
  });

  it('says what went missing for the write', () => {
    expect(failureMessage('create', { error: 'NOT_FOUND' }, ar)).toBe('الفرصة غير موجودة.');
    expect(failureMessage('change', { error: 'NOT_FOUND' }, ar)).toBe('عرض السعر غير موجود.');
  });

  it('names the quotation that already holds the acceptance', () => {
    expect(failureMessage('change', { error: 'ALREADY_ACCEPTED', acceptedQuoteNumber: 'Q-2026-0004' }, ar)).toBe(
      'عرض السعر Q-2026-0004 مقبول بالفعل على هذه الفرصة، ولا تقبل الفرصة إلا عرض سعر واحدًا.',
    );
    expect(failureMessage('change', { error: 'ALREADY_ACCEPTED', acceptedQuoteNumber: 'Q-2026-0004' }, en)).toBe(
      'Quotation Q-2026-0004 is already accepted on this opportunity. An opportunity can have only one accepted quotation.',
    );
  });

  it('replaces only the message of a failure', () => {
    const failure = {
      ok: false as const,
      error: 'VALIDATION' as const,
      problem: 'TAX_NEGATIVE' as const,
      message: 'Tax cannot be negative.',
    };
    expect(localise('change', failure, ar)).toEqual({ ...failure, message: 'الضريبة لا يمكن أن تكون سالبة.' });

    const success = { ok: true as const };
    expect(localise('create', success, ar)).toBe(success);
  });
});

describe('version history reasons', () => {
  it('shows a reason typed by a person as it was stored', () => {
    expect(snapshotReason('Customer asked for two units', ar)).toBe('Customer asked for two units');
    expect(snapshotReason('Status moved to BOGUS', ar)).toBe('Status moved to BOGUS');
  });

  it('reads the reasons back in English, with the status by its label', () => {
    for (const reason of ['Quotation created', 'Draft updated', 'Draft edited', 'Status moved to SENT', 'Revision of Q-1']) {
      expect(snapshotReason(reason, en)).toBe(reason.replace('SENT', 'Sent'));
    }
  });
});

describe('quotation amounts', () => {
  it('keeps the piastres', () => {
    expect(formatters('en').currencyExact(124500.5)).toMatch(/^EGP\s124,500\.50?$/);
    expect(formatters('ar').currencyExact(124500.5)).toContain('124,500.5');
    expect(formatters('ar').currencyExact(124500.5)).toContain('ج.م.');
  });
});
