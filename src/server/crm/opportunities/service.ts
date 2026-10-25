/**
 * Opportunity and follow-up use cases.
 *
 * The service layer owns the rules that need more than one query: which leads
 * may be qualified, who may own an opportunity, and which stage moves need a
 * lost reason. Authorization is still enforced in the repository - these
 * functions shape the answer, they do not decide who may ask.
 */
import { db as defaultDb } from '@/server/db/client';
import type { Db } from '@/server/db/types';
import {
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
} from '@/server/db/transaction';
import { findLeadById, LeadNotFoundError } from '@/server/crm/leads/repository';
import { findUserById, listUsers } from '@/server/users/repository';
import { isOpportunityStage, type OpportunityStage } from './stage';
import { isFollowUpActionType, type FollowUpActionType } from './followup-actions';
import {
  createOpportunity,
  findOpportunityById,
  findOpportunityByLeadId,
  findOpportunityDetailById,
  listOpportunities,
  changeOpportunityStage,
  updateOpportunity,
  reassignOpportunityOwner,
  countOpportunitiesByStage,
  recordStageChange,
  listStageHistory,
  listOpportunityActivity,
  LeadAlreadyQualifiedError,
  LostReasonRequiredError,
  OpportunityNotFoundError,
  InvalidStageTransitionError,
  UnknownStageError,
  type Opportunity,
  type OpportunityDetail,
  type OpportunityListRow,
  type OpportunityActivityEntry,
  type ListOpportunitiesOptions,
  type StageHistoryEntry,
  type UpdateOpportunityInput,
} from './repository';
import {
  createFollowUp,
  completeFollowUp,
  rescheduleFollowUp,
  listFollowUps,
  listFollowUpsForOpportunity,
  listFollowUpsForLead,
  findNextPendingFollowUp,
  countFollowUpsByWindow,
  movePendingFollowUpsToOpportunity,
  reassignPendingFollowUpsForOpportunity,
  ClosedOpportunityError,
  DueAtInPastError,
  FollowUpAlreadyCompletedError,
  FollowUpNotFoundError,
  LeadNotSchedulableError,
  type FollowUp,
  type FollowUpListRow,
  type FollowUpWindow,
} from './followups';

function getDb(db?: Db): Db {
  return db ?? defaultDb();
}

export type Actor = { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' };

export type FailureCode =
  | 'VALIDATION'
  | 'UNAUTHORISED'
  | 'NOT_FOUND'
  | 'LEAD_NOT_QUALIFIABLE'
  | 'ALREADY_QUALIFIED'
  | 'INVALID_TRANSITION'
  | 'LOST_REASON_REQUIRED'
  | 'OWNER_NOT_FOUND'
  | 'CATEGORY_NOT_FOUND'
  | 'CLOSED_OPPORTUNITY'
  | 'LEAD_NOT_SCHEDULABLE'
  | 'ALREADY_COMPLETED'
  | 'DUE_IN_PAST'
  | 'INTERNAL';

type Failure = { ok: false; error: FailureCode; message: string };

/**
 * Qualifies a lead into a commercial opportunity.
 *
 * Guard rails, in order:
 *   1. the lead must be visible to the actor (row scope - the repository's job);
 *   2. it must not already be disqualified - you do not pursue a dead lead;
 *   3. it must not already have an opportunity;
 *   4. owner defaults to the actor for a rep, and must be an active sales user
 *      when a manager names one.
 *
 * The opportunity and its first follow-up, if any, are written in one
 * transaction so a failure cannot leave a qualified lead with no opportunity.
 */
export type QualifyLeadInput = {
  estimatedValue?: number | null;
  notes?: string | null;
  ownerUserId?: string | null;
  productCategoryId?: string | null;
};

export type QualifyLeadResult = { ok: true; opportunity: Opportunity } | Failure;

export async function qualifyLeadUseCase(
  actor: Actor,
  leadId: string,
  input: QualifyLeadInput = {},
  db?: Db,
): Promise<QualifyLeadResult> {
  const database = getDb(db);

  const lead = await findLeadById(database, leadId, { userId: actor.userId, role: actor.role });
  if (!lead) {
    return { ok: false, error: 'NOT_FOUND', message: 'Lead not found.' };
  }

  if (lead.status === 'DISQUALIFIED') {
    return {
      ok: false,
      error: 'LEAD_NOT_QUALIFIABLE',
      message: 'A disqualified lead cannot be qualified into an opportunity.',
    };
  }

  const existing = await findOpportunityByLeadId(database, leadId, {
    userId: actor.userId,
    role: actor.role,
  });
  if (existing) {
    return {
      ok: false,
      error: 'ALREADY_QUALIFIED',
      message: 'This lead has already been qualified into an opportunity.',
    };
  }

  let ownerUserId = lead.ownerUserId;
  if (input.ownerUserId !== undefined && input.ownerUserId !== null) {
    if (actor.role === 'SALES_REP') {
      return { ok: false, error: 'UNAUTHORISED', message: 'Sales reps cannot reassign an opportunity.' };
    }
    const owner = await findUserById(database, input.ownerUserId);
    if (!owner || !owner.is_active) {
      return { ok: false, error: 'OWNER_NOT_FOUND', message: 'Owner not found or inactive.' };
    }
    if (owner.role !== 'SALES_REP' && owner.role !== 'SALES_MANAGER') {
      return { ok: false, error: 'OWNER_NOT_FOUND', message: 'Owner must be a Sales Rep or Sales Manager.' };
    }
    ownerUserId = owner.id;
  }

  let productCategoryId = lead.productCategoryId;
  if (input.productCategoryId !== undefined && input.productCategoryId !== null) {
    const { rows } = await database.query<{ id: string; is_active: boolean }>(
      `SELECT id, is_active FROM crm_product_category WHERE id = $1`,
      [input.productCategoryId],
    );
    if (!rows[0] || !rows[0].is_active) {
      return { ok: false, error: 'CATEGORY_NOT_FOUND', message: 'Product category not found or inactive.' };
    }
    productCategoryId = input.productCategoryId;
  }

  if (input.estimatedValue !== undefined && input.estimatedValue !== null && input.estimatedValue < 0) {
    return { ok: false, error: 'VALIDATION', message: 'Estimated value cannot be negative.' };
  }

  // Re-check inside the transaction: two reps qualifying the same lead at once
  // must not both succeed. The UNIQUE constraint is the arbiter, and the
  // duplicate is reported as ALREADY_QUALIFIED rather than a driver error.
  const transaction = await beginTransaction(database);

  try {
    const opportunity = await createOpportunity(transaction.client, {
      leadId,
      contactId: lead.contactId,
      accountId: lead.accountId,
      ownerUserId,
      productCategoryId,
      estimatedValue: input.estimatedValue ?? null,
      notes: input.notes ?? null,
    });

    // The opening stage is part of the audit trail, not a side effect of it.
    await recordStageChange(transaction.client, {
      opportunityId: opportunity.id,
      fromStage: null,
      toStage: 'QUALIFIED',
      changedBy: actor.userId,
      note: input.notes ?? null,
    });

    // Qualifying an already-reached lead is a CONTACTED fact, not a new status.
    if (lead.status === 'NEW') {
      await transaction.client.query(
        `UPDATE crm_lead SET status = 'CONTACTED', updated_at = now() WHERE id = $1 AND status = 'NEW'`,
        [leadId],
      );
    }

    // A promised next action follows its lead into commercial work: the
    // callback still has to happen, only its parent changes. Completed
    // follow-ups stay on the lead as pre-qualification history.
    await movePendingFollowUpsToOpportunity(
      transaction.client,
      leadId,
      opportunity.id,
      actor.userId,
    );

    await commitTransaction(transaction.client);
    return { ok: true, opportunity };
  } catch (error) {
    await rollbackTransaction(transaction.client);
    if (error instanceof LeadAlreadyQualifiedError) {
      return { ok: false, error: 'ALREADY_QUALIFIED', message: error.message };
    }
    throw error;
  } finally {
    transaction.release();
  }
}

export async function listOpportunitiesUseCase(
  actor: Actor,
  options: ListOpportunitiesOptions = {},
  db?: Db,
): Promise<{ opportunities: OpportunityListRow[]; total: number }> {
  const database = getDb(db);
  return listOpportunities(database, { userId: actor.userId, role: actor.role }, options);
}

export async function getOpportunityDetailUseCase(
  actor: Actor,
  opportunityId: string,
  db?: Db,
): Promise<OpportunityDetail | null> {
  const database = getDb(db);
  return findOpportunityDetailById(database, opportunityId, {
    userId: actor.userId,
    role: actor.role,
  });
}

/** The append-only stage timeline for an opportunity, oldest first. */
export async function getOpportunityStageHistoryUseCase(
  actor: Actor,
  opportunityId: string,
  db?: Db,
): Promise<StageHistoryEntry[]> {
  const database = getDb(db);
  return listStageHistory(database, opportunityId, {
    userId: actor.userId,
    role: actor.role,
  });
}

/**
 * The unified interaction feed for an opportunity, newest first: qualification,
 * stage moves, follow-up scheduling/completion/rescheduling, owner changes and
 * notes updates. Empty when the actor may not see the deal.
 */
export async function getOpportunityActivityUseCase(
  actor: Actor,
  opportunityId: string,
  db?: Db,
): Promise<OpportunityActivityEntry[]> {
  const database = getDb(db);
  return listOpportunityActivity(database, opportunityId, {
    userId: actor.userId,
    role: actor.role,
  });
}

/** The opportunity a lead was qualified into, or null if it was never qualified. */
export async function getOpportunityByLeadUseCase(
  actor: Actor,
  leadId: string,
  db?: Db,
): Promise<Opportunity | null> {
  const database = getDb(db);
  return findOpportunityByLeadId(database, leadId, { userId: actor.userId, role: actor.role });
}

export type ChangeStageResult = { ok: true; opportunity: Opportunity } | Failure;

export async function changeOpportunityStageUseCase(
  actor: Actor,
  opportunityId: string,
  input: { toStage: string; lostReasonId?: string | null; lostNote?: string | null },
  db?: Db,
): Promise<ChangeStageResult> {
  const database = getDb(db);

  if (!isOpportunityStage(input.toStage)) {
    return { ok: false, error: 'VALIDATION', message: 'Unknown opportunity stage.' };
  }
  const toStage: OpportunityStage = input.toStage;

  try {
    const opportunity = await changeOpportunityStage(
      database,
      opportunityId,
      { userId: actor.userId, role: actor.role },
      { toStage, lostReasonId: input.lostReasonId ?? null, lostNote: input.lostNote ?? null },
    );
    return { ok: true, opportunity };
  } catch (error) {
    if (error instanceof OpportunityNotFoundError) {
      return { ok: false, error: 'NOT_FOUND', message: error.message };
    }
    if (error instanceof InvalidStageTransitionError) {
      return { ok: false, error: 'INVALID_TRANSITION', message: error.message };
    }
    if (error instanceof LostReasonRequiredError) {
      return {
        ok: false,
        error: 'LOST_REASON_REQUIRED',
        message: 'Select a reason for losing this opportunity.',
      };
    }
    if (error instanceof UnknownStageError) {
      return { ok: false, error: 'VALIDATION', message: error.message };
    }
    throw error;
  }
}

export type UpdateOpportunityResult = { ok: true; opportunity: OpportunityDetail } | Failure;

export async function updateOpportunityUseCase(
  actor: Actor,
  opportunityId: string,
  input: UpdateOpportunityInput & { ownerUserId?: string | null },
  db?: Db,
): Promise<UpdateOpportunityResult> {
  const database = getDb(db);

  const existing = await findOpportunityById(database, opportunityId, {
    userId: actor.userId,
    role: actor.role,
  });
  if (!existing) {
    return { ok: false, error: 'NOT_FOUND', message: 'Opportunity not found.' };
  }

  if (input.estimatedValue !== undefined && input.estimatedValue !== null && input.estimatedValue < 0) {
    return { ok: false, error: 'VALIDATION', message: 'Estimated value cannot be negative.' };
  }

  try {
    // Owner change and field edits are one commercial decision, so they land
    // together: a half-applied save that moved the deal but dropped the value
    // (or the reverse) is worse than a clean failure.
    const transaction = await beginTransaction(database);
    try {
      if (input.ownerUserId !== undefined && input.ownerUserId !== null) {
        await reassignOpportunityOwner(
          transaction.client,
          opportunityId,
          { userId: actor.userId, role: actor.role },
          input.ownerUserId,
        );
        // Outstanding work moves with the deal, so the previous owner stops
        // appearing in the queue for a customer they no longer own.
        await reassignPendingFollowUpsForOpportunity(
          transaction.client,
          opportunityId,
          input.ownerUserId,
        );
      }

      await updateOpportunity(
        transaction.client,
        opportunityId,
        { userId: actor.userId, role: actor.role },
        {
          estimatedValue: input.estimatedValue,
          notes: input.notes,
          productCategoryId: input.productCategoryId,
        },
      );

      await commitTransaction(transaction.client);
    } catch (error) {
      await rollbackTransaction(transaction.client);
      throw error;
    } finally {
      transaction.release();
    }

    const detail = await findOpportunityDetailById(database, opportunityId, {
      userId: actor.userId,
      role: actor.role,
    });
    return { ok: true, opportunity: detail! };
  } catch (error) {
    if (error instanceof OpportunityNotFoundError) {
      return { ok: false, error: 'NOT_FOUND', message: error.message };
    }
    if (error instanceof Error) {
      if (error.message === 'UNAUTHORISED') {
        return { ok: false, error: 'UNAUTHORISED', message: 'Sales reps cannot reassign an opportunity.' };
      }
      if (error.message === 'OWNER_NOT_FOUND') {
        return { ok: false, error: 'OWNER_NOT_FOUND', message: 'Owner not found, inactive, or invalid role.' };
      }
      if (error.message === 'CATEGORY_NOT_FOUND') {
        return { ok: false, error: 'CATEGORY_NOT_FOUND', message: 'Product category not found or inactive.' };
      }
    }
    throw error;
  }
}

export type ReassignOwnerResult = { ok: true; opportunity: Opportunity } | Failure;

export async function reassignOpportunityOwnerUseCase(
  actor: Actor,
  opportunityId: string,
  newOwnerUserId: string,
  db?: Db,
): Promise<ReassignOwnerResult> {
  const database = getDb(db);

  if (actor.role === 'SALES_REP') {
    return { ok: false, error: 'UNAUTHORISED', message: 'Sales reps cannot reassign an opportunity.' };
  }

  try {
    // The owner change, its activity row, and the hand-off of outstanding
    // follow-ups are one commercial fact; they commit together or not at all.
    const transaction = await beginTransaction(database);
    try {
      const opportunity = await reassignOpportunityOwner(
        transaction.client,
        opportunityId,
        { userId: actor.userId, role: actor.role },
        newOwnerUserId,
      );
      await reassignPendingFollowUpsForOpportunity(
        transaction.client,
        opportunityId,
        newOwnerUserId,
      );
      await commitTransaction(transaction.client);
      return { ok: true, opportunity };
    } catch (error) {
      await rollbackTransaction(transaction.client);
      throw error;
    } finally {
      transaction.release();
    }
  } catch (error) {
    if (error instanceof OpportunityNotFoundError) {
      return { ok: false, error: 'NOT_FOUND', message: error.message };
    }
    if (error instanceof Error && error.message === 'OWNER_NOT_FOUND') {
      return { ok: false, error: 'OWNER_NOT_FOUND', message: 'Owner not found, inactive, or invalid role.' };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export type CreateFollowUpResult = { ok: true; followUp: FollowUp } | Failure;

/**
 * Schedules a next action on an opportunity.
 *
 * The follow-up owner defaults to the opportunity owner, so reassigning a deal
 * moves its workload with it. A manager may name a different assignee; a rep
 * may only schedule work for themselves.
 */
export async function createFollowUpUseCase(
  actor: Actor,
  opportunityId: string,
  input: {
    actionType: string;
    note?: string | null;
    dueAt: Date;
    ownerUserId?: string | null;
  },
  db?: Db,
): Promise<CreateFollowUpResult> {
  const database = getDb(db);

  if (!isFollowUpActionType(input.actionType)) {
    return { ok: false, error: 'VALIDATION', message: 'Unknown follow-up action type.' };
  }
  const actionType: FollowUpActionType = input.actionType;

  if (Number.isNaN(input.dueAt.getTime())) {
    return { ok: false, error: 'VALIDATION', message: 'A due date is required.' };
  }

  const opportunity = await findOpportunityById(database, opportunityId, {
    userId: actor.userId,
    role: actor.role,
  });
  if (!opportunity) {
    return { ok: false, error: 'NOT_FOUND', message: 'Opportunity not found.' };
  }

  let ownerUserId = opportunity.ownerUserId;
  if (input.ownerUserId !== undefined && input.ownerUserId !== null && input.ownerUserId !== opportunity.ownerUserId) {
    if (actor.role === 'SALES_REP') {
      return { ok: false, error: 'UNAUTHORISED', message: 'Sales reps cannot assign follow-ups to others.' };
    }
    const owner = await findUserById(database, input.ownerUserId);
    if (!owner || !owner.is_active) {
      return { ok: false, error: 'OWNER_NOT_FOUND', message: 'Owner not found or inactive.' };
    }
    if (owner.role !== 'SALES_REP' && owner.role !== 'SALES_MANAGER') {
      return { ok: false, error: 'OWNER_NOT_FOUND', message: 'Owner must be a Sales Rep or Sales Manager.' };
    }
    ownerUserId = owner.id;
  }

  try {
    const followUp = await createFollowUp(database, {
      opportunityId,
      ownerUserId,
      actionType,
      note: input.note ?? null,
      dueAt: input.dueAt,
      actorUserId: actor.userId,
    });
    return { ok: true, followUp };
  } catch (error) {
    if (error instanceof ClosedOpportunityError) {
      return { ok: false, error: 'CLOSED_OPPORTUNITY', message: error.message };
    }
    if (error instanceof DueAtInPastError) {
      return { ok: false, error: 'DUE_IN_PAST', message: error.message };
    }
    if (error instanceof FollowUpNotFoundError) {
      return { ok: false, error: 'NOT_FOUND', message: 'Opportunity not found.' };
    }
    throw error;
  }
}

export type CreateLeadFollowUpResult = { ok: true; followUp: FollowUp } | Failure;

/**
 * Schedules a next action on a lead - the call centre's promise before the lead
 * becomes commercial work.
 *
 * Mirrors createFollowUpUseCase: the owner defaults to the lead owner, a
 * manager may name a different assignee, and a rep may only schedule for
 * themselves. A disqualified or archived lead cannot take new work.
 */
export async function createLeadFollowUpUseCase(
  actor: Actor,
  leadId: string,
  input: {
    actionType: string;
    note?: string | null;
    dueAt: Date;
    ownerUserId?: string | null;
  },
  db?: Db,
): Promise<CreateLeadFollowUpResult> {
  const database = getDb(db);

  if (!isFollowUpActionType(input.actionType)) {
    return { ok: false, error: 'VALIDATION', message: 'Unknown follow-up action type.' };
  }
  const actionType: FollowUpActionType = input.actionType;

  if (Number.isNaN(input.dueAt.getTime())) {
    return { ok: false, error: 'VALIDATION', message: 'A due date is required.' };
  }

  const lead = await findLeadById(database, leadId, {
    userId: actor.userId,
    role: actor.role,
  });
  if (!lead) {
    return { ok: false, error: 'NOT_FOUND', message: 'Lead not found.' };
  }

  let ownerUserId = lead.ownerUserId;
  if (input.ownerUserId !== undefined && input.ownerUserId !== null && input.ownerUserId !== lead.ownerUserId) {
    if (actor.role === 'SALES_REP') {
      return { ok: false, error: 'UNAUTHORISED', message: 'Sales reps cannot assign follow-ups to others.' };
    }
    const owner = await findUserById(database, input.ownerUserId);
    if (!owner || !owner.is_active) {
      return { ok: false, error: 'OWNER_NOT_FOUND', message: 'Owner not found or inactive.' };
    }
    if (owner.role !== 'SALES_REP' && owner.role !== 'SALES_MANAGER') {
      return { ok: false, error: 'OWNER_NOT_FOUND', message: 'Owner must be a Sales Rep or Sales Manager.' };
    }
    ownerUserId = owner.id;
  }

  try {
    const followUp = await createFollowUp(database, {
      leadId,
      ownerUserId,
      actionType,
      note: input.note ?? null,
      dueAt: input.dueAt,
      actorUserId: actor.userId,
    });
    return { ok: true, followUp };
  } catch (error) {
    if (error instanceof LeadNotSchedulableError) {
      return { ok: false, error: 'LEAD_NOT_SCHEDULABLE', message: error.message };
    }
    if (error instanceof DueAtInPastError) {
      return { ok: false, error: 'DUE_IN_PAST', message: error.message };
    }
    if (error instanceof FollowUpNotFoundError) {
      return { ok: false, error: 'NOT_FOUND', message: 'Lead not found.' };
    }
    throw error;
  }
}

export type CompleteFollowUpResult = { ok: true; followUp: FollowUp } | Failure;

export async function completeFollowUpUseCase(
  actor: Actor,
  followUpId: string,
  input: { completionNote?: string | null } = {},
  db?: Db,
): Promise<CompleteFollowUpResult> {
  const database = getDb(db);

  // Completing without saying what happened is the gap this slice closes: the
  // next person to read the account needs the outcome, not just a tick. The
  // repository stays permissive so maintenance scripts can still stamp rows;
  // the product contract requires the note.
  const completionNote = input.completionNote?.trim() ?? '';
  if (completionNote.length === 0) {
    return {
      ok: false,
      error: 'VALIDATION',
      message: 'An outcome is required to complete a follow-up.',
    };
  }

  try {
    const followUp = await completeFollowUp(
      database,
      followUpId,
      { userId: actor.userId, role: actor.role },
      { completionNote },
    );
    return { ok: true, followUp };
  } catch (error) {
    if (error instanceof FollowUpNotFoundError) {
      return { ok: false, error: 'NOT_FOUND', message: error.message };
    }
    if (error instanceof FollowUpAlreadyCompletedError) {
      return { ok: false, error: 'ALREADY_COMPLETED', message: error.message };
    }
    throw error;
  }
}

export type RescheduleFollowUpResult = { ok: true; followUp: FollowUp } | Failure;

export async function rescheduleFollowUpUseCase(
  actor: Actor,
  followUpId: string,
  newDueAt: Date,
  db?: Db,
): Promise<RescheduleFollowUpResult> {
  const database = getDb(db);

  if (Number.isNaN(newDueAt.getTime())) {
    return { ok: false, error: 'VALIDATION', message: 'A due date is required.' };
  }

  try {
    const followUp = await rescheduleFollowUp(
      database,
      followUpId,
      { userId: actor.userId, role: actor.role },
      newDueAt,
    );
    return { ok: true, followUp };
  } catch (error) {
    if (error instanceof FollowUpNotFoundError) {
      return { ok: false, error: 'NOT_FOUND', message: error.message };
    }
    if (error instanceof FollowUpAlreadyCompletedError) {
      return { ok: false, error: 'ALREADY_COMPLETED', message: error.message };
    }
    if (error instanceof DueAtInPastError) {
      return { ok: false, error: 'DUE_IN_PAST', message: error.message };
    }
    throw error;
  }
}

export async function listFollowUpsUseCase(
  actor: Actor,
  options: { window?: FollowUpWindow; ownerUserId?: string; limit?: number; offset?: number } = {},
  db?: Db,
): Promise<{ followUps: FollowUpListRow[]; total: number }> {
  const database = getDb(db);
  return listFollowUps(database, { userId: actor.userId, role: actor.role }, options);
}

export async function listOpportunityFollowUpsUseCase(
  actor: Actor,
  opportunityId: string,
  db?: Db,
): Promise<FollowUp[]> {
  const database = getDb(db);
  return listFollowUpsForOpportunity(database, opportunityId, {
    userId: actor.userId,
    role: actor.role,
  });
}

export async function listLeadFollowUpsUseCase(
  actor: Actor,
  leadId: string,
  db?: Db,
): Promise<FollowUp[]> {
  const database = getDb(db);
  // Authorise against the lead first: without this a rep could probe
  // follow-up ids across leads they cannot open.
  const lead = await findLeadById(database, leadId, {
    userId: actor.userId,
    role: actor.role,
  });
  if (!lead) return [];
  return listFollowUpsForLead(database, leadId, {
    userId: actor.userId,
    role: actor.role,
  });
}

export async function getNextPendingFollowUpUseCase(
  actor: Actor,
  opportunityId: string,
  db?: Db,
): Promise<FollowUp | null> {
  const database = getDb(db);
  // Authorise against the parent first: without this a rep could probe
  // follow-up ids across other reps' opportunities.
  const opportunity = await findOpportunityById(database, opportunityId, {
    userId: actor.userId,
    role: actor.role,
  });
  if (!opportunity) return null;
  return findNextPendingFollowUp(database, opportunityId);
}

/** Lost reasons for the "mark as lost" form. Reuses crm_outcome_reason kind 'lost'. */
export async function getLostReasonsUseCase(db?: Db): Promise<
  { id: string; code: string; label: string; requiresNote: boolean }[]
> {
  const database = getDb(db);
  const { rows } = await database.query<{
    id: string; code: string; label: string; requires_note: boolean;
  }>(
    `SELECT id, code, label, requires_note
       FROM crm_outcome_reason
      WHERE kind = 'lost' AND is_active = true
      ORDER BY code ASC`,
  );
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    requiresNote: row.requires_note,
  }));
}

export async function getOpportunityOwnersUseCase(db?: Db): Promise<
  { id: string; displayName: string; role: string }[]
> {
  const database = getDb(db);
  const users = await listUsers(database);
  return users
    .filter((user) => user.isActive && (user.role === 'SALES_REP' || user.role === 'SALES_MANAGER'))
    .map((user) => ({ id: user.id, displayName: user.displayName, role: user.role }));
}

export async function getPipelineCountsUseCase(
  actor: Actor,
  db?: Db,
): Promise<Record<string, number>> {
  const database = getDb(db);
  return countOpportunitiesByStage(database, { userId: actor.userId, role: actor.role });
}

export async function getFollowUpWindowCountsUseCase(
  actor: Actor,
  db?: Db,
): Promise<{ overdue: number; today: number; upcoming: number; completed: number }> {
  const database = getDb(db);
  return countFollowUpsByWindow(database, { userId: actor.userId, role: actor.role });
}

export { LeadNotFoundError };
