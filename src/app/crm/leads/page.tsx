import { requirePermission } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import { listLeadsAction } from '@/server/crm/leads/actions';
import { LeadsList } from './LeadsList';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.leads.list.pageTitle) };
}

const VALID_STATUSES = ['NEW', 'CONTACTED', 'DISQUALIFIED'] as const;
type LeadStatus = (typeof VALID_STATUSES)[number];

const VALID_ARCHIVE_FILTERS = ['active', 'archived', 'all'] as const;
type ArchiveFilter = (typeof VALID_ARCHIVE_FILTERS)[number];

async function getLeadsData(searchParams: Promise<{ status?: string; archive?: string; q?: string; page?: string }>) {
  const params = await searchParams;
  const status = VALID_STATUSES.includes(params.status as LeadStatus) ? (params.status as LeadStatus) : undefined;
  const archiveFilter = VALID_ARCHIVE_FILTERS.includes(params.archive as ArchiveFilter) ? (params.archive as ArchiveFilter) : 'active';
  const search = (params.q ?? '').trim().slice(0, 200);
  const page = Math.max(1, Number(params.page) || 1);
  const limit = 25;
  const offset = (page - 1) * limit;

  const session = await requirePermission('leads:read');
  void session;
  const { leads, total, counts } = await listLeadsAction({ status, archiveFilter, search, limit, offset });

  return { leads, total, counts, page, limit, status, archiveFilter, search };
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; archive?: string; q?: string; page?: string }> }) {
  const data = await getLeadsData(searchParams);
  return <LeadsList {...data} />;
}