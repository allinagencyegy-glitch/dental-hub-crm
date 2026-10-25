/**
 * The languages the CRM speaks. Pure data, safe to import from client and
 * server alike.
 *
 * The language is chosen per browser with a cookie (see `/api/locale`), not
 * per URL: the CRM is an internal tool with nothing to index, and a cookie also
 * works on the sign-in page before anyone is known.
 */
export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ar';
export const LOCALE_COOKIE = 'dental_hub_locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function textDirection(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/**
 * The Intl locale behind each language. Arabic keeps Latin digits (123, not
 * ١٢٣), as Egyptian phones, banks and invoices do.
 */
export const INTL_LOCALE: Record<Locale, string> = {
  ar: 'ar-EG-u-nu-latn',
  en: 'en-EG',
};
