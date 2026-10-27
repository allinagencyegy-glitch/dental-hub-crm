/**
 * WhatsApp intake storage: the messages customers sent, who gets the next new
 * WhatsApp lead, and the open work a further message belongs to.
 */
import type { Db } from '@/server/db/types';
import { ownerScopeSql, type Actor } from '@/server/crm/scope';
import type { WhatsAppInboundMessage } from './whatsapp-payload';

/** Who is next for a new WhatsApp lead: reps first, then team leaders, then managers. */
const ROTATION = ['SALES_REP', 'SALES_TEAM_LEADER', 'SALES_MANAGER'] as const;

/**
 * Takes turns: the active person in the first role that has anyone whose last
 * WhatsApp lead is the oldest (never having had one counts as oldest). Holds a
 * lock to the end of the transaction, so two customers writing at the same
 * moment go to two people, not the same one twice.
 */
export async function pickWhatsAppOwner(db: Db): Promise<string | null> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('crm_whatsapp.round_robin', 0))");
  for (const role of ROTATION) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT u.id
         FROM crm_user u
        WHERE u.is_active AND u.role = $1
        ORDER BY (SELECT max(m.received_at)
                    FROM crm_whatsapp_message m
                    JOIN crm_lead l ON l.id = m.lead_id
                   WHERE m.started_lead AND l.owner_user_id = u.id) ASC NULLS FIRST,
                 u.created_at ASC, u.id ASC
        LIMIT 1`,
      [role],
    );
    if (rows[0]) return rows[0].id;
  }
  return null;
}

/** The contact's deal still in progress, if any. */
export async function findOpenOpportunityForContact(
  db: Db,
  contactId: string,
): Promise<{ id: string; leadId: string; ownerUserId: string } | null> {
  const { rows } = await db.query<{ id: string; lead_id: string; owner_user_id: string }>(
    `SELECT o.id, o.lead_id, o.owner_user_id
       FROM crm_opportunity o
      WHERE o.contact_id = $1 AND o.stage NOT IN ('WON', 'LOST')
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [contactId],
  );
  const row = rows[0];
  return row ? { id: row.id, leadId: row.lead_id, ownerUserId: row.owner_user_id } : null;
}

export async function whatsAppMessageExists(db: Db, waMessageId: string): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM crm_whatsapp_message WHERE wa_message_id = $1`, [waMessageId]);
  return rows.length > 0;
}

/** Stores a message. False when it is already stored: Meta delivered it twice. */
export async function insertWhatsAppMessage(
  db: Db,
  message: WhatsAppInboundMessage,
  leadId: string,
  startedLead: boolean,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO crm_whatsapp_message
       (wa_message_id, lead_id, from_phone, profile_name, message_type, body,
        ad_headline, ad_source_url, started_lead, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (wa_message_id) DO NOTHING`,
    [
      message.waMessageId,
      leadId,
      message.fromPhone,
      message.profileName,
      message.type,
      message.body,
      message.adHeadline,
      message.adSourceUrl,
      startedLead,
      message.sentAt,
    ],
  );
  return rowCount === 1;
}

/** The number wrote on WhatsApp, so it is a WhatsApp number: the pages offer a WhatsApp link for it. */
export async function markPhoneOnWhatsApp(db: Db, contactId: string, phone: string): Promise<void> {
  await db.query(
    `UPDATE crm_contact_channel SET is_whatsapp = true, updated_at = now()
      WHERE contact_id = $1 AND channel_type = 'PHONE' AND value = $2 AND NOT is_whatsapp`,
    [contactId, phone],
  );
}

/**
 * Tells the owner the customer wrote again - once until they open the bell:
 * a customer sending five messages in a row is one thing to look at.
 */
export async function notifyCustomerMessage(
  db: Db,
  input: { recipientUserId: string; leadId: string | null; opportunityId: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO crm_notification (recipient_user_id, kind, lead_id, opportunity_id)
     SELECT $1, 'WHATSAPP_MESSAGE', $2::uuid, $3::uuid
      WHERE NOT EXISTS (
        SELECT 1 FROM crm_notification n
         WHERE n.recipient_user_id = $1 AND n.kind = 'WHATSAPP_MESSAGE' AND n.read_at IS NULL
           AND n.lead_id IS NOT DISTINCT FROM $2::uuid
           AND n.opportunity_id IS NOT DISTINCT FROM $3::uuid
      )`,
    [input.recipientUserId, input.leadId, input.opportunityId],
  );
}

export interface WhatsAppMessageEntry {
  id: string;
  type: string;
  body: string | null;
  adHeadline: string | null;
  adSourceUrl: string | null;
  sentAt: Date;
}

/** How many of the latest messages a page shows. */
export const WHATSAPP_MESSAGES_SHOWN = 100;

/**
 * The latest messages on a lead, or on the lead a deal came from, oldest first.
 * Row scope: the lead's owner or the deal's owner must be in the actor's
 * scope, so a deal handed to someone else still shows them the conversation.
 */
export async function listWhatsAppMessages(
  db: Db,
  actor: Actor,
  subject: { leadId: string } | { opportunityId: string },
): Promise<WhatsAppMessageEntry[]> {
  const params: unknown[] = ['leadId' in subject ? subject.leadId : subject.opportunityId, WHATSAPP_MESSAGES_SHOWN];
  const subjectClause = 'leadId' in subject ? 'l.id = $1' : 'o.id = $1';
  const scope = ownerScopeSql(actor, params, ['l.owner_user_id', 'o.owner_user_id']);

  const { rows } = await db.query<{
    id: string;
    message_type: string;
    body: string | null;
    ad_headline: string | null;
    ad_source_url: string | null;
    sent_at: Date;
  }>(
    `SELECT * FROM (
       SELECT m.id, m.message_type, m.body, m.ad_headline, m.ad_source_url, m.sent_at
         FROM crm_whatsapp_message m
         JOIN crm_lead l ON l.id = m.lead_id
         LEFT JOIN crm_opportunity o ON o.lead_id = l.id
        WHERE ${subjectClause}
          ${scope ? `AND ${scope}` : ''}
        ORDER BY m.sent_at DESC, m.received_at DESC
        LIMIT $2
     ) latest
     ORDER BY sent_at ASC`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.message_type,
    body: row.body,
    adHeadline: row.ad_headline,
    adSourceUrl: row.ad_source_url,
    sentAt: row.sent_at,
  }));
}
