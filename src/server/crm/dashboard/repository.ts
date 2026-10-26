/**
 * All SQL behind the Pipeline + Management Dashboard.
 *
 * Rules this file lives by:
 *   * every aggregate is row-scope aware - a SALES_REP's counts and totals are
 *     computed over exactly the rows they are allowed to see, so no aggregate
 *     leaks another rep's book;
 *   * money is summed by PostgreSQL in numeric arithmetic and only converted
 *     to a JS number for display, never accumulated in floats;
 *   * joins that could multiply rows use grouped subqueries or LATERAL
 *     LIMIT 1, so entities are never double counted;
 *   * period metrics compare one documented timestamp field against a
 *     half-open [start, end) interval; snapshot metrics ignore the range.
 *     The field each metric reads is listed in ./dates.ts.
 *   * owner and source are GLOBAL scopes: every function here takes both and
 *     applies them to every aggregate it returns, so the KPI cards, the
 *     breakdowns, the funnel, the rep table and the pipeline board can never
 *     disagree about what a filter means. There is deliberately no
 *     dashboard-wide stage filter - stage is scoped on the pipeline board,
 *     where it has an unambiguous meaning.
 *   * the conversion funnel is nested by construction (see getConversionFunnel)
 *     and quotation conversion is reported beside it, never inside it.
 */
import type { Db } from '@/server/db/types';
import { rangeClause, type CustomRange, type DashboardRange } from './dates';
import { OPPORTUNITY_STAGES, type OpportunityStage } from '@/server/crm/opportunities/stage';
import type { LeadStatus } from '@/server/crm/leads/repository';
import type { QuotationStatus } from '@/server/crm/quotations/status';
import type { Role } from '@/server/authz/permissions';
import { ownerScopeSql } from '@/server/crm/scope';

export type Actor = { userId: string; role: Role };

export interface DashboardFilters {
  range: DashboardRange;
  /**
   * Global row scope: narrows EVERY metric below to one owner's book. A rep is
   * always pinned to themselves regardless of what the request asked for.
   */
  ownerUserId?: string | null;
  /**
   * Global commercial scope: narrows EVERY metric below to one lead source -
   * leads, won/lost, stage distribution, funnel, lost reasons, rep performance,
   * quotation outcomes and the pipeline board alike. Source lives only on
   * crm_lead, so opportunity / follow-up / quotation metrics trace it through
   * their lead parent (pushSourceScope).
   */
  sourceId?: string | null;
  custom?: CustomRange | null;
}

// ---------------------------------------------------------------------------
// Scope and filter helpers
// ---------------------------------------------------------------------------

type Param = string;

/**
 * Row scope on an owner column. A rep is pinned to themselves no matter what
 * the request carried, so an impersonating owner filter answers with their own
 * book and never leaks. A team leader is pinned to their team, and their owner
 * filter is ANDed with it - asking for someone outside the team answers
 * nothing. A manager's explicit owner filter narrows the rest.
 */
function pushOwnerScope(
  clauses: string[],
  params: Param[],
  actor: Actor,
  ownerUserId?: string | null,
  ownerExpr = 'l.owner_user_id',
): void {
  const scope = ownerScopeSql(actor, params, [ownerExpr]);
  if (scope) clauses.push(scope);
  if (actor.role === 'SALES_REP') return;
  if (ownerUserId) {
    params.push(ownerUserId);
    clauses.push(`${ownerExpr} = $${params.length}`);
  }
}

/** Source scope for a query that already carries the lead row (`crm_lead l`). */
function pushLeadSourceFilter(clauses: string[], params: Param[], sourceId?: string | null): void {
  if (!sourceId) return;
  params.push(sourceId);
  clauses.push(`l.source_id = $${params.length}`);
}

/**
 * Source scope for any query rooted at an opportunity, follow-up or quotation.
 * Source is a property of the lead, so the filter traces the parent lead id
 * back to crm_lead with an EXISTS predicate instead of a join: it composes with
 * every FROM shape and, unlike a join, can never multiply rows.
 */
function pushSourceScope(
  clauses: string[],
  params: Param[],
  sourceId: string | null | undefined,
  leadIdExpr = 'o.lead_id',
): void {
  if (!sourceId) return;
  params.push(sourceId);
  clauses.push(
    `EXISTS (SELECT 1 FROM crm_lead src_l WHERE src_l.id = ${leadIdExpr}` +
      ` AND src_l.source_id = $${params.length})`,
  );
}

/**
 * The full commercial scope for an opportunity-rooted query: owner row scope
 * plus the source filter traced through the lead. Taking sourceId as a required
 * argument is deliberate - a new caller cannot forget the global source scope.
 */
function pushOpportunityScope(
  clauses: string[],
  params: Param[],
  actor: Actor,
  ownerUserId: string | null | undefined,
  sourceId: string | null | undefined,
): void {
  pushOwnerScope(clauses, params, actor, ownerUserId, 'o.owner_user_id');
  pushSourceScope(clauses, params, sourceId);
}

/** A rep reaches follow-ups on their opportunities, leads, or assigned to them. */
function pushFollowUpScope(
  clauses: string[],
  params: Param[],
  actor: Actor,
  ownerUserId: string | null | undefined,
  sourceId: string | null | undefined,
): void {
  const scope = ownerScopeSql(actor, params, ['f.owner_user_id', 'o.owner_user_id', 'l.owner_user_id']);
  if (scope) clauses.push(scope);
  if (actor.role !== 'SALES_REP' && ownerUserId) {
    params.push(ownerUserId);
    clauses.push(`COALESCE(o.owner_user_id, l.owner_user_id) = $${params.length}`);
  }
  pushSourceScope(clauses, params, sourceId, 'COALESCE(o.lead_id, f.lead_id)');
}

/** `WHERE a AND b AND ...` from a condition list, or '' when empty. */
function where(clauses: string[]): string {
  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
}

function toNumber(value: string | null | undefined): number {
  return Number(value ?? '0');
}

/** Unwraps pg's QueryResult so Promise.all blocks can share one await. */
function rowsOf<T>(promise: Promise<{ rows: T[] }>): Promise<T[]> {
  return promise.then((result) => result.rows);
}

const OPEN_STAGES_SQL = `o.stage NOT IN ('WON', 'LOST')`;
const OPEN_FOLLOWUP_PARENT_SQL = `(
  (f.opportunity_id IS NOT NULL AND ${OPEN_STAGES_SQL})
  OR (f.lead_id IS NOT NULL AND l.status <> 'DISQUALIFIED' AND l.archived_at IS NULL)
)`;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface LeadStatusCount {
  status: LeadStatus;
  count: number;
}

/**
 * KPI cards. Every figure below is narrowed by the same global owner + source
 * scope, so the cards always agree with each other and with the breakdowns.
 */
export interface DashboardOverview {
  /** lead.created_at inside the range. */
  newLeads: number;
  /** Snapshot: current status of non-archived leads. */
  leadsByStatus: LeadStatusCount[];
  /** Snapshot: opportunities whose current stage is open. */
  openOpportunities: number;
  /** Snapshot: sum of estimated_value over open opportunities. */
  pipelineValue: number;
  /** Snapshot: pending follow-ups due before now on open parents. */
  overdueFollowUps: number;
  /** Snapshot: pending follow-ups due later today (Cairo day). */
  dueTodayFollowUps: number;
  /** opportunity.won_at inside the range. */
  wonCount: number;
  wonValue: number;
  /** opportunity.lost_at inside the range. */
  lostCount: number;
  lostValue: number;
  /** quotation.sent_at / accepted_at / rejected_at inside the range. */
  quotationsSent: number;
  quotationsAccepted: number;
  quotationsRejected: number;
}

export interface StageDistributionEntry {
  stage: OpportunityStage;
  count: number;
  value: number;
}

/**
 * One nested step of the main conversion funnel.
 *
 * The three steps are nested BY CONSTRUCTION: `won` counts leads whose single
 * opportunity is in the WON stage, `qualified` counts leads that have an
 * opportunity at all, and `leads` is the period cohort - so
 * won <= qualified <= leads holds for every dataset, not just the expected one.
 * Contacted is deliberately NOT a step: lead status is a mutable, optional
 * annotation (qualification itself rewrites it) and it is neither necessary nor
 * sufficient for any commercial milestone.
 */
export interface FunnelStep {
  key: 'leads' | 'qualified' | 'won';
  count: number;
}

/**
 * Quotation conversion, reported over the SAME period cohort but deliberately
 * OUTSIDE the main funnel: nothing in the domain forces a quotation to be sent
 * before a deal can be won (or a quotation to exist at all), so quoting is not
 * a stage a lead passes through on its way to Won. Nested by construction too:
 * an accepted quotation always went through SENT first.
 */
export interface QuotationFunnelStep {
  key: 'quoted' | 'accepted';
  count: number;
}

/**
 * Per-rep metrics. Every column honours the global source scope, and a
 * manager's owner filter narrows the table to that one person's row.
 */
export interface RepPerformanceRow {
  userId: string;
  displayName: string;
  role: string;
  /** Snapshot: non-archived, non-disqualified leads owned. */
  activeLeads: number;
  /** lead.created_at inside the range. */
  newLeads: number;
  /** Snapshot: open opportunities owned. */
  openOpportunities: number;
  /** Snapshot: sum of estimated_value over open opportunities owned. */
  pipelineValue: number;
  /** Snapshot: pending overdue follow-ups on open parents owned. */
  overdueFollowUps: number;
  /** followup.completed_at inside the range. */
  completedFollowUps: number;
  /** quotation.sent_at inside the range. */
  quotationsSent: number;
  /** opportunity.won_at inside the range. */
  wins: number;
  wonValue: number;
  /** opportunity.lost_at inside the range. */
  losses: number;
}

export interface LostReasonEntry {
  id: string;
  code: string;
  label: string;
  /** opportunity.lost_at inside the range. */
  count: number;
  lostValue: number;
}

export interface SourceBreakdownEntry {
  id: string;
  code: string;
  name: string;
  /** lead.created_at inside the range. */
  leads: number;
  /** opportunity.won_at inside the range, attributed to the lead's source. */
  wins: number;
  wonValue: number;
}

export interface QuotationOutcomeCounts {
  sent: number;
  accepted: number;
  rejected: number;
}

export interface PipelineCard {
  id: string;
  stage: OpportunityStage;
  estimatedValue: number | null;
  contactName: string;
  accountName: string | null;
  ownerName: string;
  nextAction: {
    actionType: string;
    note: string | null;
    dueAt: Date;
  } | null;
  latestQuotation: {
    quoteNumber: string;
    status: QuotationStatus;
  } | null;
  updatedAt: Date;
}

export interface PipelineStageTotal {
  stage: OpportunityStage;
  count: number;
  value: number;
}

export interface PipelineBoard {
  totals: PipelineStageTotal[];
  cards: PipelineCard[];
}

// ---------------------------------------------------------------------------
// Overview (KPI cards)
// ---------------------------------------------------------------------------

export async function getDashboardOverview(
  db: Db,
  actor: Actor,
  filters: DashboardFilters,
): Promise<DashboardOverview> {
  const { range, ownerUserId, sourceId } = filters;
  const custom = filters.custom ?? undefined;

  // Owner + source scope are shared by the two lead queries; each query gets
  // its own params copy so positional numbering stays correct.
  const leadScopeClauses: string[] = [];
  const leadScopeParams: Param[] = [];
  pushOwnerScope(leadScopeClauses, leadScopeParams, actor, ownerUserId);
  pushLeadSourceFilter(leadScopeClauses, leadScopeParams, sourceId);

  const newLeadParams = [...leadScopeParams];
  const leadCreatedInRange = rangeClause('l.created_at', range, newLeadParams, custom);

  const statusParams = [...leadScopeParams];

  const openClauses: string[] = [];
  const openParams: Param[] = [];
  pushOpportunityScope(openClauses, openParams, actor, ownerUserId, sourceId);
  openClauses.push(OPEN_STAGES_SQL);

  const outcomeClauses: string[] = [];
  const outcomeParams: Param[] = [];
  pushOpportunityScope(outcomeClauses, outcomeParams, actor, ownerUserId, sourceId);
  const wonInRange = rangeClause('o.won_at', range, outcomeParams, custom);
  const lostInRange = rangeClause('o.lost_at', range, outcomeParams, custom);

  const followUpClauses: string[] = [];
  const followUpParams: Param[] = [];
  pushFollowUpScope(followUpClauses, followUpParams, actor, ownerUserId, sourceId);
  followUpClauses.push('f.completed_at IS NULL', OPEN_FOLLOWUP_PARENT_SQL);

  const quotationClauses: string[] = [];
  const quotationParams: Param[] = [];
  pushOpportunityScope(quotationClauses, quotationParams, actor, ownerUserId, sourceId);
  const sentInRange = rangeClause('q.sent_at', range, quotationParams, custom);
  const acceptedInRange = rangeClause('q.accepted_at', range, quotationParams, custom);
  const rejectedInRange = rangeClause('q.rejected_at', range, quotationParams, custom);

  // Sequential on purpose: a single pg Client (tests, transactions) must not
  // interleave in-flight queries; a Pool connection is borrowed once and the
  // six aggregate statements are each single-digit milliseconds.
  const newLeadRows = await rowsOf(
    db.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM crm_lead l
        ${where([...leadScopeClauses, leadCreatedInRange])}`,
      newLeadParams,
    ),
  );
  const statusRows = await rowsOf(
    db.query<{ status: LeadStatus; count: string }>(
      `SELECT l.status, count(*)::text AS count
         FROM crm_lead l
        ${where([...leadScopeClauses, 'l.archived_at IS NULL'])}
        GROUP BY l.status`,
      statusParams,
    ),
  );
  const openRows = await rowsOf(
    db.query<{ count: string; value: string }>(
      `SELECT count(*)::text AS count, COALESCE(sum(o.estimated_value), 0)::text AS value
         FROM crm_opportunity o
        ${where(openClauses)}`,
      openParams,
    ),
  );
  const followUpRows = await rowsOf(
    db.query<{ overdue: string; due_today: string }>(
      `SELECT
         count(*) FILTER (WHERE f.due_at < now())::text AS overdue,
         count(*) FILTER (
           WHERE f.due_at >= now()
             AND f.due_at < date_trunc('day', now() + interval '1 day', 'Africa/Cairo')
         )::text AS due_today
       FROM crm_followup f
       LEFT JOIN crm_opportunity o ON o.id = f.opportunity_id
       LEFT JOIN crm_lead l ON l.id = f.lead_id
       ${where(followUpClauses)}`,
      followUpParams,
    ),
  );
  const outcomeRows = await rowsOf(
    db.query<{ won_count: string; won_value: string; lost_count: string; lost_value: string }>(
      `SELECT
         count(*) FILTER (WHERE ${wonInRange})::text AS won_count,
         COALESCE(sum(o.estimated_value) FILTER (WHERE ${wonInRange}), 0)::text AS won_value,
         count(*) FILTER (WHERE ${lostInRange})::text AS lost_count,
         COALESCE(sum(o.estimated_value) FILTER (WHERE ${lostInRange}), 0)::text AS lost_value
       FROM crm_opportunity o
       ${where(outcomeClauses)}`,
      outcomeParams,
    ),
  );
  const quotationRows = await rowsOf(
    db.query<{ sent: string; accepted: string; rejected: string }>(
      `SELECT
         count(*) FILTER (WHERE ${sentInRange})::text AS sent,
         count(*) FILTER (WHERE ${acceptedInRange})::text AS accepted,
         count(*) FILTER (WHERE ${rejectedInRange})::text AS rejected
       FROM crm_quotation q
       JOIN crm_opportunity o ON o.id = q.opportunity_id
       ${where(quotationClauses)}`,
      quotationParams,
    ),
  );

  return {
    newLeads: toNumber(newLeadRows[0]?.count),
    leadsByStatus: (['NEW', 'CONTACTED', 'DISQUALIFIED'] as LeadStatus[]).map((status) => ({
      status,
      count: toNumber(statusRows.find((row) => row.status === status)?.count),
    })),
    openOpportunities: toNumber(openRows[0]?.count),
    pipelineValue: toNumber(openRows[0]?.value),
    overdueFollowUps: toNumber(followUpRows[0]?.overdue),
    dueTodayFollowUps: toNumber(followUpRows[0]?.due_today),
    wonCount: toNumber(outcomeRows[0]?.won_count),
    wonValue: toNumber(outcomeRows[0]?.won_value),
    lostCount: toNumber(outcomeRows[0]?.lost_count),
    lostValue: toNumber(outcomeRows[0]?.lost_value),
    quotationsSent: toNumber(quotationRows[0]?.sent),
    quotationsAccepted: toNumber(quotationRows[0]?.accepted),
    quotationsRejected: toNumber(quotationRows[0]?.rejected),
  };
}

// ---------------------------------------------------------------------------
// Stage distribution (snapshot)
// ---------------------------------------------------------------------------

export async function getStageDistribution(
  db: Db,
  actor: Actor,
  filters: Pick<DashboardFilters, 'ownerUserId' | 'sourceId'>,
): Promise<StageDistributionEntry[]> {
  const clauses: string[] = [];
  const params: Param[] = [];
  pushOpportunityScope(clauses, params, actor, filters.ownerUserId, filters.sourceId);

  const { rows } = await db.query<{ stage: OpportunityStage; count: string; value: string }>(
    `SELECT o.stage, count(*)::text AS count, COALESCE(sum(o.estimated_value), 0)::text AS value
       FROM crm_opportunity o
      ${where(clauses)}
      GROUP BY o.stage`,
    params,
  );

  // Zero-fill every pipeline stage so the UI always shows the whole board.
  return OPPORTUNITY_STAGES.map((stage) => {
    const row = rows.find((entry) => entry.stage === stage);
    return {
      stage,
      count: toNumber(row?.count),
      value: toNumber(row?.value),
    };
  });
}

// ---------------------------------------------------------------------------
// Conversion funnel + quotation conversion (period cohort, snapshot milestones)
// ---------------------------------------------------------------------------

/**
 * One query, one cohort: every figure is counted over the leads created inside
 * the period (the same cohort the New Leads KPI counts), with each milestone
 * read as a snapshot of what happened to those leads.
 *
 * Nesting is structural, not aspirational:
 *   * `crm_opportunity.lead_id` is UNIQUE, so the LEFT JOIN to the opportunity
 *     can never multiply a lead, and `qualified` is exactly `o.id IS NOT NULL`;
 *   * `won` is a subset of `qualified` (WON only exists on a row that exists);
 *   * the quotation figures are read through a LATERAL aggregate over the same
 *     single opportunity, so a lead with five quotations still counts once.
 *
 * The quotation columns are returned separately from the funnel steps on
 * purpose: winning does not require a quotation in this domain, so quoting is
 * not a stage of the nested funnel.
 */
export async function getConversionFunnel(
  db: Db,
  actor: Actor,
  filters: DashboardFilters,
): Promise<{ funnel: FunnelStep[]; quotationFunnel: QuotationFunnelStep[] }> {
  const { range, ownerUserId, sourceId } = filters;
  const custom = filters.custom ?? undefined;

  const clauses: string[] = [];
  const params: Param[] = [];
  pushOwnerScope(clauses, params, actor, ownerUserId);
  pushLeadSourceFilter(clauses, params, sourceId);
  const createdInRange = rangeClause('l.created_at', range, params, custom);
  clauses.push(createdInRange);

  const { rows } = await db.query<{
    leads: string;
    qualified: string;
    won: string;
    quoted: string;
    quoted_accepted: string;
  }>(
    `SELECT
       count(*)::text AS leads,
       count(*) FILTER (WHERE o.id IS NOT NULL)::text AS qualified,
       count(*) FILTER (WHERE o.stage = 'WON')::text AS won,
       count(*) FILTER (WHERE lq.sent_at IS NOT NULL)::text AS quoted,
       count(*) FILTER (WHERE lq.accepted_at IS NOT NULL)::text AS quoted_accepted
     FROM crm_lead l
     LEFT JOIN crm_opportunity o ON o.lead_id = l.id
     LEFT JOIN LATERAL (
       SELECT max(q.sent_at) AS sent_at,
              max(q.accepted_at) AS accepted_at
         FROM crm_quotation q
        WHERE q.opportunity_id = o.id
     ) lq ON true
     ${where(clauses)}`,
    params,
  );

  const row = rows[0];
  return {
    funnel: [
      { key: 'leads', count: toNumber(row?.leads) },
      { key: 'qualified', count: toNumber(row?.qualified) },
      { key: 'won', count: toNumber(row?.won) },
    ],
    quotationFunnel: [
      { key: 'quoted', count: toNumber(row?.quoted) },
      { key: 'accepted', count: toNumber(row?.quoted_accepted) },
    ],
  };
}

// ---------------------------------------------------------------------------
// Sales rep performance
// ---------------------------------------------------------------------------

export async function getSalesRepPerformance(
  db: Db,
  actor: Actor,
  filters: DashboardFilters,
): Promise<RepPerformanceRow[]> {
  const { range, ownerUserId, sourceId } = filters;
  const custom = filters.custom ?? undefined;

  // One params array for the whole statement: the fragments live in different
  // CTEs but share the same $n numbering.
  const params: Param[] = [];
  const leadCreatedInRange = rangeClause('l.created_at', range, params, custom);
  const wonInRange = rangeClause('o.won_at', range, params, custom);
  const lostInRange = rangeClause('o.lost_at', range, params, custom);
  const completedInRange = rangeClause('f.completed_at', range, params, custom);
  const sentInRange = rangeClause('q.sent_at', range, params, custom);

  // Owner scope decides WHICH rows appear: the grouping key of every CTE is the
  // row's own owner, so pinning the outer u.id is enough to narrow the table to
  // one person's book. Source scope is applied inside each CTE because a source
  // belongs to the lead behind the row, not to the row's owner.
  const scopeClauses: string[] = [
    'u.is_active = true',
    `u.role IN ('SALES_REP', 'SALES_TEAM_LEADER', 'SALES_MANAGER')`,
  ];
  const ownerScope = ownerScopeSql(actor, params, ['u.id']);
  if (ownerScope) scopeClauses.push(ownerScope);
  if (actor.role !== 'SALES_REP' && ownerUserId) {
    params.push(ownerUserId);
    scopeClauses.push(`u.id = $${params.length}`);
  }

  const leadClauses: string[] = [];
  pushLeadSourceFilter(leadClauses, params, sourceId);
  const oppClauses: string[] = [];
  pushSourceScope(oppClauses, params, sourceId);
  const followUpClauses: string[] = [];
  pushSourceScope(followUpClauses, params, sourceId, 'COALESCE(o.lead_id, f.lead_id)');
  const quotationClauses: string[] = [];
  pushSourceScope(quotationClauses, params, sourceId);

  const { rows } = await db.query<{
    id: string;
    display_name: string;
    role: string;
    active_leads: string;
    new_leads: string;
    open_opportunities: string;
    pipeline_value: string;
    overdue_followups: string;
    completed_followups: string;
    quotations_sent: string;
    wins: string;
    won_value: string;
    losses: string;
  }>(
    `WITH lead_stats AS (
       SELECT l.owner_user_id AS uid,
              count(*) FILTER (WHERE l.archived_at IS NULL AND l.status <> 'DISQUALIFIED')::text AS active_leads,
              count(*) FILTER (WHERE ${leadCreatedInRange})::text AS new_leads
         FROM crm_lead l
        ${where(leadClauses)}
        GROUP BY l.owner_user_id
     ),
     opp_stats AS (
       SELECT o.owner_user_id AS uid,
              count(*) FILTER (WHERE ${OPEN_STAGES_SQL})::text AS open_opportunities,
              COALESCE(sum(o.estimated_value) FILTER (WHERE ${OPEN_STAGES_SQL}), 0)::text AS pipeline_value,
              count(*) FILTER (WHERE ${wonInRange})::text AS wins,
              COALESCE(sum(o.estimated_value) FILTER (WHERE ${wonInRange}), 0)::text AS won_value,
              count(*) FILTER (WHERE ${lostInRange})::text AS losses
         FROM crm_opportunity o
        ${where(oppClauses)}
        GROUP BY o.owner_user_id
     ),
     followup_stats AS (
       SELECT COALESCE(o.owner_user_id, l.owner_user_id) AS uid,
              count(*) FILTER (
                WHERE f.completed_at IS NULL AND ${OPEN_FOLLOWUP_PARENT_SQL} AND f.due_at < now()
              )::text AS overdue_followups,
              count(*) FILTER (WHERE ${completedInRange})::text AS completed_followups
         FROM crm_followup f
         LEFT JOIN crm_opportunity o ON o.id = f.opportunity_id
         LEFT JOIN crm_lead l ON l.id = f.lead_id
        ${where(followUpClauses)}
        GROUP BY COALESCE(o.owner_user_id, l.owner_user_id)
     ),
     quotation_stats AS (
       SELECT o.owner_user_id AS uid,
              count(*) FILTER (WHERE ${sentInRange})::text AS quotations_sent
         FROM crm_quotation q
         JOIN crm_opportunity o ON o.id = q.opportunity_id
        ${where(quotationClauses)}
        GROUP BY o.owner_user_id
     )
     SELECT u.id, u.display_name, u.role,
            COALESCE(ls.active_leads, '0') AS active_leads,
            COALESCE(ls.new_leads, '0') AS new_leads,
            COALESCE(os.open_opportunities, '0') AS open_opportunities,
            COALESCE(os.pipeline_value, '0') AS pipeline_value,
            COALESCE(fs.overdue_followups, '0') AS overdue_followups,
            COALESCE(fs.completed_followups, '0') AS completed_followups,
            COALESCE(qs.quotations_sent, '0') AS quotations_sent,
            COALESCE(os.wins, '0') AS wins,
            COALESCE(os.won_value, '0') AS won_value,
            COALESCE(os.losses, '0') AS losses
       FROM crm_user u
       LEFT JOIN lead_stats ls ON ls.uid = u.id
       LEFT JOIN opp_stats os ON os.uid = u.id
       LEFT JOIN followup_stats fs ON fs.uid = u.id
       LEFT JOIN quotation_stats qs ON qs.uid = u.id
      ${where(scopeClauses)}
      ORDER BY u.display_name ASC`,
    params,
  );

  return rows.map((row) => ({
    userId: row.id,
    displayName: row.display_name,
    role: row.role,
    activeLeads: toNumber(row.active_leads),
    newLeads: toNumber(row.new_leads),
    openOpportunities: toNumber(row.open_opportunities),
    pipelineValue: toNumber(row.pipeline_value),
    overdueFollowUps: toNumber(row.overdue_followups),
    completedFollowUps: toNumber(row.completed_followups),
    quotationsSent: toNumber(row.quotations_sent),
    wins: toNumber(row.wins),
    wonValue: toNumber(row.won_value),
    losses: toNumber(row.losses),
  }));
}

// ---------------------------------------------------------------------------
// Lost reasons (period)
// ---------------------------------------------------------------------------

export async function getLostReasonBreakdown(
  db: Db,
  actor: Actor,
  filters: Pick<DashboardFilters, 'range' | 'ownerUserId' | 'sourceId' | 'custom'>,
): Promise<LostReasonEntry[]> {
  const clauses: string[] = [];
  const params: Param[] = [];
  pushOpportunityScope(clauses, params, actor, filters.ownerUserId, filters.sourceId);
  const custom = filters.custom ?? undefined;
  const lostInRange = rangeClause('o.lost_at', filters.range, params, custom);
  clauses.push(lostInRange);

  const { rows } = await db.query<{
    id: string;
    code: string;
    label: string;
    lost_count: string;
    lost_value: string;
  }>(
    `SELECT r.id, r.code, r.label,
            count(o.id)::text AS lost_count,
            COALESCE(sum(o.estimated_value), 0)::text AS lost_value
       FROM crm_opportunity o
       JOIN crm_outcome_reason r ON r.id = o.lost_reason_id
      ${where(clauses)}
      GROUP BY r.id, r.code, r.label
      ORDER BY lost_count DESC, r.label ASC`,
    params,
  );

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    count: toNumber(row.lost_count),
    lostValue: toNumber(row.lost_value),
  }));
}

// ---------------------------------------------------------------------------
// Source breakdown (period)
// ---------------------------------------------------------------------------
/**
 * Per-source leads and wins. The global source filter applies here too, so with
 * one source selected the breakdown answers with that single row - the panel
 * then proves the filter instead of contradicting it.
 */
export async function getSourceBreakdown(
  db: Db,
  actor: Actor,
  filters: Pick<DashboardFilters, 'range' | 'ownerUserId' | 'sourceId' | 'custom'>,
): Promise<SourceBreakdownEntry[]> {
  const clauses: string[] = [];
  const params: Param[] = [];
  pushOwnerScope(clauses, params, actor, filters.ownerUserId);
  pushLeadSourceFilter(clauses, params, filters.sourceId);
  const custom = filters.custom ?? undefined;
  const createdInRange = rangeClause('l.created_at', filters.range, params, custom);
  const wonInRange = rangeClause('o.won_at', filters.range, params, custom);
  clauses.push(createdInRange);

  const { rows } = await db.query<{
    id: string;
    code: string;
    name: string;
    leads: string;
    wins: string;
    won_value: string;
  }>(
    `SELECT s.id, s.code, s.name,
            count(*)::text AS leads,
            count(o.id) FILTER (WHERE ${wonInRange})::text AS wins,
            COALESCE(sum(o.estimated_value) FILTER (WHERE ${wonInRange}), 0)::text AS won_value
       FROM crm_lead l
       JOIN crm_source s ON s.id = l.source_id
       LEFT JOIN crm_opportunity o ON o.lead_id = l.id
      ${where(clauses)}
      GROUP BY s.id, s.code, s.name
      ORDER BY leads DESC, s.name ASC`,
    params,
  );

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    leads: toNumber(row.leads),
    wins: toNumber(row.wins),
    wonValue: toNumber(row.won_value),
  }));
}

// ---------------------------------------------------------------------------
// Quotation outcomes (period)
// ---------------------------------------------------------------------------

export async function getQuotationOutcomes(
  db: Db,
  actor: Actor,
  filters: Pick<DashboardFilters, 'range' | 'ownerUserId' | 'sourceId' | 'custom'>,
): Promise<QuotationOutcomeCounts> {
  const clauses: string[] = [];
  const params: Param[] = [];
  pushOpportunityScope(clauses, params, actor, filters.ownerUserId, filters.sourceId);
  const custom = filters.custom ?? undefined;
  const sentInRange = rangeClause('q.sent_at', filters.range, params, custom);
  const acceptedInRange = rangeClause('q.accepted_at', filters.range, params, custom);
  const rejectedInRange = rangeClause('q.rejected_at', filters.range, params, custom);
  const and = clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '';

  const { rows } = await db.query<{ sent: string; accepted: string; rejected: string }>(
    `SELECT
       count(*) FILTER (WHERE ${sentInRange})::text AS sent,
       count(*) FILTER (WHERE ${acceptedInRange})::text AS accepted,
       count(*) FILTER (WHERE ${rejectedInRange})::text AS rejected
     FROM crm_quotation q
     JOIN crm_opportunity o ON o.id = q.opportunity_id
     WHERE true ${and}`,
    params,
  );

  return {
    sent: toNumber(rows[0]?.sent),
    accepted: toNumber(rows[0]?.accepted),
    rejected: toNumber(rows[0]?.rejected),
  };
}

// ---------------------------------------------------------------------------
// Pipeline board (snapshot)
// ---------------------------------------------------------------------------

export interface PipelineFilters {
  /** Managers/admins may narrow to one owner; a rep is always their own scope. */
  ownerUserId?: string | null;
  /** Same global source scope as every dashboard metric. */
  sourceId?: string | null;
  /**
   * Narrows the board to one stage, applied to the cards AND the per-stage
   * totals so the two can never disagree. Stage filtering lives here and only
   * here: a dashboard-wide stage filter would mean different things for leads,
   * quotations and period outcomes, so it was removed from DashboardFilters.
   */
  stage?: string | null;
}

export async function getPipelineBoard(
  db: Db,
  actor: Actor,
  filters: PipelineFilters = {},
): Promise<PipelineBoard> {
  const clauses: string[] = [];
  const params: Param[] = [];
  pushOpportunityScope(clauses, params, actor, filters.ownerUserId, filters.sourceId);
  if (filters.stage) {
    params.push(filters.stage);
    clauses.push(`o.stage = $${params.length}`);
  }
  const and = clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '';

  const totalRows = await rowsOf(
    db.query<{ stage: OpportunityStage; count: string; value: string }>(
      `SELECT o.stage, count(*)::text AS count, COALESCE(sum(o.estimated_value), 0)::text AS value
         FROM crm_opportunity o
        WHERE true ${and}
        GROUP BY o.stage`,
      params,
    ),
  );
  const cardRows = await rowsOf(
    db.query<{
      id: string;
      stage: OpportunityStage;
      estimated_value: string | null;
      contact_name: string;
      account_name: string | null;
      owner_name: string;
      next_action_type: string | null;
      next_action_note: string | null;
      next_action_due_at: Date | null;
      latest_quote_number: string | null;
      latest_quote_status: QuotationStatus | null;
      updated_at: Date;
    }>(
      `SELECT ranked.id, ranked.stage, ranked.estimated_value, ranked.contact_name,
              ranked.account_name, ranked.owner_name, ranked.next_action_type,
              ranked.next_action_note, ranked.next_action_due_at,
              ranked.latest_quote_number, ranked.latest_quote_status, ranked.updated_at
         FROM (
           SELECT o.id, o.stage, o.estimated_value,
                  c.full_name AS contact_name,
                  a.name AS account_name,
                  u.display_name AS owner_name,
                  f.action_type AS next_action_type,
                  f.note AS next_action_note,
                  f.due_at AS next_action_due_at,
                  q.quote_number AS latest_quote_number,
                  q.status AS latest_quote_status,
                  o.updated_at,
                  row_number() OVER (PARTITION BY o.stage ORDER BY o.updated_at DESC) AS rn
             FROM crm_opportunity o
             JOIN crm_user u ON u.id = o.owner_user_id
             JOIN crm_contact c ON c.id = o.contact_id
             LEFT JOIN crm_account a ON a.id = o.account_id
             LEFT JOIN LATERAL (
               SELECT id, action_type, note, due_at
                 FROM crm_followup
                WHERE opportunity_id = o.id AND completed_at IS NULL
                ORDER BY due_at ASC, created_at ASC
                LIMIT 1
             ) f ON true
             LEFT JOIN LATERAL (
               SELECT quote_number, status
                 FROM crm_quotation
                WHERE opportunity_id = o.id
                ORDER BY created_at DESC, id DESC
                LIMIT 1
             ) q ON true
            WHERE true ${and}
         ) ranked
        WHERE ranked.rn <= 100`,
      params,
    ),
  );

  return {
    totals: OPPORTUNITY_STAGES.map((stage) => {
      const row = totalRows.find((entry) => entry.stage === stage);
      return { stage, count: toNumber(row?.count), value: toNumber(row?.value) };
    }),
    cards: cardRows.map((row) => ({
      id: row.id,
      stage: row.stage,
      estimatedValue: row.estimated_value === null ? null : Number(row.estimated_value),
      contactName: row.contact_name,
      accountName: row.account_name,
      ownerName: row.owner_name,
      nextAction:
        row.next_action_due_at === null
          ? null
          : {
              actionType: row.next_action_type ?? 'OTHER',
              note: row.next_action_note,
              dueAt: row.next_action_due_at,
            },
      latestQuotation:
        row.latest_quote_number === null || row.latest_quote_status === null
          ? null
          : { quoteNumber: row.latest_quote_number, status: row.latest_quote_status },
      updatedAt: row.updated_at,
    })),
  };
}
