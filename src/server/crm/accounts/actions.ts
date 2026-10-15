'use server';

import 'server-only';
import { assertPermission } from '@/server/auth/dal';
import { db as defaultDb } from '@/server/db/client';
import { listAccounts } from './repository';

/**
 * Active clinics/accounts for the lead account-linking workflow.
 * Row scope does not apply: accounts are shared reference data for the sales
 * team, so any CRM user who can read leads may see the clinic list.
 */
export async function listAccountsAction(options: { search?: string; limit?: number } = {}): Promise<
  { id: string; name: string }[]
> {
  await assertPermission('leads:read');
  const accounts = await listAccounts(defaultDb(), options);
  return accounts.map((account) => ({ id: account.id, name: account.name }));
}
