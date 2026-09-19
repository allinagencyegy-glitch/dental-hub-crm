import { requirePermission } from '@/server/auth/dal';
import { getLeadDetailAction, getDisqualifyReasonsAction } from '@/server/crm/leads/actions';
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

  return { lead, disqualifyReasons, userRole: session.role, userId: session.user.id };
}

export default async function LeadDetailRoute({ params }: LeadDetailPageProps) {
  const data = await getLeadData(params);
  return <LeadDetailPage {...data} />;
}