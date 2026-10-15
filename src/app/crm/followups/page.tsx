import { requirePermission } from '@/server/auth/dal';
import { listFollowUpsAction, getFollowUpWindowCountsAction } from '@/server/crm/opportunities/actions';
import { FollowUpsList } from './FollowUpsList';
import type { FollowUpWindow } from '@/server/crm/opportunities/followups';

export const metadata = { title: 'Follow-ups | Dental Hub CRM' };

const VALID_WINDOWS = ['overdue', 'today', 'upcoming', 'completed'] as const;
type Window = (typeof VALID_WINDOWS)[number];

async function getFollowUpsData(searchParams: Promise<{ window?: string; page?: string }>) {
  const params = await searchParams;
  const window: FollowUpWindow = VALID_WINDOWS.includes(params.window as Window)
    ? (params.window as Window)
    : 'upcoming';
  const page = Math.max(1, Number(params.page) || 1);
  const limit = 25;
  const offset = (page - 1) * limit;

  const session = await requirePermission('followups:read');
  void session;

  const [{ followUps, total }, counts] = await Promise.all([
    listFollowUpsAction({ window, limit, offset }),
    getFollowUpWindowCountsAction(),
  ]);

  return { followUps, total, page, limit, window, counts };
}

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; page?: string }>;
}) {
  const data = await getFollowUpsData(searchParams);
  return <FollowUpsList {...data} />;
}
