/**
 * All SQL touching crm_opportunity.
 *
 * Row-scope authorization is enforced at the query layer, not in the UI:
 * SALES_REP sees only opportunities they own; SALES_MANAGER and ADMIN see all.
 * A row the actor may not see reads as absent (null / not found), so an
 * unauthorised lookup cannot be used to discover that a record exists.
 */
import type { Db } from '@/server/db/types';
import {
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
} from '@/server/db/transaction';
import { likePattern } from '@/server/db/like';
import { notify } from '@/server/crm/notifications/repository';
import {
  canTransition,
  isOpportunityStage,
  STAGE_LABELS,
  type OpportunityStage,
} from './stage';

export type OpportunityStageFilter = OpportunityStage | 'OPEN' | 'ALL' | 'WON' | 'LOST';

export interface Opportunity {
  id: string;
  leadId: string;
  contactId: string;
  accountId: string | null;
  ownerUserId: string;
  productCategoryId: string | null;
  stage: OpportunityStage;
  /** numeric(14,2) arrives from pg as a string; parsed to a number here. */
  estimatedValue: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  wonAt: Date | null;
  lostAt: Date | null;
  lostReasonId: string | null;
}

export interface StageHistoryEntry {
  id: string;
  opportunityId: string;
  fromStage: OpportunityStage | null;
  toStage: OpportunityStage;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: Date;
  note: string | null;
}

type OpportunityRow = {
  id: string;
  lead_id: string;
  contact_id: string;
  account_id: string | null;
  owner_user_id: string;
  product_category_id: string | null;
  stage: OpportunityStage;
  estimated_value: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  won_at: Date | null;
  lost_at: Date | null;
  lost_reason_id: string | null;
};

function toOpportunity(row: OpportunityRow): Opportunity {
  return {
    id: row.id,
    leadId: row.lead_id,
    contactId: row.contact_id,
    accountId: row.account_id,
    ownerUserId: row.owner_user_id,
    productCategoryId: row.product_category_id,
    stage: row.stage,
    estimatedValue: row.estimated_value === null ? null : Number(row.estimated_value),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    wonAt: row.won_at,
    lostAt: row.lost_at,
    lostReasonId: row.lost_reason_id,
  };
}

const OPPORTUNITY_COLUMNS = `
  id, lead_id, contact_id, account_id, owner_user_id, product_category_id,
  stage, estimated_value, notes, created_at, updated_at,
  won_at, lost_at, lost_reason_id
`;

export class OpportunityNotFoundError extends Error {
  constructor(id: string) {
    super(`Opportunity ${id} not found.`);
    this.name = 'OpportunityNotFoundError';
  }
}

export class InvalidStageTransitionError extends Error {
  constructor(from: OpportunityStage, to: OpportunityStage) {
    super(`Invalid opportunity stage transition: ${from} → ${to}.`);
    this.name = 'InvalidStageTransitionError';
  }
}

export class UnknownStageError extends Error {
  constructor(stage: string) {
    super(`Unknown opportunity stage: ${stage}.`);
    this.name = 'UnknownStageError';
  }
}

export class LeadAlreadyQualifiedError extends Error {
  constructor(leadId: string) {
    super(`Lead ${leadId} has already been qualified into an opportunity.`);
    this.name = 'LeadAlreadyQualifiedError';
  }
}

export class LostReasonRequiredError extends Error {
  constructor() {
    super('Losing an opportunity requires a reason.');
    this.name = 'LostReasonRequiredError';
  }
}

function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== '23505') {
    return false;
  }
  if (constraint === undefined) return true;
  return 'constraint' in error && error.constraint === constraint;
}

/**
 * Creates an opportunity from a qualified lead.
 *
 * crm_opportunity.lead_id is UNIQUE, so a second qualification of the same lead
 * is refused by the database. That race is caught here and reported as
 * LeadAlreadyQualifiedError rather than surfacing as a raw constraint violation.
 */
export async function createOpportunity(
  db: Db,
  input: {
    leadId: string;
    contactId: string;
    accountId: string | null;
    ownerUserId: string;
    productCategoryId: string | null;
    estimatedValue?: number | null;
    notes?: string | null;
  },
): Promise<Opportunity> {
  const notes = input.notes?.trim() || null;

  try {
    const { rows } = await db.query<OpportunityRow>(
      `INSERT INTO crm_opportunity (
         lead_id, contact_id, account_id, owner_user_id, product_category_id,
         stage, estimated_value, notes
       ) VALUES ($1, $2, $3, $4, $5, 'QUALIFIED', $6, $7)
       RETURNING ${OPPORTUNITY_COLUMNS}`,
      [
        input.leadId,
        input.contactId,
        input.accountId,
        input.ownerUserId,
        input.productCategoryId,
        input.estimatedValue ?? null,
        notes,
      ],
    );
    return toOpportunity(rows[0]);
  } catch (error) {
    if (isUniqueViolation(error, 'crm_opportunity_lead_id_key')) {
      throw new LeadAlreadyQualifiedError(input.leadId);
    }
    throw error;
  }
}

/**
 * Finds one opportunity within the actor's row scope.
 * Returns null when the row is missing OR owned by someone else - the two cases
 * are deliberately indistinguishable to the caller.
 */
export async function findOpportunityById(
  db: Db,
  opportunityId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
): Promise<Opportunity | null> {
  let where = 'WHERE id = $1';
  const params: string[] = [opportunityId];

  if (actor.role === 'SALES_REP') {
    where += ' AND owner_user_id = $2';
    params.push(actor.userId);
  }

  const { rows } = await db.query<OpportunityRow>(
    `SELECT ${OPPORTUNITY_COLUMNS} FROM crm_opportunity ${where}`,
    params,
  );

  return rows[0] ? toOpportunity(rows[0]) : null;
}

export async function findOpportunityByLeadId(
  db: Db,
  leadId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
): Promise<Opportunity | null> {
  let where = 'WHERE lead_id = $1';
  const params: string[] = [leadId];

  if (actor.role === 'SALES_REP') {
    where += ' AND owner_user_id = $2';
    params.push(actor.userId);
  }

  const { rows } = await db.query<OpportunityRow>(
    `SELECT ${OPPORTUNITY_COLUMNS} FROM crm_opportunity ${where}`,
    params,
  );

  return rows[0] ? toOpportunity(rows[0]) : null;
}

export interface ListOpportunitiesOptions {
  stage?: OpportunityStageFilter;
  ownerUserId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Lists opportunities in the actor's row scope, with each row's next pending
 * follow-up attached.
 *
 * The next action is resolved with a correlated LATERAL join picking the
 * pending follow-up with the earliest due_at, so the list answers "what is due
 * next" in one round trip rather than N+1 lookups.
 */
export async function listOpportunities(
  db: Db,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
  options: ListOpportunitiesOptions = {},
): Promise<{ opportunities: OpportunityListRow[]; total: number }> {
  const { stage, search, limit = 50, offset = 0 } = options;

  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (actor.role === 'SALES_REP') {
    params.push(actor.userId);
    clauses.push(`o.owner_user_id = $${params.length}`);
  }

  // An explicit owner filter is a manager narrowing the team view. A rep asking
  // for another rep's rows still gets nothing, because the row-scope clause above
  // is ANDed with this one.
  if (options.ownerUserId) {
    params.push(options.ownerUserId);
    clauses.push(`o.owner_user_id = $${params.length}`);
  }

  if (stage === 'OPEN') {
    clauses.push(`o.stage NOT IN ('WON', 'LOST')`);
  } else if (stage === 'ALL') {
    // no clause
  } else if (stage === 'WON' || stage === 'LOST') {
    params.push(stage);
    clauses.push(`o.stage = $${params.length}`);
  } else if (stage !== undefined) {
    if (!isOpportunityStage(stage)) throw new UnknownStageError(String(stage));
    params.push(stage);
    clauses.push(`o.stage = $${params.length}`);
  }

  if (search !== undefined && search.trim() !== '') {
    const pattern = likePattern(search.trim());
    const placeholder = `$${params.length + 1}`;
    clauses.push(`(
      c.full_name ILIKE ${placeholder} ESCAPE '\\'
      OR COALESCE(a.name, '') ILIKE ${placeholder} ESCAPE '\\'
      OR u.display_name ILIKE ${placeholder} ESCAPE '\\'
      OR o.id::text LIKE ${placeholder} ESCAPE '\\'
    )`);
    params.push(pattern);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows: countRows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM crm_opportunity o
       JOIN crm_user u ON u.id = o.owner_user_id
       JOIN crm_contact c ON c.id = o.contact_id
       LEFT JOIN crm_account a ON a.id = o.account_id
     ${where}`,
    params,
  );
  const total = Number(countRows[0].count);

  const listParams = [...params, limit, offset];
  const { rows } = await db.query<OpportunityListRowRaw>(
    `SELECT
       o.id, o.lead_id, o.contact_id, o.account_id, o.owner_user_id,
       o.product_category_id, o.stage, o.estimated_value, o.notes,
       o.created_at, o.updated_at, o.won_at, o.lost_at, o.lost_reason_id,
       u.display_name AS owner_name,
       c.full_name    AS contact_name,
       c.email        AS contact_email,
       a.name         AS account_name,
       pc.name        AS product_category_name,
       f.id           AS next_action_id,
       f.action_type  AS next_action_type,
       f.note         AS next_action_note,
       f.due_at       AS next_action_due_at
     FROM crm_opportunity o
     JOIN crm_user u  ON u.id = o.owner_user_id
     JOIN crm_contact c ON c.id = o.contact_id
     LEFT JOIN crm_account a ON a.id = o.account_id
     LEFT JOIN crm_product_category pc ON pc.id = o.product_category_id
     LEFT JOIN LATERAL (
       SELECT id, action_type, note, due_at
         FROM crm_followup
        WHERE opportunity_id = o.id AND completed_at IS NULL
        ORDER BY due_at ASC, created_at ASC
        LIMIT 1
     ) f ON true
     ${where}
     ORDER BY o.updated_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );

  return { opportunities: rows.map(toOpportunityListRow), total };
}

type OpportunityListRowRaw = OpportunityRow & {
  owner_name: string;
  contact_name: string;
  contact_email: string | null;
  account_name: string | null;
  product_category_name: string | null;
  next_action_id: string | null;
  next_action_type: string | null;
  next_action_note: string | null;
  next_action_due_at: Date | null;
};

/** An opportunity plus the denormalised labels and current next action the list UI shows. */
export interface OpportunityListRow extends Opportunity {
  ownerName: string;
  contactName: string;
  contactEmail: string | null;
  accountName: string | null;
  productCategoryName: string | null;
  nextAction: NextActionSummary | null;
}

export interface NextActionSummary {
  id: string;
  actionType: string;
  note: string | null;
  dueAt: Date;
  isOverdue: boolean;
}

function toNextAction(row: OpportunityListRowRaw, now: Date): NextActionSummary | null {
  if (!row.next_action_id || row.next_action_due_at === null) return null;
  return {
    id: row.next_action_id,
    actionType: row.next_action_type ?? 'OTHER',
    note: row.next_action_note,
    dueAt: row.next_action_due_at,
    isOverdue: row.next_action_due_at < now,
  };
}

function toOpportunityListRow(row: OpportunityListRowRaw): OpportunityListRow {
  return {
    ...toOpportunity(row),
    ownerName: row.owner_name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    accountName: row.account_name,
    productCategoryName: row.product_category_name,
    nextAction: toNextAction(row, new Date()),
  };
}

export interface OpportunityDetail extends Opportunity {
  ownerName: string;
  ownerEmail: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contactPhoneIsWhatsApp: boolean;
  accountName: string | null;
  productCategoryName: string | null;
  productCategoryCode: string | null;
  lostReasonLabel: string | null;
  lostReasonCode: string | null;
  leadStatus: string;
  leadSourceName: string;
  leadSourceCode: string;
  leadReceivedAt: Date;
}

type OpportunityDetailRaw = OpportunityRow & {
  owner_name: string;
  owner_email: string;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  contact_phone_is_whatsapp: boolean;
  account_name: string | null;
  product_category_name: string | null;
  product_category_code: string | null;
  lost_reason_label: string | null;
  lost_reason_code: string | null;
  lead_status: string;
  lead_source_name: string;
  lead_source_code: string;
  lead_received_at: Date;
};

export async function findOpportunityDetailById(
  db: Db,
  opportunityId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
): Promise<OpportunityDetail | null> {
  let where = 'WHERE o.id = $1';
  const params: string[] = [opportunityId];

  if (actor.role === 'SALES_REP') {
    where += ' AND o.owner_user_id = $2';
    params.push(actor.userId);
  }

  const { rows } = await db.query<OpportunityDetailRaw>(
    `SELECT
       o.id, o.lead_id, o.contact_id, o.account_id, o.owner_user_id,
       o.product_category_id, o.stage, o.estimated_value, o.notes,
       o.created_at, o.updated_at, o.won_at, o.lost_at, o.lost_reason_id,
       u.display_name AS owner_name,
       u.email       AS owner_email,
       c.full_name   AS contact_name,
       c.email       AS contact_email,
       phone.value   AS contact_phone,
       COALESCE(phone.is_whatsapp, false) AS contact_phone_is_whatsapp,
       a.name        AS account_name,
       pc.name       AS product_category_name,
       pc.code       AS product_category_code,
       r.label       AS lost_reason_label,
       r.code        AS lost_reason_code,
       l.status      AS lead_status,
       l.received_at AS lead_received_at,
       s.name        AS lead_source_name,
       s.code        AS lead_source_code
     FROM crm_opportunity o
     JOIN crm_user u    ON u.id = o.owner_user_id
     JOIN crm_contact c ON c.id = o.contact_id
     JOIN crm_lead l    ON l.id = o.lead_id
     JOIN crm_source s  ON s.id = l.source_id
     LEFT JOIN crm_account a ON a.id = o.account_id
     LEFT JOIN crm_product_category pc ON pc.id = o.product_category_id
     LEFT JOIN crm_outcome_reason r ON r.id = o.lost_reason_id
     LEFT JOIN LATERAL (
       SELECT cc.value, cc.is_whatsapp
         FROM crm_contact_channel cc
        WHERE cc.contact_id = c.id AND cc.channel_type = 'PHONE' AND cc.is_active = true
        ORDER BY cc.created_at ASC, cc.id ASC
        LIMIT 1
     ) phone ON true
     ${where}`,
    params,
  );

  const row = rows[0];
  if (!row) return null;

  return {
    ...toOpportunity(row),
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    contactPhoneIsWhatsApp: row.contact_phone_is_whatsapp,
    accountName: row.account_name,
    productCategoryName: row.product_category_name,
    productCategoryCode: row.product_category_code,
    lostReasonLabel: row.lost_reason_label,
    lostReasonCode: row.lost_reason_code,
    leadStatus: row.lead_status,
    leadSourceName: row.lead_source_name,
    leadSourceCode: row.lead_source_code,
    leadReceivedAt: row.lead_received_at,
  };
}

export interface ChangeStageInput {
  toStage: OpportunityStage;
  lostReasonId?: string | null;
  lostNote?: string | null;
}

/**
 * Moves an opportunity to a new stage.
 *
 * Transition legality is checked against STAGE_TRANSITIONS before any write.
 * Entering WON stamps won_at; entering LOST stamps lost_at and requires a
 * reason; leaving a closed deal is impossible because both terminal stages have
 * no outgoing transitions. No follow-up row is ever touched here - closing a
 * deal does not erase its history, it only stops being editable.
 */
export async function changeOpportunityStage(
  db: Db,
  opportunityId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
  input: ChangeStageInput,
): Promise<Opportunity> {
  // The stage write and its history row must land together: a transition that
  // moved the deal but failed to record why would break the audit trail, and a
  // history row for a move that did not happen would be worse. A single
  // transaction also takes a row lock, so two concurrent stage changes cannot
  // both validate against the same stale stage and skip a step.
  const transaction = await beginTransaction(db);
  const client = transaction.client;
  try {
    const current = await findOpportunityById(client, opportunityId, actor);
    if (!current) throw new OpportunityNotFoundError(opportunityId);

    const to = input.toStage;
    if (!isOpportunityStage(to)) throw new UnknownStageError(String(to));

    if (current.stage === to) {
      throw new InvalidStageTransitionError(current.stage, to);
    }
    if (!canTransition(current.stage, to)) {
      throw new InvalidStageTransitionError(current.stage, to);
    }

    if (to === 'LOST') {
      if (!input.lostReasonId) throw new LostReasonRequiredError();

      const { rows } = await client.query<{
        id: string; kind: string; is_active: boolean; requires_note: boolean;
      }>(
        `SELECT id, kind, is_active, requires_note FROM crm_outcome_reason WHERE id = $1`,
        [input.lostReasonId],
      );
      const reason = rows[0];
      if (!reason) throw new LostReasonRequiredError();
      if (reason.kind !== 'lost') throw new LostReasonRequiredError();
      if (!reason.is_active) throw new LostReasonRequiredError();
      if (reason.requires_note && !input.lostNote?.trim()) {
        throw new LostReasonRequiredError();
      }
    }

    // won_at / lost_at / lost_reason_id are written together with the stage, so
    // the CHECK constraints in 0006 hold at every point of the write rather than
    // needing a second statement to clean up.
    const { rows } = await client.query<OpportunityRow>(
      `UPDATE crm_opportunity
          SET stage = $2,
              won_at = CASE WHEN $2 = 'WON' THEN now() ELSE NULL END,
              lost_at = CASE WHEN $2 = 'LOST' THEN now() ELSE NULL END,
              lost_reason_id = CASE WHEN $2 = 'LOST' THEN $3::uuid ELSE NULL END,
              notes = CASE
                WHEN $2 = 'LOST' AND $4::text IS NOT NULL
                  THEN trim(btrim(notes || E'\n' || $4::text))
                ELSE notes
              END,
              updated_at = now()
        WHERE id = $1
        RETURNING ${OPPORTUNITY_COLUMNS}`,
      [
        opportunityId,
        to,
        to === 'LOST' ? input.lostReasonId : null,
        to === 'LOST' ? input.lostNote ?? null : null,
      ],
    );

    await recordStageChange(client, {
      opportunityId,
      fromStage: current.stage,
      toStage: to,
      changedBy: actor.userId,
      note: to === 'LOST' ? input.lostNote ?? null : null,
    });

    await commitTransaction(client);
    return toOpportunity(rows[0]);
  } catch (error) {
    await rollbackTransaction(client);
    throw error;
  } finally {
    transaction.release();
  }
}

/** Appends one stage transition to the audit trail. Never updates or deletes. */
export async function recordStageChange(
  db: Db,
  entry: {
    opportunityId: string;
    fromStage: OpportunityStage | null;
    toStage: OpportunityStage;
    changedBy: string | null;
    note?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO crm_opportunity_stage_history
       (opportunity_id, from_stage, to_stage, changed_by, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      entry.opportunityId,
      entry.fromStage,
      entry.toStage,
      entry.changedBy,
      entry.note ?? null,
    ],
  );

  // The same move lands in the unified activity feed (0007). The opening move
  // is the qualification event: from_stage is null, so it reads "Qualified".
  await recordOpportunityActivity(db, {
    opportunityId: entry.opportunityId,
    activityType: 'STAGE_CHANGE',
    description:
      entry.fromStage === null
        ? 'Qualified into an opportunity'
        : `Stage moved ${STAGE_LABELS[entry.fromStage]} → ${STAGE_LABELS[entry.toStage]}`,
    metadata: { fromStage: entry.fromStage, toStage: entry.toStage, note: entry.note ?? null },
    actorUserId: entry.changedBy,
  });
}

// ---------------------------------------------------------------------------
// Opportunity activity feed (crm_opportunity_activity from migration 0007)
//
// The activity table is the durable, append-only interaction log for an
// opportunity: what happened, who did it and when. Stage history keeps its own
// dedicated audit table; follow-ups stay actionable rows. The feed unifies
// both, plus events nothing else records (owner change, notes update).
// ---------------------------------------------------------------------------

export type OpportunityActivityType =
  | 'STAGE_CHANGE'
  | 'FOLLOW_UP_CREATED'
  | 'FOLLOW_UP_COMPLETED'
  | 'FOLLOW_UP_RESCHEDULED'
  | 'FOLLOW_UP_MOVED'
  | 'NOTE_ADDED'
  | 'OWNER_CHANGED'
  | 'QUOTATION_CREATED'
  | 'QUOTATION_REVISED'
  | 'QUOTATION_SENT'
  | 'QUOTATION_ACCEPTED'
  | 'QUOTATION_REJECTED'
  | 'QUOTATION_EXPIRED';

export interface OpportunityActivityEntry {
  id: string;
  opportunityId: string;
  activityType: OpportunityActivityType;
  description: string;
  metadata: Record<string, unknown> | null;
  actorUserId: string | null;
  actorName: string | null;
  createdAt: Date;
}

/** Appends one interaction to the opportunity's activity feed. */
export async function recordOpportunityActivity(
  db: Db,
  input: {
    opportunityId: string;
    activityType: OpportunityActivityType;
    description: string;
    metadata?: Record<string, unknown> | null;
    actorUserId?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO crm_opportunity_activity
       (opportunity_id, activity_type, description, metadata, actor_user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.opportunityId,
      input.activityType,
      input.description,
      input.metadata ?? null,
      input.actorUserId ?? null,
    ],
  );
}

type OpportunityActivityRow = {
  id: string;
  opportunity_id: string;
  activity_type: OpportunityActivityType;
  description: string;
  metadata: Record<string, unknown> | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: Date;
};

/**
 * The full interaction feed of an opportunity, newest first.
 *
 * Authorised against the opportunity first: an actor who cannot see the deal
 * gets an empty feed, exactly like the stage history.
 */
export async function listOpportunityActivity(
  db: Db,
  opportunityId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
): Promise<OpportunityActivityEntry[]> {
  const opportunity = await findOpportunityById(db, opportunityId, actor);
  if (!opportunity) return [];

  const { rows } = await db.query<OpportunityActivityRow>(
    `SELECT a.id, a.opportunity_id, a.activity_type, a.description,
            a.metadata, a.actor_user_id, u.display_name AS actor_name, a.created_at
       FROM crm_opportunity_activity a
       LEFT JOIN crm_user u ON u.id = a.actor_user_id
      WHERE a.opportunity_id = $1
      ORDER BY a.created_at DESC, a.id DESC`,
    [opportunityId],
  );

  return rows.map((row) => ({
    id: row.id,
    opportunityId: row.opportunity_id,
    activityType: row.activity_type,
    description: row.description,
    metadata: row.metadata,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    createdAt: row.created_at,
  }));
}

/** The full stage history of an opportunity, oldest first. */
export async function listStageHistory(
  db: Db,
  opportunityId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
): Promise<StageHistoryEntry[]> {
  // Authorise against the opportunity first: history must not outlive the
  // row-scope rules, or a rep could read a colleague's deal timeline by id.
  const opportunity = await findOpportunityById(db, opportunityId, actor);
  if (!opportunity) return [];

  const { rows } = await db.query<{
    id: string;
    opportunity_id: string;
    from_stage: OpportunityStage | null;
    to_stage: OpportunityStage;
    changed_by: string | null;
    changed_by_name: string | null;
    changed_at: Date;
    note: string | null;
  }>(
    `SELECT h.id, h.opportunity_id, h.from_stage, h.to_stage,
            h.changed_by, u.display_name AS changed_by_name, h.changed_at, h.note
       FROM crm_opportunity_stage_history h
       LEFT JOIN crm_user u ON u.id = h.changed_by
      WHERE h.opportunity_id = $1
      ORDER BY h.changed_at ASC, h.id ASC`,
    [opportunityId],
  );

  return rows.map((row) => ({
    id: row.id,
    opportunityId: row.opportunity_id,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    changedBy: row.changed_by,
    changedByName: row.changed_by_name,
    changedAt: row.changed_at,
    note: row.note,
  }));
}

export interface UpdateOpportunityInput {
  estimatedValue?: number | null;
  notes?: string | null;
  productCategoryId?: string | null;
}

/** Updates the mutable commercial fields of an opportunity. */
export async function updateOpportunity(
  db: Db,
  opportunityId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
  input: UpdateOpportunityInput,
): Promise<Opportunity> {
  const existing = await findOpportunityById(db, opportunityId, actor);
  if (!existing) throw new OpportunityNotFoundError(opportunityId);

  const updates: string[] = [];
  const params: (string | number | null)[] = [opportunityId];
  let next = 2;

  if (input.estimatedValue !== undefined) {
    if (input.estimatedValue !== null && input.estimatedValue < 0) {
      throw new Error('ESTIMATED_VALUE_INVALID');
    }
    updates.push(`estimated_value = $${next++}`);
    params.push(input.estimatedValue);
  }
  let notesChanged = false;
  let newNotes: string | null = existing.notes;
  if (input.notes !== undefined) {
    newNotes = input.notes?.trim() || null;
    notesChanged = newNotes !== (existing.notes ?? null);
    updates.push(`notes = $${next++}`);
    params.push(newNotes);
  }
  if (input.productCategoryId !== undefined) {
    if (input.productCategoryId !== null) {
      const { rows } = await db.query<{ is_active: boolean }>(
        `SELECT is_active FROM crm_product_category WHERE id = $1`,
        [input.productCategoryId],
      );
      if (!rows[0] || !rows[0].is_active) throw new Error('CATEGORY_NOT_FOUND');
    }
    updates.push(`product_category_id = $${next++}`);
    params.push(input.productCategoryId);
  }

  if (updates.length === 0) return existing;

  updates.push('updated_at = now()');
  const { rows } = await db.query<OpportunityRow>(
    `UPDATE crm_opportunity SET ${updates.join(', ')} WHERE id = $1 RETURNING ${OPPORTUNITY_COLUMNS}`,
    params,
  );

  if (notesChanged) {
    await recordOpportunityActivity(db, {
      opportunityId,
      activityType: 'NOTE_ADDED',
      description: 'Sales notes updated',
      metadata: { note: newNotes },
      actorUserId: actor.userId,
    });
  }

  return toOpportunity(rows[0]);
}

/**
 * Reassigns an opportunity's owner.
 *
 * Manager/admin only. The new owner must be an active SALES_REP or
 * SALES_MANAGER - the same rule lead ownership already uses, so an admin or a
 * finance user can never become a sales owner.
 */
export async function reassignOpportunityOwner(
  db: Db,
  opportunityId: string,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
  newOwnerUserId: string,
): Promise<Opportunity> {
  if (actor.role === 'SALES_REP') {
    throw new Error('UNAUTHORISED');
  }

  const existing = await findOpportunityById(db, opportunityId, actor);
  if (!existing) throw new OpportunityNotFoundError(opportunityId);

  const { rows: ownerRows } = await db.query<{ id: string; is_active: boolean; role: string; display_name: string }>(
    `SELECT id, is_active, role, display_name FROM crm_user WHERE id = $1`,
    [newOwnerUserId],
  );
  const owner = ownerRows[0];
  if (!owner || !owner.is_active) throw new Error('OWNER_NOT_FOUND');
  if (owner.role !== 'SALES_REP' && owner.role !== 'SALES_MANAGER') {
    throw new Error('OWNER_NOT_FOUND');
  }

  const { rows } = await db.query<OpportunityRow>(
    `UPDATE crm_opportunity SET owner_user_id = $2, updated_at = now()
      WHERE id = $1 RETURNING ${OPPORTUNITY_COLUMNS}`,
    [opportunityId, newOwnerUserId],
  );

  await recordOpportunityActivity(db, {
    opportunityId,
    activityType: 'OWNER_CHANGED',
    description: `Owner changed to ${owner.display_name}`,
    metadata: {
      fromOwnerUserId: existing.ownerUserId,
      toOwnerUserId: newOwnerUserId,
      toOwnerName: owner.display_name,
    },
    actorUserId: actor.userId,
  });

  if (existing.ownerUserId !== newOwnerUserId) {
    await notify(db, {
      recipientUserId: newOwnerUserId,
      kind: 'OPPORTUNITY_ASSIGNED',
      actorUserId: actor.userId,
      opportunityId,
    });
  }

  return toOpportunity(rows[0]);
}

/** Stage counts for the pipeline header. Not a dashboard - just a row tally. */
export async function countOpportunitiesByStage(
  db: Db,
  actor: { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' },
): Promise<Record<string, number>> {
  const params: string[] = [];
  let where = '';

  if (actor.role === 'SALES_REP') {
    params.push(actor.userId);
    where = 'WHERE owner_user_id = $1';
  }

  const { rows } = await db.query<{ stage: string; count: string }>(
    `SELECT stage, count(*)::text AS count FROM crm_opportunity ${where} GROUP BY stage`,
    params,
  );

  return Object.fromEntries(rows.map((row) => [row.stage, Number(row.count)]));
}
