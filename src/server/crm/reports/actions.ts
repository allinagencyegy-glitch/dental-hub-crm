'use server';

import 'server-only';
import { assertPermission } from '@/server/auth/dal';
import { db as defaultDb } from '@/server/db/client';
import { getSalesReport, type SalesReport } from './repository';
import { isReportPeriod, resolveReportPeriod } from './period';

/**
 * The reports page for a period. An unknown period, or a custom one with
 * unreadable dates, falls back to this month; row scope always applies.
 */
export async function getSalesReportAction(input: {
  period?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}): Promise<SalesReport> {
  const session = await assertPermission('dashboard:read');
  const period = isReportPeriod(input.period) ? input.period : 'thisMonth';
  const dates = resolveReportPeriod(period, new Date(), {
    startDate: typeof input.startDate === 'string' ? input.startDate : null,
    endDate: typeof input.endDate === 'string' ? input.endDate : null,
  });
  return getSalesReport(defaultDb(), { userId: session.user.id, role: session.role }, dates);
}
