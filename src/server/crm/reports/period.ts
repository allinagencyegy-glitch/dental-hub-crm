/**
 * The reporting periods, as Cairo calendar dates.
 *
 * A period resolves to an inclusive pair of YYYY-MM-DD dates in the business
 * timezone; the repository turns them into the half-open instant interval
 * [Cairo midnight of the start, Cairo midnight after the end). Pure, so the
 * page, the action and the tests read periods exactly the same way.
 */

export const REPORT_PERIODS = ['thisMonth', 'lastMonth', 'thisQuarter', 'thisYear', 'lastYear', 'custom'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export function isReportPeriod(value: unknown): value is ReportPeriod {
  return typeof value === 'string' && (REPORT_PERIODS as readonly string[]).includes(value);
}

export interface ReportDates {
  /** First day, YYYY-MM-DD, inclusive. */
  startDate: string;
  /** Last day, YYYY-MM-DD, inclusive. */
  endDate: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in Cairo as year, month (1-12) and day. */
function cairoToday(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A real calendar date, so 2026-02-30 is refused rather than rolled over. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= lastDayOf(year, month);
}

/**
 * The dates a period covers on `now`. A running period (this month, quarter
 * or year) ends today. A custom period needs two calendar dates in order; an
 * unreadable one falls back to this month, so a bad link never errors.
 */
export function resolveReportPeriod(
  period: ReportPeriod,
  now: Date,
  custom?: { startDate?: string | null; endDate?: string | null },
): ReportDates {
  const today = cairoToday(now);
  const todayIso = iso(today.year, today.month, today.day);
  switch (period) {
    case 'lastMonth': {
      const year = today.month === 1 ? today.year - 1 : today.year;
      const month = today.month === 1 ? 12 : today.month - 1;
      return { startDate: iso(year, month, 1), endDate: iso(year, month, lastDayOf(year, month)) };
    }
    case 'thisQuarter': {
      const firstMonth = Math.floor((today.month - 1) / 3) * 3 + 1;
      return { startDate: iso(today.year, firstMonth, 1), endDate: todayIso };
    }
    case 'thisYear':
      return { startDate: iso(today.year, 1, 1), endDate: todayIso };
    case 'lastYear':
      return { startDate: iso(today.year - 1, 1, 1), endDate: iso(today.year - 1, 12, 31) };
    case 'custom': {
      const start = custom?.startDate;
      const end = custom?.endDate;
      if (isCalendarDate(start) && isCalendarDate(end) && start <= end) return { startDate: start, endDate: end };
      return resolveReportPeriod('thisMonth', now);
    }
    case 'thisMonth':
      return { startDate: iso(today.year, today.month, 1), endDate: todayIso };
  }
}
