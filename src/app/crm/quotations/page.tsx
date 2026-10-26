import { requirePermission } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import { listQuotationIndexAction } from '@/server/crm/quotations/actions';
import { getOpportunityOwnersAction } from '@/server/crm/opportunities/actions';
import { isQuotationStatus } from '@/server/crm/quotations/status';
import { canAssignOwner } from '@/server/authz/permissions';
import { QuotationsList } from './QuotationsList';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.quotations.list.pageTitle) };
}

type QuotationsSearchParams = { status?: string; owner?: string; q?: string; page?: string };

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<QuotationsSearchParams>;
}) {
  const params = await searchParams;
  const session = await requirePermission('quotations:read');

  const status = isQuotationStatus(params.status) ? params.status : undefined;
  const search = (params.q ?? '').trim().slice(0, 200);
  const page = Math.max(1, Number(params.page) || 1);
  const limit = 25;

  // A manager or admin may narrow the list to any rep, a team leader to one on
  // their team; a rep always sees their own book.
  const mayAssignOwner = canAssignOwner(session.role);
  const ownerUserId = mayAssignOwner && params.owner ? params.owner : undefined;

  const [{ quotations, total, counts }, owners] = await Promise.all([
    listQuotationIndexAction({ status, ownerUserId, search, limit, offset: (page - 1) * limit }),
    mayAssignOwner ? getOpportunityOwnersAction() : Promise.resolve([]),
  ]);

  return (
    <QuotationsList
      quotations={quotations}
      total={total}
      counts={counts}
      page={page}
      limit={limit}
      status={status ?? 'ALL'}
      search={search}
      owners={owners}
      canAssignOwner={mayAssignOwner}
    />
  );
}
