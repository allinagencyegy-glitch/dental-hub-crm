/**
 * All SQL touching crm_followup.
 *
 * A follow-up is the unit of "what happens next". It hangs off exactly one
 * parent: an opportunity, or - before qualification - a lead. Rows are created
 * pending and later stamped with completed_at; they are never deleted. That is
 * what makes the timeline auditable after the deal closes - a WON or LOST
 * transition changes only crm_opportunity.stage and leaves every promise and
 * every completed action intact.
 *
 * Row scope: see pushRepScope below. A SALES_REP reaches a follow-up either as
 * its assignee or as the owner of the parent it belongs to.
 */
import type { Db } from '@/server/db/types';
import {
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
} from '@/server/db/transaction';
import { recordOpportunityActivity } from './repository';
import { notify } from '@/server/crm/notifications/repository';
import {
  isFollowUpActionType,
  ACTION_TYPE_LABELS,
  type FollowUpActionType,
  type FollowUpOutcome,
} from './followup-actions';
import type { Role } from '@/server/authz/permissions';
import { ownerScopeSql } from '@/server/crm/scope';

export interface FollowUp {
  id: string;
  /** The opportunity parent, or null when the parent is a lead. */
  opportunityId: string | null;
  /** The lead parent, or null when the parent is an opportunity. */
  leadId: string | null;
  ownerUserId: string;
  actionType: FollowUpActionType;
  note: string | null;
  dueAt: Date;
  completedAt: Date | null;
  /** What happened, set when the follow-up is completed. */
  outcome: FollowUpOutcome | null;
  createdAt: Date;
  updatedAt: Date;
}

type FollowUpRow = {
  id: string;
  opportunity_id: string | null;
  lead_id: string | null;
  owner_user_id: string;
  action_type: FollowUpActionType;
  note: string | null;
  due_at: Date;
  completed_at: Date | null;
  outcome: FollowUpOutcome | null;
  created_at: Date;
  updated_at: Date;
};

function toFollowUp(row: FollowUpRow): FollowUp {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    leadId: row.lead_id,
    ownerUserId: row.owner_user_id,
    actionType: row.action_type,
    note: row.note,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    outcome: row.outcome,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Unqualified, for `INSERT/UPDATE ... RETURNING`, where a table alias is not
// available.
const FOLLOW_UP_COLUMNS = `
  id, opportunity_id, lead_id, owner_user_id, action_type, note,
  due_at, completed_at, outcome, created_at, updated_at
`;

// Qualified with the `f` alias for every SELECT. Several of these columns
// (id, owner_user_id, created_at, updated_at) also exist on crm_opportunity
// and crm_lead, which the authorized lookups join against - unqualified they
// are ambiguous.
const FOLLOW_UP_COLUMNS_F = `
  f.id, f.opportunity_id, f.lead_id, f.owner_user_id, f.action_type, f.note,
  f.due_at, f.completed_at, f.outcome, f.created_at, f.updated_at
`;

type Actor = { userId: string; role: Role };

export class FollowUpNotFoundError extends Error {
  constructor(id: string) {
    super(`Follow-up ${id} not found.`);
    this.name = 'FollowUpNotFoundError';
  }
}

export class FollowUpAlreadyCompletedError extends Error {
  constructor() {
    super('This follow-up is already completed.');
    this.name = 'FollowUpAlreadyCompletedError';
  }
}

export class InvalidActionTypeError extends Error {
  constructor(actionType: string) {
    super(`Unknown follow-up action type: ${actionType}.`);
    this.name = 'InvalidActionTypeError';
  }
}

export class DueAtInPastError extends Error {
  constructor() {
    super('A follow-up cannot be scheduled in the past.');
    this.name = 'DueAtInPastError';
  }
}

export class ClosedOpportunityError extends Error {
  constructor() {
    super('This opportunity is closed, so no new next action can be scheduled.');
    this.name = 'ClosedOpportunityError';
  }
}

export class LeadNotSchedulableError extends Error {
  constructor() {
    super('This lead is disqualified or archived, so no new next action can be scheduled.');
    this.name = 'LeadNotSchedulableError';
  }
}

export class FollowUpParentError extends Error {
  constructor() {
    super('A follow-up must belong to exactly one parent.');
    this.name = 'FollowUpParentError';
  }
}

/**
 * Schedules a new next action against an opportunity or a lead.
 *
 * Exactly one parent is required. An opportunity parent must be open: a WON or
 * LOST deal is history, and adding a pending action to it would resurrect a
 * closed deal in every "what is due" queue. A lead parent must be live: a
 * disqualified or archived lead is likewise not work that should surface in the
 * queue. Completed actions on either stay readable.
 *
 * The follow-up row and, for an opportunity, its activity-feed entry land in
 * one transaction. Lead-level follow-ups carry no activity row yet - the
 * activity model is opportunity-scoped - so the follow-up row itself, with its
 * created_at and owner, is the durable record.
 */
export async function createFollowUp(
  db: Db,
  input: {
    opportunityId?: string | null;
    leadId?: string | null;
    ownerUserId: string;
    actionType: FollowUpActionType;
    note?: string | null;
    dueAt: Date;
    actorUserId?: string | null;
  },
): Promise<FollowUp> {
  if (!isFollowUpActionType(input.actionType)) {
    throw new InvalidActionTypeError(String(input.actionType));
  }

  if (input.dueAt.getTime() < Date.now()) {
    throw new DueAtInPastError();
  }

  const opportunityId = input.opportunityId ?? null;
  const leadId = input.leadId ?? null;
  if ((opportunityId === null) === (leadId === null)) {
    throw new FollowUpParentError();
  }

  const transaction = await beginTransaction(db);
  const client = transaction.client;
  try {
    if (opportunityId !== null) {
      const { rows: oppRows } = await client.query<{ stage: string }>(
        `SELECT stage FROM crm_opportunity WHERE id = $1`,
        [opportunityId],
      );
      const opportunity = oppRows[0];
      if (!opportunity) throw new FollowUpNotFoundError(opportunityId);
      if (opportunity.stage === 'WON' || opportunity.stage === 'LOST') {
        throw new ClosedOpportunityError();
      }
    } else {
      const { rows: leadRows } = await client.query<{ status: string; archived_at: Date | null }>(
        `SELECT status, archived_at FROM crm_lead WHERE id = $1`,
        [leadId],
      );
      const lead = leadRows[0];
      if (!lead) throw new FollowUpNotFoundError(leadId as string);
      if (lead.status === 'DISQUALIFIED' || lead.archived_at !== null) {
        throw new LeadNotSchedulableError();
      }
    }

    const note = input.note?.trim() || null;
    const { rows } = await client.query<FollowUpRow>(
      `INSERT INTO crm_followup (opportunity_id, lead_id, owner_user_id, action_type, note, due_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${FOLLOW_UP_COLUMNS}`,
      [opportunityId, leadId, input.ownerUserId, input.actionType, note, input.dueAt],
    );
    const followUp = toFollowUp(rows[0]);

    if (opportunityId !== null) {
      await recordOpportunityActivity(client, {
        opportunityId,
        activityType: 'FOLLOW_UP_CREATED',
        description: `Follow-up scheduled: ${ACTION_TYPE_LABELS[input.actionType]}`,
        metadata: {
          followUpId: followUp.id,
          actionType: input.actionType,
          note,
          dueAt: followUp.dueAt.toISOString(),
        },
        actorUserId: input.actorUserId ?? input.ownerUserId,
      });
    }

    // Only work handed to someone else is news; scheduling for yourself is not.
    await notify(client, {
      recipientUserId: input.ownerUserId,
      kind: 'FOLLOW_UP_ASSIGNED',
      actorUserId: input.actorUserId ?? input.ownerUserId,
      followUpId: followUp.id,
    });

    await commitTransaction(client);
    return followUp;
  } catch (error) {
    await rollbackTransaction(client);
    throw error;
  } finally {
    transaction.release();
  }
}

/**
 * Completes a pending follow-up.
 *
 * completed_at is written once: the UPDATE is qualified on
 * `completed_at IS NULL`, so a double-click or a replayed request matches no row
 * and is reported as already-completed rather than overwriting the real
 * completion time. The activity-feed entry (opportunity parents only) lands in
 * the same transaction.
 *
 * The completion note is what actually happened. It is appended to the row's
 * note rather than replacing it, so the timeline reads as "what was planned" and
 * then "what happened". COALESCE guards the case where the row had no plan note:
 * without it, `NULL || E'\n' || outcome` would evaluate to NULL and silently
 * throw the outcome away.
 */
export async function completeFollowUp(
  db: Db,
  followUpId: string,
  actor: Actor,
  input: { completionNote?: string | null; outcome?: FollowUpOutcome | null } = {},
): Promise<FollowUp> {
  const transaction = await beginTransaction(db);
  const client = transaction.client;
  try {
    const followUp = await findFollowUpById(client, followUpId, actor);
    if (!followUp) throw new FollowUpNotFoundError(followUpId);
    if (followUp.completedAt !== null) throw new FollowUpAlreadyCompletedError();

    const completionNote = input.completionNote?.trim() || null;
    const outcome = input.outcome ?? null;
    const { rows } = await client.query<FollowUpRow>(
      `UPDATE crm_followup
          SET completed_at = now(),
              outcome = $3,
              note = CASE
                WHEN $2::text IS NOT NULL THEN trim(btrim(COALESCE(note || E'\n', '') || $2::text))
                ELSE note
              END,
              updated_at = now()
        WHERE id = $1 AND completed_at IS NULL
        RETURNING ${FOLLOW_UP_COLUMNS}`,
      [followUpId, completionNote, outcome],
    );

    if (rows.length === 0) throw new FollowUpAlreadyCompletedError();
    const completed = toFollowUp(rows[0]);

    if (completed.opportunityId !== null) {
      await recordOpportunityActivity(client, {
        opportunityId: completed.opportunityId,
        activityType: 'FOLLOW_UP_COMPLETED',
        description: `Follow-up completed: ${ACTION_TYPE_LABELS[completed.actionType]}`,
        metadata: {
          followUpId: completed.id,
          actionType: completed.actionType,
          outcome,
          completionNote,
          completedAt: completed.completedAt?.toISOString() ?? null,
        },
        actorUserId: actor.userId,
      });
    }

    await commitTransaction(client);
    return completed;
  } catch (error) {
    await rollbackTransaction(client);
    throw error;
  } finally {
    transaction.release();
  }
}

/** Reschedules a pending follow-up. */
export async function rescheduleFollowUp(
  db: Db,
  followUpId: string,
  actor: Actor,
  newDueAt: Date,
): Promise<FollowUp> {
  if (newDueAt.getTime() < Date.now()) {
    throw new DueAtInPastError();
  }

  const transaction = await beginTransaction(db);
  const client = transaction.client;
  try {
    const followUp = await findFollowUpById(client, followUpId, actor);
    if (!followUp) throw new FollowUpNotFoundError(followUpId);
    if (followUp.completedAt !== null) throw new FollowUpAlreadyCompletedError();

    const { rows } = await client.query<FollowUpRow>(
      `UPDATE crm_followup
          SET due_at = $2, updated_at = now()
        WHERE id = $1 AND completed_at IS NULL
        RETURNING ${FOLLOW_UP_COLUMNS}`,
      [followUpId, newDueAt],
    );

    if (rows.length === 0) throw new FollowUpAlreadyCompletedError();
    const rescheduled = toFollowUp(rows[0]);

    if (rescheduled.opportunityId !== null) {
      await recordOpportunityActivity(client, {
        opportunityId: rescheduled.opportunityId,
        activityType: 'FOLLOW_UP_RESCHEDULED',
        description: `Follow-up rescheduled: ${ACTION_TYPE_LABELS[rescheduled.actionType]}`,
        metadata: {
          followUpId: rescheduled.id,
          actionType: rescheduled.actionType,
          previousDueAt: followUp.dueAt.toISOString(),
          newDueAt: rescheduled.dueAt.toISOString(),
        },
        actorUserId: actor.userId,
      });
    }

    await commitTransaction(client);
    return rescheduled;
  } catch (error) {
    await rollbackTransaction(client);
    throw error;
  } finally {
    transaction.release();
  }
}

/**
 * Moves a lead's pending follow-ups onto the opportunity the lead was qualified
 * into.
 *
 * Runs on the caller's connection so it composes inside the qualification
 * transaction: the opportunity and its inherited next action commit together,
 * or neither does. Completed follow-ups stay on the lead - they are history of
 * the pre-qualification phase, not outstanding work. A single FOLLOW_UP_MOVED
 * activity on the new opportunity records the hand-off so the timeline can
 * explain where the inherited work came from.
 */
export async function movePendingFollowUpsToOpportunity(
  db: Db,
  leadId: string,
  opportunityId: string,
  actorUserId: string | null,
): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE crm_followup
        SET opportunity_id = $2, lead_id = NULL, updated_at = now()
      WHERE lead_id = $1 AND completed_at IS NULL
      RETURNING id`,
    [leadId, opportunityId],
  );

  if (rows.length === 0) return 0;

  await recordOpportunityActivity(db, {
    opportunityId,
    activityType: 'FOLLOW_UP_MOVED',
    description:
      rows.length === 1
        ? 'Pending follow-up carried over from the lead'
        : `${rows.length} pending follow-ups carried over from the lead`,
    metadata: { followUpIds: rows.map((row) => row.id), count: rows.length },
    actorUserId,
  });

  return rows.length;
}

/**
 * Reassigns a parent's pending follow-ups to a new owner.
 *
 * Runs on the caller's connection so it composes inside the reassignment
 * transaction. Completed follow-ups are left with the person who did the work:
 * moving them would rewrite who completed what.
 */
export async function reassignPendingFollowUpsForOpportunity(
  db: Db,
  opportunityId: string,
  newOwnerUserId: string,
): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE crm_followup
        SET owner_user_id = $2, updated_at = now()
      WHERE opportunity_id = $1 AND completed_at IS NULL AND owner_user_id <> $2
      RETURNING id`,
    [opportunityId, newOwnerUserId],
  );
  return rows.length;
}

/** The lead-parent twin of reassignPendingFollowUpsForOpportunity. */
export async function reassignPendingLeadFollowUps(
  db: Db,
  leadId: string,
  newOwnerUserId: string,
): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE crm_followup
        SET owner_user_id = $2, updated_at = now()
      WHERE lead_id = $1 AND completed_at IS NULL AND owner_user_id <> $2
      RETURNING id`,
    [leadId, newOwnerUserId],
  );
  return rows.length;
}

/**
 * Reads one follow-up within the actor's row scope.
 *
 * SALES_REP must be the assignee or the owner of the parent - a rep cannot
 * reach a colleague's follow-up by guessing an id.
 */
export async function findFollowUpById(
  db: Db,
  followUpId: string,
  actor: Actor,
): Promise<FollowUp | null> {
  let where = 'WHERE f.id = $1';
  const params: string[] = [followUpId];

  const scope = ownerScopeSql(actor, params, ['f.owner_user_id', 'o.owner_user_id', 'l.owner_user_id']);
  if (scope) where += ` AND ${scope}`;

  const { rows } = await db.query<FollowUpRow>(
    `SELECT ${FOLLOW_UP_COLUMNS_F}
       FROM crm_followup f
       LEFT JOIN crm_opportunity o ON o.id = f.opportunity_id
       LEFT JOIN crm_lead l        ON l.id = f.lead_id
     ${where}`,
    params,
  );

  return rows[0] ? toFollowUp(rows[0]) : null;
}

/** The earliest pending action on an opportunity, or null when none is scheduled. */
export async function findNextPendingFollowUp(
  db: Db,
  opportunityId: string,
): Promise<FollowUp | null> {
  const { rows } = await db.query<FollowUpRow>(
    `SELECT ${FOLLOW_UP_COLUMNS_F}
       FROM crm_followup f
      WHERE f.opportunity_id = $1 AND f.completed_at IS NULL
      ORDER BY f.due_at ASC, f.created_at ASC
      LIMIT 1`,
    [opportunityId],
  );
  return rows[0] ? toFollowUp(rows[0]) : null;
}

/** Full history for one opportunity, newest due date first. Completed rows included. */
export async function listFollowUpsForOpportunity(
  db: Db,
  opportunityId: string,
  actor: Actor,
): Promise<FollowUp[]> {
  let where = 'WHERE f.opportunity_id = $1';
  const params: string[] = [opportunityId];

  const scope = ownerScopeSql(actor, params, ['f.owner_user_id', 'o.owner_user_id']);
  if (scope) where += ` AND ${scope}`;

  const { rows } = await db.query<FollowUpRow>(
    `SELECT ${FOLLOW_UP_COLUMNS_F}
       FROM crm_followup f
       JOIN crm_opportunity o ON o.id = f.opportunity_id
     ${where}
     ORDER BY f.due_at DESC, f.created_at DESC`,
    params,
  );

  return rows.map(toFollowUp);
}

/** Full history for one lead, newest due date first. Completed rows included. */
export async function listFollowUpsForLead(
  db: Db,
  leadId: string,
  actor: Actor,
): Promise<FollowUp[]> {
  let where = 'WHERE f.lead_id = $1';
  const params: string[] = [leadId];

  const scope = ownerScopeSql(actor, params, ['f.owner_user_id', 'l.owner_user_id']);
  if (scope) where += ` AND ${scope}`;

  const { rows } = await db.query<FollowUpRow>(
    `SELECT ${FOLLOW_UP_COLUMNS_F}
       FROM crm_followup f
       JOIN crm_lead l ON l.id = f.lead_id
     ${where}
     ORDER BY f.due_at DESC, f.created_at DESC`,
    params,
  );

  return rows.map(toFollowUp);
}

export type FollowUpWindow = 'overdue' | 'today' | 'upcoming' | 'completed';

export type FollowUpParentKind = 'lead' | 'opportunity';

/**
 * Day-window boundaries for the action queue, in the CRM's business timezone.
 *
 * Dental Hub operates in Egypt, so "today" means the Cairo calendar day - not
 * the UTC day and not whatever the database or Windows host happens to be set
 * to. `date_trunc('day', now(), 'Africa/Cairo')` truncates the absolute
 * `now()` instant to the start of the current Cairo day using PostgreSQL's own
 * IANA timezone database, which also carries Egypt's DST rules: the boundary
 * for a 23- or 25-hour Cairo day lands at the correct absolute instant
 * because each boundary is computed by truncating an instant that lies on
 * that specific day, never by adding a fixed 24-hour interval.
 *
 * due_at stays timestamptz throughout, so every comparison remains between
 * absolute instants.
 *
 *   overdue   due_at < now()
 *   today     now() <= due_at < START_OF_TOMORROW_CAIRO
 *   tomorrow  START_OF_TOMORROW_CAIRO <= due_at < start of the Cairo day after
 *   upcoming  due_at >= START_OF_TOMORROW_CAIRO
 *   completed completed_at IS NOT NULL
 *
 * The queue exposes three pending buckets (overdue / today / upcoming); the
 * `tomorrow` boundary is what separates `today` from `upcoming`.
 */
const BUSINESS_TIMEZONE = 'Africa/Cairo';
// The only boundary the queries need: the instant the next Cairo day begins.
// Truncating tomorrow's instant (not today's + 24h) keeps the boundary
// correct across Cairo DST transitions.
const START_OF_TOMORROW_CAIRO_SQL = `date_trunc('day', now() + interval '1 day', '${BUSINESS_TIMEZONE}')`;

/**
 * A SALES_REP's (or a team leader's, team-wide) row scope for follow-ups.
 *
 * A follow-up is scoped to its own assignee OR to the owner of the parent it
 * hangs off, because the two can differ: a manager may assign an action to a
 * rep on a deal owned by someone else. Scoping on the parent alone would lock
 * the assignee out of work they were explicitly given; scoping on the follow-up
 * alone would hide parent history from the person who owns it. This is not a
 * visibility leak - it never exposes a parent the rep cannot open.
 */
function pushRepScope(
  clauses: string[],
  params: (string | number | Date)[],
  actor: Actor,
): void {
  const scope = ownerScopeSql(actor, params, ['f.owner_user_id', 'o.owner_user_id', 'l.owner_user_id']);
  if (scope) clauses.push(scope);
}

/**
 * Closed parents keep their follow-up rows, but a pending action on a WON/LOST
 * opportunity - or on a disqualified or archived lead - is no longer
 * outstanding work, so it must not sit in the queue nagging the owner. It
 * stays visible in the parent's own history.
 */
const OPEN_PARENT = `(
  (f.opportunity_id IS NOT NULL AND o.stage NOT IN ('WON', 'LOST'))
  OR (f.lead_id IS NOT NULL AND l.status <> 'DISQUALIFIED' AND l.archived_at IS NULL)
)`;

export interface ListFollowUpsOptions {
  window?: FollowUpWindow;
  ownerUserId?: string;
  limit?: number;
  offset?: number;
}

export interface FollowUpListRow extends FollowUp {
  parentKind: FollowUpParentKind;
  opportunityStage: string | null;
  contactName: string;
  accountName: string | null;
  ownerName: string;
  isOverdue: boolean;
}

/**
 * The salesperson's action queue.
 *
 * `overdue`  - pending and due before now (missed).
 * `today`    - pending and due later today.
 * `upcoming` - pending and due after today.
 * `completed`- stamped rows, newest first.
 *
 * Scoped to parents the actor may see, so the queue never leaks another rep's
 * customers. Both opportunity and lead parents appear, so a promised callback
 * on an unqualified lead is as visible as one on a live deal.
 */
export async function listFollowUps(
  db: Db,
  actor: Actor,
  options: ListFollowUpsOptions = {},
): Promise<{ followUps: FollowUpListRow[]; total: number }> {
  const { window = 'upcoming', limit = 50, offset = 0 } = options;

  const clauses: string[] = [];
  const params: (string | number | Date)[] = [];

  pushRepScope(clauses, params, actor);

  if (options.ownerUserId) {
    params.push(options.ownerUserId);
    clauses.push(`f.owner_user_id = $${params.length}`);
  }

  switch (window) {
    case 'overdue':
      clauses.push(OPEN_PARENT);
      clauses.push('f.completed_at IS NULL');
      clauses.push('f.due_at < now()');
      break;
    case 'today':
      clauses.push(OPEN_PARENT);
      clauses.push('f.completed_at IS NULL');
      clauses.push('f.due_at >= now()');
      clauses.push(`f.due_at < ${START_OF_TOMORROW_CAIRO_SQL}`);
      break;
    case 'upcoming':
      clauses.push(OPEN_PARENT);
      clauses.push('f.completed_at IS NULL');
      clauses.push(`f.due_at >= ${START_OF_TOMORROW_CAIRO_SQL}`);
      break;
    case 'completed':
      // Closed parents are not filtered here: completed history is exactly what
      // must survive a WON or LOST outcome.
      clauses.push('f.completed_at IS NOT NULL');
      break;
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows: countRows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM crm_followup f
       LEFT JOIN crm_opportunity o ON o.id = f.opportunity_id
       LEFT JOIN crm_lead l        ON l.id = f.lead_id
     ${where}`,
    params,
  );
  const total = Number(countRows[0].count);

  const listParams = [...params, limit, offset];
  const { rows } = await db.query<FollowUpListRowRaw>(
    `SELECT
       f.id, f.opportunity_id, f.lead_id, f.owner_user_id, f.action_type, f.note,
       f.due_at, f.completed_at, f.outcome, f.created_at, f.updated_at,
       o.stage          AS opportunity_stage,
       c.full_name      AS contact_name,
       a.name           AS account_name,
       u.display_name   AS owner_name,
       CASE WHEN f.opportunity_id IS NOT NULL THEN 'opportunity' ELSE 'lead' END AS parent_kind
     FROM crm_followup f
     LEFT JOIN crm_opportunity o ON o.id = f.opportunity_id
     LEFT JOIN crm_lead l        ON l.id = f.lead_id
     JOIN crm_contact c          ON c.id = COALESCE(o.contact_id, l.contact_id)
     JOIN crm_user u             ON u.id = f.owner_user_id
     LEFT JOIN crm_account a     ON a.id = COALESCE(o.account_id, l.account_id)
     ${where}
     ORDER BY f.due_at ASC, f.created_at ASC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );

  const now = new Date();
  return {
    followUps: rows.map((row) => ({
      ...toFollowUp(row),
      parentKind: row.parent_kind,
      opportunityStage: row.opportunity_stage,
      contactName: row.contact_name,
      accountName: row.account_name,
      ownerName: row.owner_name,
      isOverdue: row.completed_at === null && row.due_at < now,
    })),
    total,
  };
}

type FollowUpListRowRaw = FollowUpRow & {
  opportunity_stage: string | null;
  contact_name: string;
  account_name: string | null;
  owner_name: string;
  parent_kind: FollowUpParentKind;
};

/** Tally of pending actions per window, for the queue header counts. */
export async function countFollowUpsByWindow(
  db: Db,
  actor: Actor,
): Promise<{ overdue: number; today: number; upcoming: number; completed: number }> {
  const params: string[] = [];
  const ownerScope = ownerScopeSql(actor, params, ['f.owner_user_id', 'o.owner_user_id', 'l.owner_user_id']);
  const scope = ownerScope ? `AND ${ownerScope}` : '';

  const { rows } = await db.query<{
    overdue: string; today: string; upcoming: string; completed: string;
  }>(
    `SELECT
       count(*) FILTER (
         WHERE f.completed_at IS NULL
           AND ${OPEN_PARENT}
           AND f.due_at < now()
       )::text AS overdue,
       count(*) FILTER (
         WHERE f.completed_at IS NULL
           AND ${OPEN_PARENT}
           AND f.due_at >= now()
           AND f.due_at < ${START_OF_TOMORROW_CAIRO_SQL}
       )::text AS today,
       count(*) FILTER (
         WHERE f.completed_at IS NULL
           AND ${OPEN_PARENT}
           AND f.due_at >= ${START_OF_TOMORROW_CAIRO_SQL}
       )::text AS upcoming,
       count(*) FILTER (WHERE f.completed_at IS NOT NULL)::text AS completed
     FROM crm_followup f
     LEFT JOIN crm_opportunity o ON o.id = f.opportunity_id
     LEFT JOIN crm_lead l        ON l.id = f.lead_id
     WHERE true ${scope}`,
    params,
  );

  return {
    overdue: Number(rows[0].overdue),
    today: Number(rows[0].today),
    upcoming: Number(rows[0].upcoming),
    completed: Number(rows[0].completed),
  };
}

/**
 * The bell's reminder: a person's OWN pending actions that are overdue or due
 * later today, on open parents only. Unlike the queue counts this is never
 * widened by role - a manager is reminded of the work assigned to them, not of
 * the whole team's.
 */
export async function countOwnDueFollowUps(
  db: Db,
  userId: string,
): Promise<{ overdue: number; today: number }> {
  const { rows } = await db.query<{ overdue: string; today: string }>(
    `SELECT
       count(*) FILTER (WHERE f.due_at < now())::text AS overdue,
       count(*) FILTER (
         WHERE f.due_at >= now() AND f.due_at < ${START_OF_TOMORROW_CAIRO_SQL}
       )::text AS today
     FROM crm_followup f
     LEFT JOIN crm_opportunity o ON o.id = f.opportunity_id
     LEFT JOIN crm_lead l        ON l.id = f.lead_id
     WHERE f.owner_user_id = $1
       AND f.completed_at IS NULL
       AND ${OPEN_PARENT}`,
    [userId],
  );
  return { overdue: Number(rows[0].overdue), today: Number(rows[0].today) };
}
