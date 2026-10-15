import { requirePermission } from '@/server/auth/dal';
import { notFound } from 'next/navigation';
import {
  getOpportunityDetailAction,
  listOpportunityFollowUpsAction,
  getLostReasonsAction,
  getOpportunityOwnersAction,
  getOpportunityStageHistoryAction,
  getOpportunityActivityAction,
} from '@/server/crm/opportunities/actions';
import { allowedTransitions } from '@/server/crm/opportunities/stage';
import { OpportunityDetail } from './OpportunityDetail';

export const metadata = { title: 'Opportunity | Dental Hub CRM' };

interface OpportunityPageProps {
  params: Promise<{ id: string }>;
}

async function getOpportunityData(id: string) {
  const session = await requirePermission('opportunities:read');

  const opportunity = await getOpportunityDetailAction(id);
  // An opportunity the actor may not see resolves to null, so an unauthorised id
  // 404s exactly like a non-existent one. No existence leak.
  if (!opportunity) notFound();

  const canAssignOwner = session.role === 'ADMIN' || session.role === 'SALES_MANAGER';

  const [followUps, lostReasons, owners, stageHistory, activity] = await Promise.all([
    listOpportunityFollowUpsAction(id),
    getLostReasonsAction(),
    canAssignOwner ? getOpportunityOwnersAction() : Promise.resolve([]),
    getOpportunityStageHistoryAction(id),
    getOpportunityActivityAction(id),
  ]);

  return {
    opportunity,
    followUps,
    lostReasons,
    owners,
    stageHistory,
    activity,
    canAssignOwner,
    userRole: session.role,
    userId: session.user.id,
    allowedStages: allowedTransitions(opportunity.stage),
    // One timestamp for the whole render, so every overdue flag agrees.
    now: Date.now(),
  };
}

export default async function OpportunityPage({ params }: OpportunityPageProps) {
  const { id } = await params;
  const data = await getOpportunityData(id);
  return <OpportunityDetail {...data} />;
}
