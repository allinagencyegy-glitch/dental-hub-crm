import { requirePermission } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import { getLeadCaptureCatalogAction } from '@/server/crm/leads/actions';
import { LeadCaptureForm } from './LeadCaptureForm';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.leads.capture.pageTitle) };
}

async function getCatalogData() {
  const session = await requirePermission('leads:write');
  const catalog = await getLeadCaptureCatalogAction();
  return { ...catalog, userRole: session.role };
}

export default async function CaptureLeadPage() {
  const data = await getCatalogData();
  return <LeadCaptureForm {...data} />;
}