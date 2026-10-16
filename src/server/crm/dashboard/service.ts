/**
 * Dashboard and pipeline use cases.
 *
 * The service validates the request shape (range, filters) and assembles the
 * full dashboard payload. Authorization stays in the repository - every
 * aggregate is row-scoped there - and the action layer checks capability.
 */
import { db as defaultDb } from '@/server/db/client';
import type { Db } from '@/server/db/types';
import { listSources } from '@/server/crm/catalog/repository';
import {
  getConversionFunnel,
  getDashboardOverview,
  getLostReasonBreakdown,
  getPipelineBoard,
  getQuotationOutcomes,
  getSalesRepPerformance,
  getSourceBreakdown,
  getStageDistribution,
  type Actor,
  type DashboardFilters,
  type DashboardOverview,
  type FunnelStep,
  type LostReasonEntry,
  type PipelineBoard,
  type QuotationFunnelStep,
  type QuotationOutcomeCounts,
  type RepPerformanceRow,
  type SourceBreakdownEntry,
  type StageDistributionEntry,
} from './repository';
import { isDashboardRange, type CustomRange, type DashboardRange } from './dates';
import { isOpportunityStage } from '@/server/crm/opportunities/stage';

export type { Actor } from './repository';

function getDb(db?: Db): Db {
  return db ?? defaultDb();
}

export interface DashboardInput {
  range: DashboardRange;
  ownerUserId?: string | null;
  sourceId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/** Normalises the request into repository filters, dropping what is invalid. */
export function toFilters(actor: Actor, input: DashboardInput): DashboardFilters {
  const range: DashboardRange = isDashboardRange(input.range) ? input.range : 'last30';

  // A rep is always scoped to themselves; an explicit owner filter from a
  // manager narrows the whole dashboard. A rep passing someone else's id gets
  // their own scope anyway - the repository ANDs the two and answers nothing
  // but never leaks.
  const ownerUserId =
    actor.role === 'SALES_REP' ? null : input.ownerUserId?.trim() || null;

  const sourceId = input.sourceId?.trim() || null;

  let custom: CustomRange | null = null;
  if (range === 'custom') {
    const startDate = input.startDate?.trim() ?? '';
    const endDate = input.endDate?.trim() ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new Error('INVALID_CUSTOM_RANGE');
    }
    if (startDate > endDate) {
      throw new Error('INVALID_CUSTOM_RANGE');
    }
    custom = { startDate, endDate };
  }

  return { range, ownerUserId, sourceId, custom };
}

export interface DashboardPayload {
  overview: DashboardOverview;
  stageDistribution: StageDistributionEntry[];
  /** Nested conversion funnel: Leads received -> Qualified -> Won. */
  funnel: FunnelStep[];
  /**
   * Quotation conversion over the same cohort, kept out of `funnel` because the
   * domain never requires a quotation before a deal can be won.
   */
  quotationFunnel: QuotationFunnelStep[];
  repPerformance: RepPerformanceRow[];
  lostReasons: LostReasonEntry[];
  sources: SourceBreakdownEntry[];
  quotationOutcomes: QuotationOutcomeCounts;
}

export async function getDashboardUseCase(
  actor: Actor,
  input: DashboardInput,
  db?: Db,
): Promise<DashboardPayload> {
  const database = getDb(db);
  const filters = toFilters(actor, input);

  // Sequential on purpose: the repository functions each run several
  // statements, and a single pg Client (tests, transactions) must not
  // interleave in-flight queries.
  const overview = await getDashboardOverview(database, actor, filters);
  const stageDistribution = await getStageDistribution(database, actor, filters);
  const { funnel, quotationFunnel } = await getConversionFunnel(database, actor, filters);
  const repPerformance = await getSalesRepPerformance(database, actor, filters);
  const lostReasons = await getLostReasonBreakdown(database, actor, filters);
  const sources = await getSourceBreakdown(database, actor, filters);
  const quotationOutcomes = await getQuotationOutcomes(database, actor, filters);

  return {
    overview,
    stageDistribution,
    funnel,
    quotationFunnel,
    repPerformance,
    lostReasons,
    sources,
    quotationOutcomes,
  };
}

export interface PipelineInput {
  ownerUserId?: string | null;
  sourceId?: string | null;
  /** Unknown stages are dropped rather than failing the page. */
  stage?: string | null;
}

export async function getPipelineBoardUseCase(
  actor: Actor,
  input: PipelineInput = {},
  db?: Db,
): Promise<PipelineBoard> {
  const database = getDb(db);
  // Same rules as the dashboard: a rep is always their own scope, and the
  // global source filter reaches the board. Stage is a pipeline concept, so it
  // is accepted here and nowhere else.
  const ownerUserId = actor.role === 'SALES_REP' ? null : input.ownerUserId?.trim() || null;
  const sourceId = input.sourceId?.trim() || null;
  const rawStage = input.stage?.trim() || null;
  const stage = rawStage !== null && isOpportunityStage(rawStage) ? rawStage : null;
  return getPipelineBoard(database, actor, { ownerUserId, sourceId, stage });
}

/** The reference list behind the dashboard's source filter. */
export async function getSourceOptionsUseCase(
  db?: Db,
): Promise<{ id: string; name: string }[]> {
  const database = getDb(db);
  const sources = await listSources(database);
  return sources.map((source) => ({ id: source.id, name: source.name }));
}
