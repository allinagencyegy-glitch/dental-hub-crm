/**
 * The team page: what is on each person's plate right now.
 *
 * Unlike the reports, which look back over a period, this is a snapshot taken
 * at `now`:
 *
 *   waiting leads      NEW, not archived, not converted      (lead owner)
 *   open leads         NEW or CONTACTED, same conditions     (lead owner)
 *   open deals         opportunity not WON or LOST           (opportunity owner)
 *   overdue            pending follow-up due before now      (follow-up assignee)
 *   due today          pending, due from now to Cairo midnight
 *   calls today        follow-ups completed since Cairo midnight
 *   this month         wins since the 1st, Cairo time        (opportunity owner)
 *
 * A follow-up counts only while its lead or deal is still open, as on the
 * dashboard. A won deal is worth its accepted quotation, else its estimate.
 *
 * Row scope: a rep sees their own row, a team leader their team, a manager or
 * admin every active person who sells (see crm/scope.ts).
 */
import type { Db } from '@/server/db/types';
import type { Role } from '@/server/authz/permissions';
import { ownerScopeSql, type Actor } from '@/server/crm/scope';
import { resolveReportPeriod } from '@/server/crm/reports/period';

export interface TeamMember {
  userId: string;
  displayName: string;
  role: Role;
  /** The leader whose team this is: the person's own id for a team leader, null outside any team. */
  teamLeaderId: string | null;
  teamName: string | null;
  lastSignInAt: Date | null;
  lastCallAt: Date | null;
  waitingLeads: number;
  /** When the longest-waiting new lead came in. */
  oldestWaitingAt: Date | null;
  openLeads: number;
  openDeals: number;
  pipelineValue: number;
  overdue: number;
  dueToday: number;
  callsToday: number;
  monthWins: number;
  monthWonValue: number;
}

export interface TeamBoard {
  /** Cairo calendar dates: today and the first of this month. */
  today: string;
  monthStart: string;
  members: TeamMember[];
}

const OPEN_LEAD = `l.status IN ('NEW', 'CONTACTED') AND l.archived_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM crm_opportunity c WHERE c.lead_id = l.id)`;

const OPEN_STAGE = `o.stage NOT IN ('WON', 'LOST')`;

const PENDING_ON_OPEN_PARENT = `f.completed_at IS NULL AND (
  (f.opportunity_id IS NOT NULL AND EXISTS (
     SELECT 1 FROM crm_opportunity o WHERE o.id = f.opportunity_id AND ${OPEN_STAGE}))
  OR (f.lead_id IS NOT NULL AND EXISTS (
     SELECT 1 FROM crm_lead l WHERE l.id = f.lead_id AND l.status <> 'DISQUALIFIED' AND l.archived_at IS NULL))
)`;

const WON_VALUE = `COALESCE(
  (SELECT q.total_amount FROM crm_quotation q WHERE q.opportunity_id = o.id AND q.status = 'ACCEPTED'),
  o.estimated_value, 0)`;

/** Cairo midnight at the start of the date in `param`, and the one after it. */
const startOf = (param: string) => `(${param}::date::timestamp AT TIME ZONE 'Africa/Cairo')`;
const endOf = (param: string) => `((${param}::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo')`;

export async function getTeamBoard(db: Db, actor: Actor, now: Date = new Date()): Promise<TeamBoard> {
  const { startDate: monthStart, endDate: today } = resolveReportPeriod('thisMonth', now);
  // $1 now, $2 today, $3 the first of the month.
  const params: unknown[] = [now, today, monthStart];
  const scope = ownerScopeSql(actor, params, ['u.id']);

  const { rows } = await db.query<{
    id: string;
    display_name: string;
    role: Role;
    team_leader_id: string | null;
    team_name: string | null;
    last_sign_in_at: Date | null;
    last_call_at: Date | null;
    waiting_leads: number;
    oldest_waiting_at: Date | null;
    open_leads: number;
    open_deals: number;
    pipeline_value: string;
    overdue: number;
    due_today: number;
    calls_today: number;
    month_wins: number;
    month_won_value: string;
  }>(
    `SELECT u.id, u.display_name, u.role,
            CASE WHEN u.role = 'SALES_TEAM_LEADER' THEN u.id ELSE leader.id END AS team_leader_id,
            CASE WHEN u.role = 'SALES_TEAM_LEADER' THEN u.display_name ELSE leader.display_name END AS team_name,
            (SELECT max(s.created_at) FROM crm_session s WHERE s.user_id = u.id) AS last_sign_in_at,
            (SELECT max(f.completed_at) FROM crm_followup f WHERE f.owner_user_id = u.id) AS last_call_at,
            (SELECT count(*)::int FROM crm_lead l
              WHERE l.owner_user_id = u.id AND l.status = 'NEW' AND ${OPEN_LEAD}) AS waiting_leads,
            (SELECT min(l.received_at) FROM crm_lead l
              WHERE l.owner_user_id = u.id AND l.status = 'NEW' AND ${OPEN_LEAD}) AS oldest_waiting_at,
            (SELECT count(*)::int FROM crm_lead l WHERE l.owner_user_id = u.id AND ${OPEN_LEAD}) AS open_leads,
            (SELECT count(*)::int FROM crm_opportunity o WHERE o.owner_user_id = u.id AND ${OPEN_STAGE}) AS open_deals,
            (SELECT COALESCE(sum(o.estimated_value), 0)::text FROM crm_opportunity o
              WHERE o.owner_user_id = u.id AND ${OPEN_STAGE}) AS pipeline_value,
            (SELECT count(*)::int FROM crm_followup f
              WHERE f.owner_user_id = u.id AND ${PENDING_ON_OPEN_PARENT} AND f.due_at < $1) AS overdue,
            (SELECT count(*)::int FROM crm_followup f
              WHERE f.owner_user_id = u.id AND ${PENDING_ON_OPEN_PARENT}
                AND f.due_at >= $1 AND f.due_at < ${endOf('$2')}) AS due_today,
            (SELECT count(*)::int FROM crm_followup f
              WHERE f.owner_user_id = u.id AND f.completed_at >= ${startOf('$2')} AND f.completed_at <= $1) AS calls_today,
            (SELECT count(*)::int FROM crm_opportunity o
              WHERE o.owner_user_id = u.id AND o.stage = 'WON'
                AND o.won_at >= ${startOf('$3')} AND o.won_at <= $1) AS month_wins,
            (SELECT COALESCE(sum(${WON_VALUE}), 0)::text FROM crm_opportunity o
              WHERE o.owner_user_id = u.id AND o.stage = 'WON'
                AND o.won_at >= ${startOf('$3')} AND o.won_at <= $1) AS month_won_value
       FROM crm_user u
       LEFT JOIN crm_user leader ON leader.id = u.team_leader_id
      WHERE u.is_active
        AND u.role IN ('SALES_MANAGER', 'SALES_TEAM_LEADER', 'SALES_REP')
        ${scope ? `AND ${scope}` : ''}
      ORDER BY team_name ASC NULLS LAST, (u.role = 'SALES_TEAM_LEADER') DESC, u.display_name ASC`,
    params,
  );

  return {
    today,
    monthStart,
    members: rows.map((row) => ({
      userId: row.id,
      displayName: row.display_name,
      role: row.role,
      teamLeaderId: row.team_leader_id,
      teamName: row.team_name,
      lastSignInAt: row.last_sign_in_at,
      lastCallAt: row.last_call_at,
      waitingLeads: row.waiting_leads,
      oldestWaitingAt: row.oldest_waiting_at,
      openLeads: row.open_leads,
      openDeals: row.open_deals,
      pipelineValue: Number(row.pipeline_value),
      overdue: row.overdue,
      dueToday: row.due_today,
      callsToday: row.calls_today,
      monthWins: row.month_wins,
      monthWonValue: Number(row.month_won_value),
    })),
  };
}
