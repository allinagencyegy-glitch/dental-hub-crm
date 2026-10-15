import { requirePermission } from '@/server/auth/dal';
import { notFound } from 'next/navigation';
import { getOpportunityDetailAction } from '@/server/crm/opportunities/actions';
import { QuotationWorkspace } from '../QuotationWorkspace';

export const metadata = { title: 'New quotation | Dental Hub CRM' };

interface NewQuotationPageProps {
  searchParams: Promise<{ opportunity?: string }>;
}

export default async function NewQuotationPage({ searchParams }: NewQuotationPageProps) {
  await requirePermission('quotations:write');
  const { opportunity: opportunityId } = await searchParams;

  const opportunity = opportunityId ? await getOpportunityDetailAction(opportunityId) : null;
  // Out of scope and missing resolve the same way: no existence leak.
  if (!opportunity) notFound();

  return <QuotationWorkspace quotation={null} opportunity={opportunity} snapshots={[]} />;
}
