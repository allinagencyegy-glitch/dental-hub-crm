import { requirePermission } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import {
  getDashboardAction,
  getSourceOptionsAction,
} from '@/server/crm/dashboard/actions';
import { getOpportunityOwnersAction } from '@/server/crm/opportunities/actions';
import { DashboardHome } from './DashboardHome';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.dashboard.pageTitle) };
}

export default async function CrmHomePage() {
  const session = await requirePermission('dashboard:read');

  const isManager = session.role === 'ADMIN' || session.role === 'SALES_MANAGER';

  const [payload, sourceOptions, ownerOptions] = await Promise.all([
    getDashboardAction({ range: 'last30' }),
    getSourceOptionsAction(),
    isManager ? getOpportunityOwnersAction() : Promise.resolve([]),
  ]);

  return (
    <DashboardHome
      initial={payload}
      ownerOptions={ownerOptions}
      sourceOptions={sourceOptions}
      userRole={session.role}
      initialRange="last30"
      initialOwner=""
      initialSource=""
    />
  );
}
