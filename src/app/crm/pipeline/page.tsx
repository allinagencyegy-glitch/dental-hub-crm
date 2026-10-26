import { requirePermission } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import { getPipelineBoardAction, getSourceOptionsAction } from '@/server/crm/dashboard/actions';
import { getOpportunityOwnersAction } from '@/server/crm/opportunities/actions';
import { PipelineBoard } from './PipelineBoard';
import { canAssignOwner } from '@/server/authz/permissions';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.pipeline.pageTitle) };
}

async function getPipelineData() {
  const session = await requirePermission('opportunities:read');
  const canFilterOwner = canAssignOwner(session.role);

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
