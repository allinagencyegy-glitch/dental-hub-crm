import { requirePermission } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import { listCustomersAction } from '@/server/crm/customers/actions';
import { getOpportunityOwnersAction } from '@/server/crm/opportunities/actions';
import { canAssignOwner } from '@/server/authz/permissions';
import { CustomersList } from './CustomersList';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.customers.list.pageTitle) };
}

type CustomersSearchParams = { owner?: string; q?: string; page?: string };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<CustomersSearchParams>;
}) {
  const params = await searchParams;
  const session = await requirePermission('opportunities:read');

  const search = (params.q ?? '').trim().slice(0, 200);
  const page = Math.max(1, Number(params.page) || 1);
  const limit = 25;

  // A manager or admin may narrow the list to any rep, a team leader to one on
  // their team; a rep always sees their own customers.
  const mayAssignOwner = canAssignOwner(session.role);
  const ownerUserId = mayAssignOwner && params.owner ? params.owner : undefined;

  const [{ customers, summary }, owners] = await Promise.all([
    listCustomersAction({ ownerUserId, search, limit, offset: (page - 1) * limit }),
    mayAssignOwner ? getOpportunityOwnersAction() : Promise.resolve([]),
  ]);

  return (
    <CustomersList
      customers={customers}
      summary={summary}
      page={page}
      limit={limit}
      search={search}
      owners={owners}
      canAssignOwner={mayAssignOwner}
    />
  );
}
