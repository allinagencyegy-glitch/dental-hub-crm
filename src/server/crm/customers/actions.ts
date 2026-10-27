'use server';

import 'server-only';
import { z } from 'zod';
import { assertPermission } from '@/server/auth/dal';
import { db as defaultDb } from '@/server/db/client';
import { listCustomers, type CustomerListRow, type CustomerListSummary } from './repository';

const listOptionsSchema = z.object({
  ownerUserId: z.uuid().optional(),
  search: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

/**
 * The customers page. Customers are read from won deals, so the permission is
 * the one that reads deals. An unreadable filter falls back to the unfiltered
 * list; row scope still applies.
 */
export async function listCustomersAction(
  input: unknown,
): Promise<{ customers: CustomerListRow[]; summary: CustomerListSummary }> {
  const session = await assertPermission('opportunities:read');
  const parsed = listOptionsSchema.safeParse(input);
  return listCustomers(defaultDb(), { userId: session.user.id, role: session.role }, parsed.success ? parsed.data : {});
}
