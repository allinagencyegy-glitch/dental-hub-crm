import { requirePermission } from '@/server/auth/dal';
import { notFound } from 'next/navigation';
import {
  getQuotationAction,
  listQuotationSnapshotsAction,
} from '@/server/crm/quotations/actions';
import { QuotationWorkspace } from '../QuotationWorkspace';

export const metadata = { title: 'Quotation | Dental Hub CRM' };

interface QuotationPageProps {
  params: Promise<{ id: string }>;
}

export default async function QuotationPage({ params }: QuotationPageProps) {
  await requirePermission('quotations:read');
  const { id } = await params;

  const [quotation, snapshots] = await Promise.all([
    getQuotationAction(id),
    listQuotationSnapshotsAction(id),
  ]);

  // Out of scope and missing resolve the same way: no existence leak.
  if (!quotation) notFound();

  return <QuotationWorkspace quotation={quotation} opportunity={null} snapshots={snapshots} />;
}
