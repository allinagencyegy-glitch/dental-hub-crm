import { requirePermission } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import { getLeadDetailAction, getLeadCaptureCatalogAction, getAssignableOwnersAction } from '@/server/crm/leads/actions';
import { LeadEditForm } from './LeadEditForm';
import { notFound } from 'next/navigation';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.leads.edit.pageTitle) };
}

interface EditLeadPageProps {
  params: Promise<{ id: string }>;
}

async function getEditData(params: Promise<{ id: string }>) {
  const { id } = await params;
  const session = await requirePermission('leads:write');

  const lead = await getLeadDetailAction(id);
  if (!lead) {
    notFound();
  }

  const [catalog, assignableOwners] = await Promise.all([
    getLeadCaptureCatalogAction(),
    getAssignableOwnersAction(),
  ]);

  return {
    lead,
    catalog,
    assignableOwners,
    userRole: session.role,
    userId: session.user.id,
  };
}

export default async function EditLeadPage({ params }: EditLeadPageProps) {
  const data = await getEditData(params);
  return <LeadEditForm {...data} />;
}