import { requirePermission } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import { getSalesReportAction } from '@/server/crm/reports/actions';
import { isReportPeriod } from '@/server/crm/reports/period';
import { ReportsView } from './ReportsView';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.reports.pageTitle) };
}

type ReportsSearchParams = { period?: string; from?: string; to?: string };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<ReportsSearchParams> }) {
  await requirePermission('dashboard:read');
  const params = await searchParams;
  const period = isReportPeriod(params.period) ? params.period : 'thisMonth';
  const report = await getSalesReportAction({ period, startDate: params.from, endDate: params.to });
  return <ReportsView report={report} period={period} />;
}
