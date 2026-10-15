import { requirePermission } from '@/server/auth/dal';
import {
  listOpportunitiesAction,
  getPipelineCountsAction,
  getOpportunityOwnersAction,
} from '@/server/crm/opportunities/actions';
import { OPPORTUNITY_STAGES } from '@/server/crm/opportunities/stage';
import type { OpportunityStageFilter } from '@/server/crm/opportunities/repository';
import { OpportunitiesList } from './OpportunitiesList';

export const metadata = { title: 'Opportunities | Dental Hub CRM' };

const VALID_STAGE_FILTERS = ['OPEN', 'ALL', 'WON', 'LOST', ...OPPORTUNITY_STAGES] as const;
type StageFilter = (typeof VALID_STAGE_FILTERS)[number];

async function getOpportunitiesData(
  searchParams: Promise<{ stage?: string; owner?: string; q?: string; page?: string }>,
) {
  const params = await searchParams;
  const stage: OpportunityStageFilter = VALID_STAGE_FILTERS.includes(
    params.stage as StageFilter,
  )
    ? (params.stage as StageFilter)
    : 'OPEN';
  const search = (params.q ?? '').trim().slice(0, 200);
  const page = Math.max(1, Number(params.page) || 1);
  const limit = 25;
  const offset = (page - 1) * limit;

  const session = await requirePermission('opportunities:read');

  // Only a manager or admin may narrow the view to another rep, so the owner
  // filter is offered to them alone. A rep always sees their own book.
  const canAssignOwner = session.role === 'ADMIN' || session.role === 'SALES_MANAGER';
  const ownerUserId = canAssignOwner && params.owner ? params.owner : undefined;

  const [{ opportunities, total }, counts, owners] = await Promise.all([
    listOpportunitiesAction({ stage, ownerUserId, search, limit, offset }),
    getPipelineCountsAction(),
    canAssignOwner ? getOpportunityOwnersAction() : Promise.resolve([]),
  ]);

  return {
    opportunities,
    total,
    page,
    limit,
    stage,
    search,
    counts,
    owners,
    canAssignOwner,
    currentUserId: session.user.id,
  };
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; owner?: string; q?: string; page?: string }>;
}) {
  const data = await getOpportunitiesData(searchParams);
  return <OpportunitiesList {...data} />;
}
