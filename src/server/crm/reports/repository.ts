/**
 * Sales reports over a period: who sold what, from which source, and how the
 * calls went.
 *
 * Every metric is dated by the field that records the event and counted when
 * that instant falls in [Cairo midnight of the start date, Cairo midnight
 * after the end date):
 *
 *   new leads          lead.created_at          (lead owner)
 *   qualified          opportunity.created_at   (opportunity owner)
 *   quotations sent    quotation.sent_at        (opportunity owner)
 *   wins / won value   opportunity.won_at       (opportunity owner)
 *   losses             opportunity.lost_at      (opportunity owner)
 *   disqualified       lead.disqualified_at     (lead owner)
 *   calls logged       followup.completed_at    (follow-up assignee)
 *
 * A won deal is worth its accepted quotation, else its estimate - the same
 * rule as the customers page.
 *
 * Row scope: a rep's report covers their own work, a team leader's their
 * team's, a manager's or admin's everyone's (see crm/scope.ts).
 */
import type { Db } from '@/server/db/types';
import { ownerScopeSql, type Actor } from '@/server/crm/scope';
import { NOT_REACHED_OUTCOMES, type FollowUpOutcome } from '@/server/crm/opportunities/followup-actions';
import type { ReportDates } from './period';

export interface ReportPersonRow {
  userId: string;
  displayName: string;
  role: string;
  /** The team leader's name: the person's own for a team leader, null outside any team. */
  teamName: string | null;
  newLeads: number;
  qualified: number;
  quotationsSent: number;
  wins: number;
  wonValue: number;
  losses: number;
  callsLogged: number;
  callsReached: number;
}

export interface ReportBreakdownRow {
  code: string;
  name: string;
  leads: number;
  qualified: number;
  wins: number;
  wonValue: number;
}

export interface ReportReasonRow {
  code: string;
  label: string;
  count: number;
}

export interface ReportMonth {
  /** YYYY-MM in Cairo time. */
  month: string;
  newLeads: number;
  wins: number;
  wonValue: number;
}

export interface SalesReport {
  dates: ReportDates;
  people: ReportPersonRow[];
  categories: ReportBreakdownRow[];
  sources: ReportBreakdownRow[];
  outcomes: { outcome: FollowUpOutcome; count: number }[];
  lostReasons: ReportReasonRow[];
  disqualifyReasons: ReportReasonRow[];
  /** The twelve months up to and including the end date's month. */
  months: ReportMonth[];
}

const WON_VALUE = `COALESCE(
  (SELECT q.total_amount FROM crm_quotation q WHERE q.opportunity_id = o.id AND q.status = 'ACCEPTED'),
  o.estimated_value, 0)`;

/** `column` inside the period; the two dates are always $1 and $2. */
function inPeriod(column: string): string {
  return (
    `${column} >= ($1::date::timestamp AT TIME ZONE 'Africa/Cairo') AND ` +
    `${column} < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo')`
  );
}

/** A query's parameters, starting with the period, plus its scope clause on `column`. */
function scoped(actor: Actor, dates: ReportDates, column: string): { params: unknown[]; scope: string } {
  const params: unknown[] = [dates.startDate, dates.endDate];
  const scope = ownerScopeSql(actor, params, [column]);
  return { params, scope: scope ? `AND ${scope}` : '' };
}

export async function getSalesReport(db: Db, actor: Actor, dates: ReportDates): Promise<SalesReport> {
  const [people, categories, sources, outcomes, lostReasons, disqualifyReasons, months] = await Promise.all([
    reportPeople(db, actor, dates),
    reportBreakdown(db, actor, dates, 'category'),
    reportBreakdown(db, actor, dates, 'source'),
    reportOutcomes(db, actor, dates),
    reportReasons(db, actor, dates, 'lost'),
    reportReasons(db, actor, dates, 'disqualify'),
    reportMonths(db, actor, dates),
  ]);
  return { dates, people, categories, sources, outcomes, lostReasons, disqualifyReasons, months };
}

/**
 * One row per person in scope who sells or did something in the period,
 * grouped by team, busiest first within it.
 */
async function reportPeople(db: Db, actor: Actor, dates: ReportDates): Promise<ReportPersonRow[]> {
  const { params, scope } = scoped(actor, dates, 'u.id');
  const { rows } = await db.query<{
    id: string;
    display_name: string;
    role: string;
    team_name: string | null;
    new_leads: number;
    qualified: number;
    quotations_sent: number;
    wins: number;
    won_value: string;
    losses: number;
    calls_logged: number;
    calls_reached: number;
  }>(
    `WITH person AS (
       SELECT u.id, u.display_name, u.role::text AS role, u.is_active,
              CASE WHEN u.role = 'SALES_TEAM_LEADER' THEN u.display_name ELSE leader.display_name END AS team_name,
              (SELECT count(*)::int FROM crm_lead l
                WHERE l.owner_user_id = u.id AND ${inPeriod('l.created_at')}) AS new_leads,
              (SELECT count(*)::int FROM crm_opportunity o
                WHERE o.owner_user_id = u.id AND ${inPeriod('o.created_at')}) AS qualified,
              (SELECT count(*)::int FROM crm_quotation q JOIN crm_opportunity o ON o.id = q.opportunity_id
                WHERE o.owner_user_id = u.id AND ${inPeriod('q.sent_at')}) AS quotations_sent,
              (SELECT count(*)::int FROM crm_opportunity o
                WHERE o.owner_user_id = u.id AND ${inPeriod('o.won_at')}) AS wins,
              (SELECT COALESCE(sum(${WON_VALUE}), 0)::text FROM crm_opportunity o
                WHERE o.owner_user_id = u.id AND ${inPeriod('o.won_at')}) AS won_value,
              (SELECT count(*)::int FROM crm_opportunity o
                WHERE o.owner_user_id = u.id AND ${inPeriod('o.lost_at')}) AS losses,
              (SELECT count(*)::int FROM crm_followup f
                WHERE f.owner_user_id = u.id AND ${inPeriod('f.completed_at')}) AS calls_logged,
              (SELECT count(*)::int FROM crm_followup f
                WHERE f.owner_user_id = u.id AND ${inPeriod('f.completed_at')}
                  AND f.outcome IS NOT NULL AND f.outcome <> ALL ($${params.length + 1}::text[])) AS calls_reached
         FROM crm_user u
         LEFT JOIN crm_user leader ON leader.id = u.team_leader_id
        WHERE u.role IN ('SALES_MANAGER', 'SALES_TEAM_LEADER', 'SALES_REP') ${scope}
     )
     SELECT * FROM person
      WHERE is_active OR new_leads + qualified + quotations_sent + wins + losses + calls_logged > 0
      ORDER BY team_name NULLS LAST, wins DESC, new_leads DESC, display_name`,
    [...params, [...NOT_REACHED_OUTCOMES]],
  );
  return rows.map((row) => ({
    userId: row.id,
    displayName: row.display_name,
    role: row.role,
    teamName: row.team_name,
    newLeads: row.new_leads,
    qualified: row.qualified,
    quotationsSent: row.quotations_sent,
    wins: row.wins,
    wonValue: Number(row.won_value),
    losses: row.losses,
    callsLogged: row.calls_logged,
    callsReached: row.calls_reached,
  }));
}

/**
 * Leads, qualified deals and wins per product category or lead source. A
 * category is read from the lead for leads and from the deal for the rest
 * (an owner may refine it while qualifying); a source always from the lead.
 */
async function reportBreakdown(
  db: Db,
  actor: Actor,
  dates: ReportDates,
  by: 'category' | 'source',
): Promise<ReportBreakdownRow[]> {
  const leadScope = scoped(actor, dates, 'l.owner_user_id');
  const dealScope = ownerScopeSql(actor, leadScope.params, ['o.owner_user_id']);
  const dealScopeSql = dealScope ? `AND ${dealScope}` : '';
  const table = by === 'category' ? 'crm_product_category' : 'crm_source';
  const leadKey = by === 'category' ? 'l.product_category_id' : 'l.source_id';
  const dealKey =
    by === 'category' ? 'o.product_category_id' : '(SELECT dl.source_id FROM crm_lead dl WHERE dl.id = o.lead_id)';

  const { rows } = await db.query<{
    code: string;
    name: string;
    leads: number;
    qualified: number;
    wins: number;
    won_value: string;
  }>(
    `SELECT t.code, t.name,
            (SELECT count(*)::int FROM crm_lead l
              WHERE ${leadKey} = t.id AND ${inPeriod('l.created_at')} ${leadScope.scope}) AS leads,
            (SELECT count(*)::int FROM crm_opportunity o
              WHERE ${dealKey} = t.id AND ${inPeriod('o.created_at')} ${dealScopeSql}) AS qualified,
            (SELECT count(*)::int FROM crm_opportunity o
              WHERE ${dealKey} = t.id AND ${inPeriod('o.won_at')} ${dealScopeSql}) AS wins,
            (SELECT COALESCE(sum(${WON_VALUE}), 0)::text FROM crm_opportunity o
              WHERE ${dealKey} = t.id AND ${inPeriod('o.won_at')} ${dealScopeSql}) AS won_value
       FROM ${table} t`,
    leadScope.params,
  );
  return rows
    .map((row) => ({
      code: row.code,
      name: row.name,
      leads: row.leads,
      qualified: row.qualified,
      wins: row.wins,
      wonValue: Number(row.won_value),
    }))
    .filter((row) => row.leads + row.qualified + row.wins > 0)
    .sort((a, b) => b.wonValue - a.wonValue || b.wins - a.wins || b.leads - a.leads || a.name.localeCompare(b.name));
}

/** Completed follow-ups in the period by result, most frequent first. */
async function reportOutcomes(
  db: Db,
  actor: Actor,
  dates: ReportDates,
): Promise<{ outcome: FollowUpOutcome; count: number }[]> {
  const { params, scope } = scoped(actor, dates, 'f.owner_user_id');
  const { rows } = await db.query<{ outcome: FollowUpOutcome; count: number }>(
    `SELECT f.outcome, count(*)::int AS count
       FROM crm_followup f
      WHERE f.outcome IS NOT NULL AND ${inPeriod('f.completed_at')} ${scope}
      GROUP BY f.outcome
      ORDER BY count DESC, f.outcome`,
    params,
  );
  return rows;
}

/** Why deals were lost, or leads disqualified, in the period. */
async function reportReasons(
  db: Db,
  actor: Actor,
  dates: ReportDates,
  kind: 'lost' | 'disqualify',
): Promise<ReportReasonRow[]> {
  const lost = kind === 'lost';
  const { params, scope } = scoped(actor, dates, lost ? 'o.owner_user_id' : 'l.owner_user_id');
  const { rows } = await db.query<ReportReasonRow>(
    lost
      ? `SELECT r.code, r.label, count(*)::int AS count
           FROM crm_opportunity o JOIN crm_outcome_reason r ON r.id = o.lost_reason_id
          WHERE ${inPeriod('o.lost_at')} ${scope}
          GROUP BY r.code, r.label
          ORDER BY count DESC, r.code`
      : `SELECT r.code, r.label, count(*)::int AS count
           FROM crm_lead l JOIN crm_outcome_reason r ON r.id = l.disqualify_reason_id
          WHERE ${inPeriod('l.disqualified_at')} ${scope}
          GROUP BY r.code, r.label
          ORDER BY count DESC, r.code`,
    params,
  );
  return rows;
}

/** New leads and wins for each of the twelve months ending with the period's last month. */
async function reportMonths(db: Db, actor: Actor, dates: ReportDates): Promise<ReportMonth[]> {
  const params: unknown[] = [dates.endDate];
  const leadScope = ownerScopeSql(actor, params, ['l.owner_user_id']);
  const dealScope = ownerScopeSql(actor, params, ['o.owner_user_id']);
  const { rows } = await db.query<{ month: string; new_leads: number; wins: number; won_value: string }>(
    `WITH months AS (
       SELECT generate_series(
                date_trunc('month', $1::date) - interval '11 months',
                date_trunc('month', $1::date),
                interval '1 month'
              )::date AS first_day
     )
     SELECT to_char(m.first_day, 'YYYY-MM') AS month,
            (SELECT count(*)::int FROM crm_lead l
              WHERE l.created_at >= (m.first_day::timestamp AT TIME ZONE 'Africa/Cairo')
                AND l.created_at < ((m.first_day + interval '1 month')::timestamp AT TIME ZONE 'Africa/Cairo')
                ${leadScope ? `AND ${leadScope}` : ''}) AS new_leads,
            (SELECT count(*)::int FROM crm_opportunity o
              WHERE o.won_at >= (m.first_day::timestamp AT TIME ZONE 'Africa/Cairo')
                AND o.won_at < ((m.first_day + interval '1 month')::timestamp AT TIME ZONE 'Africa/Cairo')
                ${dealScope ? `AND ${dealScope}` : ''}) AS wins,
            (SELECT COALESCE(sum(${WON_VALUE}), 0)::text FROM crm_opportunity o
              WHERE o.won_at >= (m.first_day::timestamp AT TIME ZONE 'Africa/Cairo')
                AND o.won_at < ((m.first_day + interval '1 month')::timestamp AT TIME ZONE 'Africa/Cairo')
                ${dealScope ? `AND ${dealScope}` : ''}) AS won_value
       FROM months m
      ORDER BY m.first_day`,
    params,
  );
  return rows.map((row) => ({
    month: row.month,
    newLeads: row.new_leads,
    wins: row.wins,
    wonValue: Number(row.won_value),
  }));
}
