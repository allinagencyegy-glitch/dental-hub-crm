/**
 * WhatsApp intake: a customer writing to the company's WhatsApp number lands
 * in the CRM by itself.
 *
 *   a new customer         -> a new WhatsApp lead, given to the next person in
 *                             turn (see pickWhatsAppOwner); the owner, the
 *                             managers and the owner's team leader are told
 *   a lead being worked    -> the message is added to it; its owner is told
 *   a deal in progress     -> added to the lead the deal came from; the deal's
 *                             owner is told
 *
 * Receive-only: nothing here sends anything to the customer. People reply from
 * WhatsApp as they do today.
 *
 * Meta delivers at least once and retries a failed delivery for days, so a
 * message is stored under its WhatsApp id and a repeat changes nothing. Each
 * message is its own transaction: a failure leaves the ones before it stored,
 * and Meta's retry fills in the rest.
 */
import { db as defaultDb } from '@/server/db/client';
import type { Db } from '@/server/db/types';
import { beginTransaction, commitTransaction, rollbackTransaction } from '@/server/db/transaction';
import { findSourceByCode } from '@/server/crm/catalog/repository';
import {
  createLead,
  findOpenLeadForContact,
  lockContactLeads,
  resolveOrCreateContact,
  resolvePrimaryAccount,
} from '@/server/crm/leads/repository';
import { notify, notifyLeadReceived } from '@/server/crm/notifications/repository';
import { isValidMetaSignature } from './meta-signature';
import { parseWhatsAppWebhook, type WhatsAppInboundMessage } from './whatsapp-payload';
import {
  findOpenOpportunityForContact,
  insertWhatsAppMessage,
  markPhoneOnWhatsApp,
  notifyCustomerMessage,
  pickWhatsAppOwner,
  whatsAppMessageExists,
} from './repository';

export interface WhatsAppConfig {
  /** Meta app secret: checks that a delivery really came from Meta. */
  appSecret: string;
  /** The token typed into Meta's webhook settings, echoed back once to prove the URL is ours. */
  verifyToken: string;
  /** The company number to listen to. Messages to any other number on the same app are ignored. */
  phoneNumberId: string;
}

/** WhatsApp intake is on only when all three settings are present. */
export function whatsAppConfig(env: Record<string, string | undefined> = process.env): WhatsAppConfig | null {
  const appSecret = env.WHATSAPP_APP_SECRET?.trim();
  const verifyToken = env.WHATSAPP_VERIFY_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  return appSecret && verifyToken && phoneNumberId ? { appSecret, verifyToken, phoneNumberId } : null;
}

export type WhatsAppIntakeOutcome =
  | { outcome: 'NEW_LEAD'; leadId: string; ownerUserId: string }
  | { outcome: 'ADDED_TO_LEAD'; leadId: string }
  | { outcome: 'ADDED_TO_OPPORTUNITY'; leadId: string; opportunityId: string }
  | { outcome: 'DUPLICATE' };

export class NoWhatsAppOwnerError extends Error {
  constructor() {
    super('No active sales user to give a WhatsApp lead to.');
    this.name = 'NoWhatsAppOwnerError';
  }
}

export async function receiveWhatsAppMessage(db: Db, message: WhatsAppInboundMessage): Promise<WhatsAppIntakeOutcome> {
  if (await whatsAppMessageExists(db, message.waMessageId)) return { outcome: 'DUPLICATE' };

  // Outside the transaction, like a lead typed in by hand: it settles a race
  // for the same number by re-reading, which an aborted transaction cannot.
  const { contactId } = await resolveOrCreateContact(db, {
    fullName: message.profileName ?? message.fromPhone,
    phone: message.fromPhone,
  });

  const tx = await beginTransaction(db);
  try {
    const client = tx.client;
    // The same lock a hand-typed lead takes, so a customer writing while a
    // rep enters them still ends up with one lead.
    await lockContactLeads(client, contactId);
    if (await whatsAppMessageExists(client, message.waMessageId)) {
      await rollbackTransaction(client);
      return { outcome: 'DUPLICATE' };
    }

    let result: WhatsAppIntakeOutcome;
    const openLead = await findOpenLeadForContact(client, contactId);
    const openDeal = openLead ? null : await findOpenOpportunityForContact(client, contactId);

    if (openLead) {
      await insertWhatsAppMessage(client, message, openLead.id, false);
      await notifyCustomerMessage(client, { recipientUserId: openLead.ownerUserId, leadId: openLead.id, opportunityId: null });
      result = { outcome: 'ADDED_TO_LEAD', leadId: openLead.id };
    } else if (openDeal) {
      await insertWhatsAppMessage(client, message, openDeal.leadId, false);
      await notifyCustomerMessage(client, { recipientUserId: openDeal.ownerUserId, leadId: null, opportunityId: openDeal.id });
      result = { outcome: 'ADDED_TO_OPPORTUNITY', leadId: openDeal.leadId, opportunityId: openDeal.id };
    } else {
      const ownerUserId = await pickWhatsAppOwner(client);
      if (!ownerUserId) throw new NoWhatsAppOwnerError();
      const source = await findSourceByCode(client, 'whatsapp');
      if (!source) throw new Error('The whatsapp lead source is missing.');

      const lead = await createLead(client, {
        sourceId: source.id,
        campaignId: null,
        contactId,
        accountId: await resolvePrimaryAccount(client, contactId),
        productCategoryId: null,
        note: null,
        ownerUserId,
        receivedAt: message.sentAt,
      });
      await insertWhatsAppMessage(client, message, lead.id, true);
      await notify(client, { recipientUserId: ownerUserId, kind: 'WHATSAPP_LEAD', actorUserId: null, leadId: lead.id });
      await notifyLeadReceived(client, { leadId: lead.id, ownerUserId, actorUserId: null, kind: 'WHATSAPP_LEAD' });
      result = { outcome: 'NEW_LEAD', leadId: lead.id, ownerUserId };
    }

    await markPhoneOnWhatsApp(client, contactId, message.fromPhone);
    await commitTransaction(client);
    return result;
  } catch (error) {
    await rollbackTransaction(tx.client);
    throw error;
  } finally {
    tx.release();
  }
}

/** Meta sends far less; anything bigger is not a WhatsApp delivery. */
export const MAX_WEBHOOK_BYTES = 1024 * 1024;

/**
 * One webhook delivery, after the route has read the body: checks the
 * signature, then takes in every customer message sent to our number.
 * Answers with the HTTP status for Meta: 200 tells it to stop, anything else
 * makes it retry later.
 */
export async function handleWhatsAppWebhook(
  delivery: { rawBody: Buffer; signature: string | null },
  config: WhatsAppConfig,
  db: Db = defaultDb(),
  now: Date = new Date(),
): Promise<200 | 400 | 401> {
  if (!isValidMetaSignature(delivery.rawBody, delivery.signature, config.appSecret)) return 401;

  let payload: unknown;
  try {
    payload = JSON.parse(delivery.rawBody.toString('utf8'));
  } catch {
    return 400;
  }

  for (const message of parseWhatsAppWebhook(payload, now)) {
    if (message.phoneNumberId !== config.phoneNumberId) continue;
    await receiveWhatsAppMessage(db, message);
  }
  return 200;
}
