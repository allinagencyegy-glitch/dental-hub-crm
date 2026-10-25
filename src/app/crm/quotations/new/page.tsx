import { requirePermission } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import { notFound } from 'next/navigation';
import { getOpportunityDetailAction } from '@/server/crm/opportunities/actions';
import { listQuotableProductsAction } from '@/server/crm/catalog/actions';
import { QuotationWorkspace } from '../QuotationWorkspace';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.quotations.newPageTitle) };
}

interface NewQuotationPageProps {
  searchParams: Promise<{ opportunity?: string }>;
}

export default async function NewQuotationPage({ searchParams }: NewQuotationPageProps) {
  await requirePermission('quotations:write');
  const { opportunity: opportunityId } = await searchParams;

  const [opportunity, products] = await Promise.all([
    opportunityId ? getOpportunityDetailAction(opportunityId) : null,
    listQuotableProductsAction(),
  ]);
  // Out of scope and missing resolve the same way: no existence leak.
  if (!opportunity) notFound();

  return <QuotationWorkspace quotation={null} opportunity={opportunity} snapshots={[]} products={products} />;
}
