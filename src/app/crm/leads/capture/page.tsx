import { requirePermission } from '@/server/auth/dal';
import { getLeadCaptureCatalogAction } from '@/server/crm/leads/actions';
import { LeadCaptureForm } from './LeadCaptureForm';

export const metadata = { title: 'Capture Lead | Dental Hub CRM' };

async function getCatalogData() {
  const session = await requirePermission('leads:write');
  const catalog = await getLeadCaptureCatalogAction();
  return { ...catalog, userRole: session.role };
}

export default async function CaptureLeadPage() {
  const data = await getCatalogData();
  return <LeadCaptureForm {...data} />;
}