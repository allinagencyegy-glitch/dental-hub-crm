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
 * Arabic-Indic and Extended Arabic-Indic digits become ASCII digits before
 * parsing, and invisible direction marks are removed. Spaces, dashes, dots
 * and parentheses are tolerated as separators; every other non-digit rejects
 * the number. The result must be E.164: '+', a non-zero first digit, 7-15 digits
 * in total. Egyptian results must also have a valid 10-digit mobile national
 * number (1 followed by 0, 1, 2 or 5 and eight digits) or an 8-9 digit
 * landline national number beginning with 2-9. Other countries receive only
 * the E.164 check.
 *
 * This is deliberately a small explicit normaliser, not a phone-number
 * library: the scope is Egyptian numbers plus already-international input,
 * and the rules above are the whole contract. The database CHECK mirrors the
 * final shape (`^\+[1-9][0-9]{6,14}$`) so an un-normalised value can never be
 * stored, whatever the writer.
 */
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
const SEPARATORS = /[\s().-]/g;
const ARABIC_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/g;
const DIRECTION_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export const DEFAULT_COUNTRY_CODE = '20'; // EG
export const EGYPTIAN_MOBILE_SECOND_DIGITS = '0125';

const EGYPTIAN_MOBILE_PATTERN = new RegExp(`^1[${EGYPTIAN_MOBILE_SECOND_DIGITS}]\\d{8}$`);
const EGYPTIAN_LANDLINE_PATTERN = /^[2-9]\d{7,8}$/;

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
  const trimmed = raw
    .replace(DIRECTION_MARKS, '')
    .replace(ARABIC_DIGITS, (digit) => {
      const code = digit.charCodeAt(0);
      return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
    })
    .trim();
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
  if (e164.startsWith('+20')) {
    const national = international.slice(DEFAULT_COUNTRY_CODE.length);
    if (!EGYPTIAN_MOBILE_PATTERN.test(national) && !EGYPTIAN_LANDLINE_PATTERN.test(national)) {
      throw new InvalidPhoneError(raw);
    }
  }
  return e164;
}
