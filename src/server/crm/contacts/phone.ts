/**
 * Canonical phone identity: normalisation to E.164.
 *
 * PHONE is the canonical telephone identity and the stored value is always
 * E.164, so identity comparison is a plain string equality - which is what
 * makes the global UNIQUE index on crm_contact_channel.value meaningful.
 *
 * The default country is EG: a number dialled locally in Egypt carries no
 * country code, so the repository supplies +20. The rules, in order:
 *
 *   1. A leading '+' marks the number as already international.
 *   2. A leading '00' is the international dialling prefix and is replaced by '+'.
 *   3. A leading '0' is the Egyptian trunk prefix: it is dropped and '+20' prepended.
 *   4. A leading '20' with a plausible Egyptian national remainder (8-10 digits)
 *      is treated as the country code written without '+'.
 *   5. Anything else is an Egyptian national number and gets '+20' prepended.
 *
 * The result is validated as E.164: '+', a non-zero first digit, 7-15 digits
 * in total. Spaces, dashes, dots and parentheses are tolerated as separators;
 * every other non-digit rejects the number.
 *
 * This is deliberately a small explicit normaliser, not a phone-number
 * library: the scope is Egyptian numbers plus already-international input,
 * and the rules above are the whole contract. The database CHECK mirrors the
 * final shape (`^\+[1-9][0-9]{6,14}$`) so an un-normalised value can never be
 * stored, whatever the writer.
 */
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
const SEPARATORS = /[\s().-]/g;

export const DEFAULT_COUNTRY_CODE = '20'; // EG

export class InvalidPhoneError extends Error {
  constructor(raw: string) {
    super(`"${raw}" is not a valid telephone number.`);
    this.name = 'InvalidPhoneError';
  }
}

function isPlausibleEgyptianNationalNumber(digits: string): boolean {
  return digits.length >= 8 && digits.length <= 10;
}

export function normalisePhoneToE164(
  raw: string,
  defaultCountryCode: string = DEFAULT_COUNTRY_CODE,
): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new InvalidPhoneError(raw);

  const hasPlus = trimmed.startsWith('+');
  const digits = (hasPlus ? trimmed.slice(1) : trimmed).replace(SEPARATORS, '');
  if (!/^\d+$/.test(digits)) throw new InvalidPhoneError(raw);

  let international: string;
  if (hasPlus) {
    international = digits;
  } else if (digits.startsWith('00')) {
    international = digits.slice(2);
  } else if (digits.startsWith('0')) {
    international = defaultCountryCode + digits.slice(1);
  } else if (
    digits.startsWith(defaultCountryCode) &&
    isPlausibleEgyptianNationalNumber(digits.slice(defaultCountryCode.length))
  ) {
    international = digits;
  } else {
    international = defaultCountryCode + digits;
  }

  const e164 = `+${international}`;
  if (!E164_PATTERN.test(e164)) throw new InvalidPhoneError(raw);
  return e164;
}
