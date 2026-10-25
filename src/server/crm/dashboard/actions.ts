'use server';

import 'server-only';
import { z } from 'zod';
import { assertPermission } from '@/server/auth/dal';
import {
  getDashboardUseCase,
  getPipelineBoardUseCase,
  getSourceOptionsUseCase,
  type Actor,
  type DashboardPayload,
} from './service';
import type { PipelineBoard } from './repository';
import { DASHBOARD_RANGES } from './dates';

const dashboardInputSchema = z.object({
  range: z.enum(DASHBOARD_RANGES).optional(),
  ownerUserId: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

/** The full management dashboard, row-scoped to the signed-in actor. */
export async function getDashboardAction(input: unknown = {}): Promise<DashboardPayload> {
  const session = await assertPermission('dashboard:read');
  const actor: Actor = { userId: session.user.id, role: session.role };

  const parsed = dashboardInputSchema.safeParse(input);
  const request = parsed.success
    ? {
        range: parsed.data.range ?? 'last30',
        ownerUserId: parsed.data.ownerUserId ?? null,
        sourceId: parsed.data.sourceId ?? null,
        startDate: parsed.data.startDate ?? null,
        endDate: parsed.data.endDate ?? null,
      }
    : {
        range: 'last30' as const,
        ownerUserId: null,
        sourceId: null,
        startDate: null,
        endDate: null,
      };

  // An unreadable custom range falls back to the default rather than failing
  // the whole page; the UI always sends readable dates anyway.
  try {
    return await getDashboardUseCase(actor, request);
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CUSTOM_RANGE') {
      return getDashboardUseCase(actor, { range: 'last30' });
    }
    throw error;
  }
}

const pipelineInputSchema = z.object({
  ownerUserId: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  stage: z.string().nullable().optional(),
});

/** The pipeline board snapshot, row-scoped to the signed-in actor. */
export async function getPipelineBoardAction(input: unknown = {}): Promise<PipelineBoard> {
  const session = await assertPermission('opportunities:read');
  const actor: Actor = { userId: session.user.id, role: session.role };
  const parsed = pipelineInputSchema.safeParse(input);
  return getPipelineBoardUseCase(actor, parsed.success ? parsed.data : {});
}

/** The reference list behind the dashboard's source filter. */
export async function getSourceOptionsAction(): Promise<{ id: string; code: string; name: string }[]> {
  await assertPermission('dashboard:read');
  return getSourceOptionsUseCase();
}
