'use server';

import 'server-only';
import { assertPermission } from '@/server/auth/dal';
import { db as defaultDb } from '@/server/db/client';
import { getTeamBoard, type TeamBoard } from './repository';

/** The team page: each person's current workload, within the caller's row scope. */
export async function getTeamBoardAction(): Promise<TeamBoard> {
  const session = await assertPermission('dashboard:read');
  return getTeamBoard(defaultDb(), { userId: session.user.id, role: session.role });
}
