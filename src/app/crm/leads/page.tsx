import { requirePermission } from '@/server/auth/dal';
import { listLeadsAction } from '@/server/crm/leads/actions';
import { LeadsList } from './LeadsList';

export const metadata = { title: 'Leads | Dental Hub CRM' };

const VALID_STATUSES = ['NEW', 'CONTACTED', 'DISQUALIFIED'] as const;
type LeadStatus = (typeof VALID_STATUSES)[number];

const VALID_ARCHIVE_FILTERS = ['active', 'archived', 'all'] as const;
type ArchiveFilter = (typeof VALID_ARCHIVE_FILTERS)[number];

async function getLeadsData(searchParams: Promise<{ status?: string; archive?: string; page?: string }>) {
  const params = await searchParams;
  const status = VALID_STATUSES.includes(params.status as LeadStatus) ? (params.status as LeadStatus) : undefined;
  const archiveFilter = VALID_ARCHIVE_FILTERS.includes(params.archive as ArchiveFilter) ? (params.archive as ArchiveFilter) : 'active';
  const page = Math.max(1, Number(params.page) || 1);
  const limit = 25;
  const offset = (page - 1) * limit;

  const session = await requirePermission('leads:read');
  void session;
  const { leads, total } = await listLeadsAction({ status, archiveFilter, limit, offset });

  return { leads, total, page, limit, status, archiveFilter };
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; archive?: string; page?: string }> }) {
  const data = await getLeadsData(searchParams);
  return <LeadsList {...data} />;
}