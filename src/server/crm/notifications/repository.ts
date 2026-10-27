/**
 * In-app notifications.
 *
 * A notification is written by the same transaction as the change it reports
 * (a lead handed over, a quotation decided), so the two land together or not
 * at all. Rows hold ids, not text: the bell joins to the records they point at
 * when it is opened, so it shows the customer's current name in the reader's
 * language.
 *
 * Row scope is the recipient: every read and write here is qualified on
 * recipient_user_id, so nobody can see or mark another person's notifications.
 */
import type { Db } from '@/server/db/types';

export const NOTIFICATION_KINDS = [
  'LEAD_RECEIVED',
  'LEAD_ASSIGNED',
  'OPPORTUNITY_ASSIGNED',
  'FOLLOW_UP_ASSIGNED',
  'QUOTATION_ACCEPTED',
  'QUOTATION_REJECTED',
  'WHATSAPP_LEAD',
  'WHATSAPP_MESSAGE',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationInput {
  recipientUserId: string;
  kind: NotificationKind;
  actorUserId: string | null;
  leadId?: string | null;
  opportunityId?: string | null;
  followUpId?: string | null;
  quotationId?: string | null;
}

/**
 * Tells one person about something. Nobody is told about their own action, so
 * a write a person makes for themselves records nothing.
 */
export async function notify(db: Db, input: NotificationInput): Promise<void> {
  if (input.recipientUserId === input.actorUserId) return;
  await db.query(
    `INSERT INTO crm_notification
       (recipient_user_id, kind, actor_user_id, lead_id, opportunity_id, followup_id, quotation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.recipientUserId,
      input.kind,
      input.actorUserId,
      input.leadId ?? null,
      input.opportunityId ?? null,
      input.followUpId ?? null,
      input.quotationId ?? null,
    ],
  );
}

/**
 * Tells every active manager and admin that a lead arrived - and the owner's
 * team leader, when the owner is on a team - except the person who entered it
 * and the lead's owner: the owner hears that the lead is theirs (LEAD_ASSIGNED)
 * instead, so nobody gets two notices for one lead. A lead that wrote in on
 * WhatsApp is a WHATSAPP_LEAD notice, since nobody entered it.
 */
export async function notifyLeadReceived(
  db: Db,
  input: { leadId: string; ownerUserId: string; actorUserId: string | null; kind?: 'LEAD_RECEIVED' | 'WHATSAPP_LEAD' },
): Promise<void> {
  await db.query(
    `INSERT INTO crm_notification (recipient_user_id, kind, actor_user_id, lead_id)
     SELECT u.id, $4, $2::uuid, $1
       FROM crm_user u
      WHERE u.is_active
        AND (
          u.role IN ('ADMIN', 'SALES_MANAGER')
          OR u.id = (SELECT owner.team_leader_id FROM crm_user owner WHERE owner.id = $3)
        )
        AND u.id <> $3
        AND u.id IS DISTINCT FROM $2::uuid`,
    [input.leadId, input.actorUserId, input.ownerUserId, input.kind ?? 'LEAD_RECEIVED'],
  );
}

export interface NotificationEntry {
  id: string;
  kind: NotificationKind;
  createdAt: Date;
  readAt: Date | null;
  actorName: string | null;
  /** The clinic when there is one, else the person. */
  customerName: string | null;
  leadId: string | null;
  opportunityId: string | null;
  quotationId: string | null;
  quoteNumber: string | null;
  followUpActionType: string | null;
  followUpDueAt: Date | null;
}

type NotificationRow = {
  id: string;
  kind: NotificationKind;
  created_at: Date;
  read_at: Date | null;
  actor_name: string | null;
  customer_name: string | null;
  lead_id: string | null;
  opportunity_id: string | null;
  quotation_id: string | null;
  quote_number: string | null;
  action_type: string | null;
  due_at: Date | null;
};

/** A person's latest notifications, newest first. */
export async function listNotifications(
  db: Db,
  recipientUserId: string,
  limit = 20,
): Promise<NotificationEntry[]> {
  // A follow-up or quotation notice opens the deal or lead it belongs to, so
  // the parent ids are resolved through those rows.
  const { rows } = await db.query<NotificationRow>(
    `SELECT n.id, n.kind, n.created_at, n.read_at,
            a.display_name AS actor_name,
            COALESCE(acc.name, c.full_name) AS customer_name,
            COALESCE(n.lead_id, f.lead_id) AS lead_id,
            COALESCE(n.opportunity_id, f.opportunity_id, q.opportunity_id) AS opportunity_id,
            n.quotation_id, q.quote_number,
            f.action_type, f.due_at
       FROM crm_notification n
       LEFT JOIN crm_user a          ON a.id = n.actor_user_id
       LEFT JOIN crm_followup f      ON f.id = n.followup_id
       LEFT JOIN crm_quotation q     ON q.id = n.quotation_id
       LEFT JOIN crm_opportunity o   ON o.id = COALESCE(n.opportunity_id, f.opportunity_id, q.opportunity_id)
       LEFT JOIN crm_lead l          ON l.id = COALESCE(n.lead_id, f.lead_id)
       LEFT JOIN crm_contact c       ON c.id = COALESCE(o.contact_id, l.contact_id)
       LEFT JOIN crm_account acc     ON acc.id = COALESCE(o.account_id, l.account_id)
      WHERE n.recipient_user_id = $1
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT $2`,
    [recipientUserId, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    createdAt: row.created_at,
    readAt: row.read_at,
    actorName: row.actor_name,
    customerName: row.customer_name,
    leadId: row.lead_id,
    opportunityId: row.opportunity_id,
    quotationId: row.quotation_id,
    quoteNumber: row.quote_number,
    followUpActionType: row.action_type,
    followUpDueAt: row.due_at,
  }));
}

/** How many of a person's notifications they have not read. */
export async function countUnreadNotifications(db: Db, recipientUserId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM crm_notification
      WHERE recipient_user_id = $1 AND read_at IS NULL`,
    [recipientUserId],
  );
  return Number(rows[0].count);
}

/** Marks one of a person's notifications read. Another person's id matches nothing. */
export async function markNotificationRead(db: Db, recipientUserId: string, notificationId: string): Promise<void> {
  await db.query(
    `UPDATE crm_notification SET read_at = now()
      WHERE id = $1 AND recipient_user_id = $2 AND read_at IS NULL`,
    [notificationId, recipientUserId],
  );
}

/** Marks every notification a person has read. */
export async function markAllNotificationsRead(db: Db, recipientUserId: string): Promise<void> {
  await db.query(
    `UPDATE crm_notification SET read_at = now()
      WHERE recipient_user_id = $1 AND read_at IS NULL`,
    [recipientUserId],
  );
}
