'use server';

import 'server-only';
import { z } from 'zod';
import { assertPermission } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import {
  qualifyLeadUseCase,
  listOpportunitiesUseCase,
  getOpportunityDetailUseCase,
  getOpportunityStageHistoryUseCase,
  getOpportunityActivityUseCase,
  getOpportunityByLeadUseCase,
  changeOpportunityStageUseCase,
  updateOpportunityUseCase,
  reassignOpportunityOwnerUseCase,
  createFollowUpUseCase,
  createLeadFollowUpUseCase,
  completeFollowUpUseCase,
  rescheduleFollowUpUseCase,
  listFollowUpsUseCase,
  listOpportunityFollowUpsUseCase,
  listLeadFollowUpsUseCase,
  getNextPendingFollowUpUseCase,
  getLostReasonsUseCase,
  getOpportunityOwnersUseCase,
  getPipelineCountsUseCase,
  getFollowUpWindowCountsUseCase,
  type Actor,
  type QualifyLeadResult,
  type ChangeStageResult,
  type UpdateOpportunityResult,
  type ReassignOwnerResult,
  type CreateFollowUpResult,
  type CreateLeadFollowUpResult,
  type CompleteFollowUpResult,
  type RescheduleFollowUpResult,
} from './service';
import { OPPORTUNITY_STAGES, isOpportunityStage } from './stage';
import { FOLLOW_UP_ACTION_TYPES, isFollowUpOutcome } from './followup-actions';
import { localise } from './messages';
import type { OpportunityStageFilter } from './repository';
import type { FollowUpWindow } from './followups';

const stageFilterSchema = z.enum(['OPEN', 'ALL', 'WON', 'LOST', ...OPPORTUNITY_STAGES]);

const followUpWindowSchema = z.enum(['overdue', 'today', 'upcoming', 'completed']);

/**
 * Qualifies a lead into an opportunity. Requires lead write access: this is the
 * moment a lead stops being an inquiry and becomes commercial work.
 */
export async function qualifyLeadAction(
  leadId: string,
  input: { estimatedValue?: number | null; notes?: string | null; ownerUserId?: string | null; productCategoryId?: string | null } = {},
): Promise<QualifyLeadResult> {
  const session = await assertPermission('leads:write');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return localise('qualify', await qualifyLeadUseCase(actor, leadId, input), await getMessages());
}

export async function listOpportunitiesAction(
  options: { stage?: OpportunityStageFilter; ownerUserId?: string; search?: string; limit?: number; offset?: number } = {},
): Promise<Awaited<ReturnType<typeof listOpportunitiesUseCase>>> {
  const session = await assertPermission('opportunities:read');
  const actor: Actor = { userId: session.user.id, role: session.role };

  const parsed = stageFilterSchema.safeParse(options.stage ?? 'OPEN');
  if (!parsed.success) {
    return listOpportunitiesUseCase(actor, { ...options, stage: 'OPEN' });
  }

  return listOpportunitiesUseCase(actor, { ...options, stage: parsed.data });
}

export async function getOpportunityDetailAction(
  opportunityId: string,
): Promise<Awaited<ReturnType<typeof getOpportunityDetailUseCase>>> {
  const session = await assertPermission('opportunities:read');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return getOpportunityDetailUseCase(actor, opportunityId);
}

export async function getOpportunityStageHistoryAction(opportunityId: string) {
  const session = await assertPermission('opportunities:read');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return getOpportunityStageHistoryUseCase(actor, opportunityId);
}

/** The unified interaction feed shown on the opportunity detail timeline. */
export async function getOpportunityActivityAction(opportunityId: string) {
  const session = await assertPermission('opportunities:read');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return getOpportunityActivityUseCase(actor, opportunityId);
}

/** The opportunity a lead was qualified into, for the lead detail page. */
export async function getOpportunityByLeadAction(
  leadId: string,
): Promise<Awaited<ReturnType<typeof getOpportunityByLeadUseCase>>> {
  const session = await assertPermission('opportunities:read');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return getOpportunityByLeadUseCase(actor, leadId);
}

export async function getPipelineCountsAction(): Promise<Record<string, number>> {
  const session = await assertPermission('opportunities:read');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return getPipelineCountsUseCase(actor);
}

/**
 * Moves an opportunity to a new stage.
 *
 * Two permission levels, because closing a deal is a bigger commitment than
 * moving one along: `opportunities:advance` covers pipeline movement, while
 * WON and LOST additionally require `opportunities:close`.
 */
export async function changeOpportunityStageAction(
  opportunityId: string,
  input: { toStage: string; lostReasonId?: string | null; lostNote?: string | null },
): Promise<ChangeStageResult> {
  const isClosing = input.toStage === 'WON' || input.toStage === 'LOST';
  const session = await assertPermission(isClosing ? 'opportunities:close' : 'opportunities:advance');
  const actor: Actor = { userId: session.user.id, role: session.role };

  const m = await getMessages();

  if (!isOpportunityStage(input.toStage)) {
    return { ok: false, error: 'VALIDATION', message: m.opportunities.errors.unknownStage };
  }

  return localise('changeStage', await changeOpportunityStageUseCase(actor, opportunityId, input), m);
}

export async function updateOpportunityAction(
  opportunityId: string,
  input: { estimatedValue?: number | null; notes?: string | null; productCategoryId?: string | null; ownerUserId?: string | null },
): Promise<UpdateOpportunityResult> {
  const session = await assertPermission('opportunities:write');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return localise('update', await updateOpportunityUseCase(actor, opportunityId, input), await getMessages());
}

export async function reassignOpportunityOwnerAction(
  opportunityId: string,
  newOwnerUserId: string,
): Promise<ReassignOwnerResult> {
  const session = await assertPermission('opportunities:write');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return localise(
    'reassign',
    await reassignOpportunityOwnerUseCase(actor, opportunityId, newOwnerUserId),
    await getMessages(),
  );
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export async function createFollowUpAction(
  opportunityId: string,
  input: { actionType: string; note?: string | null; dueAt: string; ownerUserId?: string | null },
): Promise<CreateFollowUpResult> {
  const session = await assertPermission('followups:write');
  const actor: Actor = { userId: session.user.id, role: session.role };

  const m = await getMessages();

  if (!(FOLLOW_UP_ACTION_TYPES as readonly string[]).includes(input.actionType)) {
    return { ok: false, error: 'VALIDATION', message: m.opportunities.errors.unknownActionType };
  }

  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime())) {
    return { ok: false, error: 'VALIDATION', message: m.opportunities.errors.dueRequired };
  }

  return localise('scheduleOnOpportunity', await createFollowUpUseCase(actor, opportunityId, { ...input, dueAt }), m);
}

/**
 * Schedules a next action on a lead. Same permission as an opportunity
 * follow-up - a promise is a promise regardless of what it hangs off.
 */
export async function createLeadFollowUpAction(
  leadId: string,
  input: { actionType: string; note?: string | null; dueAt: string; ownerUserId?: string | null },
): Promise<CreateLeadFollowUpResult> {
  const session = await assertPermission('followups:write');
  const actor: Actor = { userId: session.user.id, role: session.role };

  const m = await getMessages();

  if (!(FOLLOW_UP_ACTION_TYPES as readonly string[]).includes(input.actionType)) {
    return { ok: false, error: 'VALIDATION', message: m.opportunities.errors.unknownActionType };
  }

  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime())) {
    return { ok: false, error: 'VALIDATION', message: m.opportunities.errors.dueRequired };
  }

  return localise('scheduleOnLead', await createLeadFollowUpUseCase(actor, leadId, { ...input, dueAt }), m);
}

export async function completeFollowUpAction(
  followUpId: string,
  input: { completionNote?: string | null; outcome?: string | null } = {},
): Promise<CompleteFollowUpResult> {
  const session = await assertPermission('followups:write');
  const actor: Actor = { userId: session.user.id, role: session.role };
  const m = await getMessages();
  if (input.outcome != null && !isFollowUpOutcome(input.outcome)) {
    return { ok: false, error: 'VALIDATION', message: m.opportunities.errors.unknownOutcome };
  }
  return localise('complete', await completeFollowUpUseCase(actor, followUpId, input), m);
}

export async function rescheduleFollowUpAction(
  followUpId: string,
  newDueAt: string,
): Promise<RescheduleFollowUpResult> {
  const session = await assertPermission('followups:write');
  const actor: Actor = { userId: session.user.id, role: session.role };

  const m = await getMessages();

  const dueAt = new Date(newDueAt);
  if (Number.isNaN(dueAt.getTime())) {
    return { ok: false, error: 'VALIDATION', message: m.opportunities.errors.dueRequired };
  }

  return localise('reschedule', await rescheduleFollowUpUseCase(actor, followUpId, dueAt), m);
}

export async function listFollowUpsAction(
  options: { window?: FollowUpWindow; ownerUserId?: string; limit?: number; offset?: number } = {},
): Promise<Awaited<ReturnType<typeof listFollowUpsUseCase>>> {
  const session = await assertPermission('followups:read');
  const actor: Actor = { userId: session.user.id, role: session.role };

  const parsed = followUpWindowSchema.safeParse(options.window ?? 'upcoming');
  const window = parsed.success ? parsed.data : 'upcoming';

  return listFollowUpsUseCase(actor, { ...options, window });
}

export async function getFollowUpWindowCountsAction(): Promise<
  Awaited<ReturnType<typeof getFollowUpWindowCountsUseCase>>
> {
  const session = await assertPermission('followups:read');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return getFollowUpWindowCountsUseCase(actor);
}

export async function listOpportunityFollowUpsAction(
  opportunityId: string,
): Promise<Awaited<ReturnType<typeof listOpportunityFollowUpsUseCase>>> {
  const session = await assertPermission('followups:read');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return listOpportunityFollowUpsUseCase(actor, opportunityId);
}

export async function listLeadFollowUpsAction(
  leadId: string,
): Promise<Awaited<ReturnType<typeof listLeadFollowUpsUseCase>>> {
  const session = await assertPermission('followups:read');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return listLeadFollowUpsUseCase(actor, leadId);
}

export async function getNextPendingFollowUpAction(
  opportunityId: string,
): Promise<Awaited<ReturnType<typeof getNextPendingFollowUpUseCase>>> {
  const session = await assertPermission('followups:read');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return getNextPendingFollowUpUseCase(actor, opportunityId);
}

export async function getLostReasonsAction(): Promise<
  { id: string; code: string; label: string; requiresNote: boolean }[]
> {
  await assertPermission('opportunities:close');
  return getLostReasonsUseCase();
}

export async function getOpportunityOwnersAction(): Promise<
  { id: string; displayName: string; role: string }[]
> {
  await assertPermission('opportunities:read');
  return getOpportunityOwnersUseCase();
}
