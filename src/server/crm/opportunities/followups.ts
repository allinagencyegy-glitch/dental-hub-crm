/**
 * All SQL touching crm_followup.
 *
 * A follow-up is the unit of "what happens next" on an opportunity. Rows are
 * created pending and later stamped with completed_at; they are never deleted.
 * That is what makes the timeline auditable after the deal closes - a WON or
 * LOST transition changes only crm_opportunity.stage and leaves every promise
 * and every completed action intact.
 *
 * Row scope: see pushRepScope below. A SALES_REP reaches a follow-up either as
 * its assignee or as the owner of the opportunity it belongs to.
 */
import type { Db } from '@/server/db/types';
import {
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
} from '@/server/db/transaction';
import { recordOpportunityActivity } from './repository';
import {
  isFollowUpActionType,
  ACTION_TYPE_LABELS,
  type FollowUpActionType,
} from './followup-actions';

export interface FollowUp {
  id: string;
  opportunityId: string;
  ownerUserId: string;
  actionType: FollowUpActionType;
  note: string | null;
  dueAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type FollowUpRow = {
  id: string;
  opportunity_id: string;
  owner_user_id: string;
  action_type: FollowUpActionType;
  note: string | null;
  due_at: Date;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function toFollowUp(row: FollowUpRow): FollowUp {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    ownerUserId: row.owner_user_id,
    actionType: row.action_type,
    note: row.note,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Unqualified, for `INSERT/UPDATE ... RETURNING`, where a table alias is not
// available.
const FOLLOW_UP_COLUMNS = `
  id, opportunity_id, owner_user_id, action_type, note,
  due_at, completed_at, created_at, updated_at
`;

// Qualified with the `f` alias for every SELECT. Several of these columns
// (id, owner_user_id, created_at, updated_at) also exist on crm_opportunity,
// which the authorized lookups join against - unqualified they are ambiguous.
const FOLLOW_UP_COLUMNS_F = `
  f.id, f.opportunity_id, f.owner_user_id, f.action_type, f.note,
  f.due_at, f.completed_at, f.created_at, f.updated_at
`;

type Actor = { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' };

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

/**
 * Schedules a new next action.
 *
 * The opportunity must be open: a WON or LOST deal is history, and adding a
 * pending action to it would resurrect a closed deal in every "what is due"
 * queue. Completed actions on closed deals remain readable.
 *
 * The follow-up row and its activity-feed entry land in one transaction.
 */
export async function createFollowUp(
  db: Db,
  input: {
    opportunityId: string;
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

  const transaction = await beginTransaction(db);
  const client = transaction.client;
  try {
    const { rows: oppRows } = await client.query<{ stage: string }>(
      `SELECT stage FROM crm_opportunity WHERE id = $1`,
      [input.opportunityId],
    );
    const opportunity = oppRows[0];
    if (!opportunity) throw new FollowUpNotFoundError(input.opportunityId);
    if (opportunity.stage === 'WON' || opportunity.stage === 'LOST') {
      throw new ClosedOpportunityError();
    }

    const note = input.note?.trim() || null;
    const { rows } = await client.query<FollowUpRow>(
      `INSERT INTO crm_followup (opportunity_id, owner_user_id, action_type, note, due_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${FOLLOW_UP_COLUMNS}`,
      [input.opportunityId, input.ownerUserId, input.actionType, note, input.dueAt],
    );
    const followUp = toFollowUp(rows[0]);

    await recordOpportunityActivity(client, {
      opportunityId: input.opportunityId,
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
 * completion time. The activity-feed entry lands in the same transaction.
 */
export async function completeFollowUp(
  db: Db,
  followUpId: string,
  actor: Actor,
  input: { completionNote?: string | null } = {},
): Promise<FollowUp> {
  const transaction = await beginTransaction(db);
  const client = transaction.client;
  try {
    const followUp = await findFollowUpById(client, followUpId, actor);
    if (!followUp) throw new FollowUpNotFoundError(followUpId);
    if (followUp.completedAt !== null) throw new FollowUpAlreadyCompletedError();

    const completionNote = input.completionNote?.trim() || null;
    const { rows } = await client.query<FollowUpRow>(
      `UPDATE crm_followup
          SET completed_at = now(),
              note = CASE
                WHEN $2::text IS NOT NULL THEN trim(btrim(note || E'\n' || $2::text))
                ELSE note
              END,
              updated_at = now()
        WHERE id = $1 AND completed_at IS NULL
        RETURNING ${FOLLOW_UP_COLUMNS}`,
      [followUpId, completionNote],
    );

    if (rows.length === 0) throw new FollowUpAlreadyCompletedError();
    const completed = toFollowUp(rows[0]);

    await recordOpportunityActivity(client, {
      opportunityId: completed.opportunityId,
      activityType: 'FOLLOW_UP_COMPLETED',
      description: `Follow-up completed: ${ACTION_TYPE_LABELS[completed.actionType]}`,
      metadata: {
        followUpId: completed.id,
        actionType: completed.actionType,
        completionNote,
        completedAt: completed.completedAt?.toISOString() ?? null,
      },
      actorUserId: actor.userId,
    });

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
 * Reads one follow-up within the actor's row scope.
 *
 * SALES_REP must be the assignee or the owner of the parent opportunity - a rep
 * cannot reach a colleague's opportunity by guessing an id.
 */
export async function findFollowUpById(
  db: Db,
  followUpId: string,
  actor: Actor,
): Promise<FollowUp | null> {
  let where = 'WHERE f.id = $1';
  const params: string[] = [followUpId];

  if (actor.role === 'SALES_REP') {
    where += ' AND (f.owner_user_id = $2 OR o.owner_user_id = $2)';
    params.push(actor.userId);
  }

  const { rows } = await db.query<FollowUpRow>(
    `SELECT ${FOLLOW_UP_COLUMNS_F}
       FROM crm_followup f
       JOIN crm_opportunity o ON o.id = f.opportunity_id
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

  if (actor.role === 'SALES_REP') {
    where += ' AND (f.owner_user_id = $2 OR o.owner_user_id = $2)';
    params.push(actor.userId);
  }

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

export type FollowUpWindow = 'overdue' | 'today' | 'upcoming' | 'completed';

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
 * A SALES_REP's row scope for follow-ups.
 *
 * A follow-up is scoped to its own assignee OR to the owner of the opportunity
 * it hangs off, because the two can differ: a manager may assign an action to a
 * rep on a deal owned by someone else. Scoping on the parent alone would lock
 * the assignee out of work they were explicitly given; scoping on the follow-up
 * alone would hide deal history from the person who owns the deal. This is not
 * an opportunity-visibility leak - it never exposes a deal the rep cannot open.
 */
function pushRepScope(
  clauses: string[],
  params: (string | number | Date)[],
  actor: Actor,
): void {
  if (actor.role !== 'SALES_REP') return;
  params.push(actor.userId);
  const placeholder = `$${params.length}`;
  clauses.push(
    `(f.owner_user_id = ${placeholder} OR o.owner_user_id = ${placeholder})`,
  );
}

/**
 * Closed deals keep their follow-up rows, but a pending action on a WON or
 * LOST opportunity is no longer outstanding work, so it must not sit in the
 * queue nagging the owner. It stays visible in the deal's own history.
 */
const OPEN_OPPORTUNITY = `o.stage NOT IN ('WON', 'LOST')`;

export interface ListFollowUpsOptions {
  window?: FollowUpWindow;
  ownerUserId?: string;
  limit?: number;
  offset?: number;
}

export interface FollowUpListRow extends FollowUp {
  opportunityStage: string;
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
 * Scoped to opportunities the actor may see, so the queue never leaks another
 * rep's customers.
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
      clauses.push(OPEN_OPPORTUNITY);
      clauses.push('f.completed_at IS NULL');
      clauses.push('f.due_at < now()');
      break;
    case 'today':
      clauses.push(OPEN_OPPORTUNITY);
      clauses.push('f.completed_at IS NULL');
      clauses.push('f.due_at >= now()');
      clauses.push(`f.due_at < ${START_OF_TOMORROW_CAIRO_SQL}`);
      break;
    case 'upcoming':
      clauses.push(OPEN_OPPORTUNITY);
      clauses.push('f.completed_at IS NULL');
      clauses.push(`f.due_at >= ${START_OF_TOMORROW_CAIRO_SQL}`);
      break;
    case 'completed':
      // Closed deals are not filtered here: completed history is exactly what
      // must survive a WON or LOST outcome.
      clauses.push('f.completed_at IS NOT NULL');
      break;
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows: countRows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM crm_followup f
       JOIN crm_opportunity o ON o.id = f.opportunity_id
     ${where}`,
    params,
  );
  const total = Number(countRows[0].count);

  const listParams = [...params, limit, offset];
  const { rows } = await db.query<FollowUpListRowRaw>(
    `SELECT
       f.id, f.opportunity_id, f.owner_user_id, f.action_type, f.note,
       f.due_at, f.completed_at, f.created_at, f.updated_at,
       o.stage          AS opportunity_stage,
       c.full_name      AS contact_name,
       a.name           AS account_name,
       u.display_name   AS owner_name
     FROM crm_followup f
     JOIN crm_opportunity o ON o.id = f.opportunity_id
     JOIN crm_contact c      ON c.id = o.contact_id
     JOIN crm_user u         ON u.id = f.owner_user_id
     LEFT JOIN crm_account a ON a.id = o.account_id
     ${where}
     ORDER BY f.due_at ASC, f.created_at ASC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );

  const now = new Date();
  return {
    followUps: rows.map((row) => ({
      ...toFollowUp(row),
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
  opportunity_stage: string;
  contact_name: string;
  account_name: string | null;
  owner_name: string;
};

/** Tally of pending actions per window, for the queue header counts. */
export async function countFollowUpsByWindow(
  db: Db,
  actor: Actor,
): Promise<{ overdue: number; today: number; upcoming: number; completed: number }> {
  const params: string[] = [];
  let scope = '';

  if (actor.role === 'SALES_REP') {
    scope = 'AND (f.owner_user_id = $1 OR o.owner_user_id = $1)';
    params.push(actor.userId);
  }

  const { rows } = await db.query<{
    overdue: string; today: string; upcoming: string; completed: string;
  }>(
    `SELECT
       count(*) FILTER (
         WHERE f.completed_at IS NULL
           AND ${OPEN_OPPORTUNITY}
           AND f.due_at < now()
       )::text AS overdue,
       count(*) FILTER (
         WHERE f.completed_at IS NULL
           AND ${OPEN_OPPORTUNITY}
           AND f.due_at >= now()
           AND f.due_at < ${START_OF_TOMORROW_CAIRO_SQL}
       )::text AS today,
       count(*) FILTER (
         WHERE f.completed_at IS NULL
           AND ${OPEN_OPPORTUNITY}
           AND f.due_at >= ${START_OF_TOMORROW_CAIRO_SQL}
       )::text AS upcoming,
       count(*) FILTER (WHERE f.completed_at IS NOT NULL)::text AS completed
     FROM crm_followup f
     JOIN crm_opportunity o ON o.id = f.opportunity_id
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
