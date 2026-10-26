import { requirePermission } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import {
  getDashboardAction,
  getSourceOptionsAction,
} from '@/server/crm/dashboard/actions';
import { getOpportunityOwnersAction } from '@/server/crm/opportunities/actions';
import { DashboardHome } from './DashboardHome';
import { canAssignOwner } from '@/server/authz/permissions';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.dashboard.pageTitle) };
}

export default async function CrmHomePage() {
  const session = await requirePermission('dashboard:read');

  // A manager filters by anyone, a team leader by someone on their team.
  const isManager = canAssignOwner(session.role);

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
