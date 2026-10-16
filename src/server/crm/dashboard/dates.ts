/**
 * The date-range vocabulary for management analytics.
 *
 * Every period metric is compared against a half-open interval [start, end)
 * and every boundary is an absolute instant computed with the CRM's business
 * timezone (Africa/Cairo), exactly like the follow-up queue.
 *
 * Which field drives which metric (documented here so the UI and the tests
 * can never disagree):
 *
 *   new leads              lead.created_at          (period)
 *   won count / value      opportunity.won_at       (period)
 *   lost count / value     opportunity.lost_at      (period)
 *   quotation sent         quotation.sent_at        (period)
 *   quotation accepted     quotation.accepted_at    (period)
 *   quotation rejected     quotation.rejected_at    (period)
 *   completed follow-ups   followup.completed_at    (period)
 *   funnel                 lead.created_at cohort;  (cohort + snapshot)
 *                          each step is "of that cohort, how many reached X":
 *                          Leads received -> Qualified (has an opportunity)
 *                          -> Won (opportunity.stage = WON), nested by
 *                          construction. Contacted is NOT a step.
 *   quotation conversion   same cohort, reported separately: quoted (a
 *                          quotation was ever sent) and accepted. Quoting is
 *                          not a funnel stage because the domain does not
 *                          require a quotation before a win.
 *   leads by status        lead.status              (snapshot)
 *   open opportunities     opportunity.stage        (snapshot)
 *   pipeline value         opportunity.estimated_value over open stages (snapshot)
 *   overdue / due today    followup.due_at vs now   (snapshot)
 *   stage distribution     opportunity.stage        (snapshot)
 *   rep performance        mixes both: period fields as above, snapshot fields
 *                          labelled snapshot in the repository docs.
 *
 * Snapshot metrics never change with the selected range; the UI labels them
 * "right now" so period and snapshot numbers are not conflated.
 */

export const DASHBOARD_RANGES = ['last7', 'last30', 'thisMonth', 'custom'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const DASHBOARD_RANGE_LABELS: Record<DashboardRange, string> = {
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  thisMonth: 'This month',
  custom: 'Custom',
};

export function isDashboardRange(value: unknown): value is DashboardRange {
  return typeof value === 'string' && (DASHBOARD_RANGES as readonly string[]).includes(value);
}

export const BUSINESS_TIMEZONE = 'Africa/Cairo';

export interface CustomRange {
  /** YYYY-MM-DD; becomes Cairo midnight of that date. */
  startDate: string;
  /** YYYY-MM-DD; the interval runs to Cairo midnight of the day after. */
  endDate: string;
}

/**
 * Appends the range's boundary values to `params` and returns the SQL
 * condition `column >= <start> AND column < <end>` with correctly numbered
 * placeholders. Callers must use the returned fragment in the same query they
 * pass `params` to.
 */
export function rangeClause(
  column: string,
  range: DashboardRange,
  params: string[],
  custom?: CustomRange,
): string {
  switch (range) {
    case 'last7':
      return `${column} >= now() - interval '7 days' AND ${column} < now()`;
    case 'last30':
      return `${column} >= now() - interval '30 days' AND ${column} < now()`;
    case 'thisMonth':
      return `${column} >= date_trunc('month', now(), '${BUSINESS_TIMEZONE}') AND ${column} < now()`;
    case 'custom': {
      if (!custom) throw new Error('A custom range needs startDate and endDate.');
      params.push(custom.startDate, custom.endDate);
      const start = `$${params.length - 1}`;
      const end = `$${params.length}`;
      // Cairo midnight boundaries: `YYYY-MM-DD` read as a Cairo wall-clock
      // midnight, converted to the absolute instant. The end boundary is the
      // next Cairo day, so the end date is fully inside the interval.
      return (
        `${column} >= (${start}::date::timestamp AT TIME ZONE '${BUSINESS_TIMEZONE}') AND ` +
        `${column} < ((${end}::date + 1)::timestamp AT TIME ZONE '${BUSINESS_TIMEZONE}')`
      );
    }
  }
}
