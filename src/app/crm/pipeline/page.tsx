import { requirePermission } from '@/server/auth/dal';
import { getPipelineBoardAction, getSourceOptionsAction } from '@/server/crm/dashboard/actions';
import { getOpportunityOwnersAction } from '@/server/crm/opportunities/actions';
import { PipelineBoard } from './PipelineBoard';

export const metadata = { title: 'Pipeline | Dental Hub CRM' };

async function getPipelineData() {
  const session = await requirePermission('opportunities:read');
  const canFilterOwner = session.role === 'ADMIN' || session.role === 'SALES_MANAGER';

  const [board, ownerOptions, sourceOptions] = await Promise.all([
    getPipelineBoardAction(),
    canFilterOwner ? getOpportunityOwnersAction() : Promise.resolve([]),
    getSourceOptionsAction(),
  ]);

  return {
    board,
    ownerOptions,
    sourceOptions,
    canFilterOwner,
    // One timestamp for the whole render, so every overdue flag agrees.
    now: Date.now(),
  };
}

export default async function PipelinePage() {
  const data = await getPipelineData();
  return (
    <PipelineBoard
      initial={data.board}
      ownerOptions={data.ownerOptions}
      sourceOptions={data.sourceOptions}
      canFilterOwner={data.canFilterOwner}
      now={data.now}
    />
  );
}
