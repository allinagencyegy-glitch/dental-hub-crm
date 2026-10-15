import { requirePermission } from '@/server/auth/dal';
import { getLeadDetailAction, getDisqualifyReasonsAction } from '@/server/crm/leads/actions';
import { getOpportunityByLeadAction } from '@/server/crm/opportunities/actions';
import { listAccountsAction } from '@/server/crm/accounts/actions';
import { LeadDetailPage } from './LeadDetailPage';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Lead Detail | Dental Hub CRM' };

interface LeadDetailPageProps {
  params: Promise<{ id: string }>;
}

async function getLeadData(params: Promise<{ id: string }>) {
  const { id } = await params;
  const session = await requirePermission('leads:read');

  const lead = await getLeadDetailAction(id);
  if (!lead) {
    notFound();
  }

  const disqualifyReasons = await getDisqualifyReasonsAction();

  // Already qualified? The lead page links straight to the deal instead of
  // offering a second conversion, which crm_opportunity.lead_id would refuse.
  const opportunity = await getOpportunityByLeadAction(id);

  // Clinics available for the link/create workflow. Anyone who can read this
  // lead may see the shared clinic list.
  const accounts = await listAccountsAction({ limit: 100 });

  return {
    lead,
    disqualifyReasons,
    accounts,
    userRole: session.role,
    userId: session.user.id,
    opportunityId: opportunity?.id ?? null,
    qualifiedAt: opportunity?.createdAt ?? null,
  };
}

export default async function LeadDetailRoute({ params }: LeadDetailPageProps) {
  const data = await getLeadData(params);
  return <LeadDetailPage {...data} />;
}
