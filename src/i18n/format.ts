import { INTL_LOCALE, type Locale } from './config';

/**
 * Dates and times are shown on Cairo time, whatever the server's clock or the
 * browser says: everyone using the CRM works in Egypt, and the same instant
 * must print the same on the server render and in the browser.
 */
export const TIME_ZONE = 'Africa/Cairo';

export interface Formatters {
  /** Oct 25, 2026 / 25 أكتوبر 2026 */
  date: (value: Date) => string;
  /** 04:30 PM / 04:30 م */
  time: (value: Date) => string;
  /** Oct 25, 2026, 04:30 PM */
  dateTime: (value: Date) => string;
  /** 1,250 */
  number: (value: number) => string;
  /** EGP 1,250 / 1,250 ج.م. - whole pounds */
  currency: (value: number) => string;
  /** EGP 1,250.50 - to the piastre, for the amounts on a quotation */
  currencyExact: (value: number) => string;
}

const cache = new Map<Locale, Formatters>();

export function formatters(locale: Locale): Formatters {
  const cached = cache.get(locale);
  if (cached) return cached;
  const tag = INTL_LOCALE[locale];
  const date = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric', timeZone: TIME_ZONE });
  const time = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });
  const dateTime = new Intl.DateTimeFormat(tag, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  });
  const number = new Intl.NumberFormat(tag, { maximumFractionDigits: 2 });
  const currency = new Intl.NumberFormat(tag, { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 });
  const currencyExact = new Intl.NumberFormat(tag, { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 });
  const built: Formatters = {
    date: (value) => date.format(value),
    time: (value) => time.format(value),
    dateTime: (value) => dateTime.format(value),
    number: (value) => number.format(value),
    currency: (value) => currency.format(value),
    currencyExact: (value) => currencyExact.format(value),
  };
  cache.set(locale, built);
  return built;
}

/**
 * The label for a catalog row (source, product category, reason). Catalog
 * rows keep their English name in the database; a translation is looked up by
 * the row's stable code, and a row added later without one shows its name.
 */
export function catalogLabel(labels: Readonly<Record<string, string>>, code: string | null | undefined, fallback: string): string {
  return (code && Object.hasOwn(labels, code) ? labels[code] : undefined) ?? fallback;
}

/**
 * How long ago `value` was, in the reader's language: "5 minutes ago",
 * "yesterday", "3 days ago" / "قبل ٣ أيام". Past a month it counts months.
 */
export function formatAgo(locale: Locale, value: Date, now: Date): string {
  const relative = new Intl.RelativeTimeFormat(INTL_LOCALE[locale], { numeric: 'auto' });
  const minutes = Math.max(0, Math.floor((now.getTime() - value.getTime()) / 60_000));
  if (minutes < 60) return relative.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 30) return relative.format(-days, 'day');
  return relative.format(-Math.floor(days / 30), 'month');
}
