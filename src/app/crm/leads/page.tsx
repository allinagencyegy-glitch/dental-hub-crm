import { requirePermission } from '@/server/auth/dal';
import { listLeadsAction } from '@/server/crm/leads/actions';
import { LeadsList } from './LeadsList';

export const metadata = { title: 'Leads | Dental Hub CRM' };

const VALID_STATUSES = ['NEW', 'CONTACTED', 'DISQUALIFIED'] as const;
type LeadStatus = (typeof VALID_STATUSES)[number];

async function getLeadsData(searchParams: Promise<{ status?: string; page?: string }>) {
  const params = await searchParams;
  const status = VALID_STATUSES.includes(params.status as LeadStatus) ? (params.status as LeadStatus) : undefined;
  const page = Math.max(1, Number(params.page) || 1);
  const limit = 25;
  const offset = (page - 1) * limit;

  const session = await requirePermission('leads:read');
  void session;
  const { leads, total } = await listLeadsAction({ status, limit, offset });

  return { leads, total, page, limit, status };
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const data = await getLeadsData(searchParams);
  return <LeadsList {...data} />;
}