import { requirePermission } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import { notFound } from 'next/navigation';
import {
  getQuotationAction,
  listQuotationSnapshotsAction,
} from '@/server/crm/quotations/actions';
import { QuotationWorkspace } from '../QuotationWorkspace';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.quotations.pageTitle) };
}

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
