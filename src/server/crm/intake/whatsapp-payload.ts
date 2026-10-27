/**
 * Reading a WhatsApp Cloud API webhook: the customer messages in one delivery.
 *
 * Pure: no database, no network. A delivery can batch several messages, and
 * also carries things that are not a customer writing (delivery receipts,
 * reactions, system notices); only the messages are returned. A message that
 * cannot be read - no sender, no id - is skipped rather than failing the whole
 * delivery, so one odd item never holds back the rest.
 *
 * Payload shape: developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */
import { normalisePhoneToE164 } from '@/server/crm/contacts/phone';

export interface WhatsAppInboundMessage {
  /** The company number it was sent to, as Meta identifies it. */
  phoneNumberId: string;
  waMessageId: string;
  /** The customer's number, E.164. */
  fromPhone: string;
  profileName: string | null;
  type: string;
  body: string | null;
  adHeadline: string | null;
  adSourceUrl: string | null;
  sentAt: Date;
}

/** Not a customer writing to us: reacting to a message, a number change, opening the chat. */
const NOT_A_MESSAGE = new Set(['reaction', 'system', 'request_welcome']);

const MAX_BODY = 5000;
const MAX_NAME = 200;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function field(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** What the customer wrote, or the caption on what they sent. */
function bodyOf(message: Json, type: string): string | null {
  switch (type) {
    case 'text':
      return text(field(message, 'text', 'body'), MAX_BODY);
    case 'image':
    case 'video':
    case 'document':
      return text(field(message, type, 'caption'), MAX_BODY) ?? text(field(message, type, 'filename'), MAX_BODY);
    case 'button':
      return text(field(message, 'button', 'text'), MAX_BODY);
    case 'interactive':
      return (
        text(field(message, 'interactive', 'button_reply', 'title'), MAX_BODY) ??
        text(field(message, 'interactive', 'list_reply', 'title'), MAX_BODY)
      );
    case 'location': {
      const parts = [field(message, 'location', 'name'), field(message, 'location', 'address')]
        .map((part) => text(part, MAX_BODY))
        .filter((part): part is string => part !== null);
      return parts.length > 0 ? parts.join(' - ').slice(0, MAX_BODY) : null;
    }
    default:
      return null;
  }
}

function phoneOf(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d{7,15}$/.test(raw)) return null;
  try {
    return normalisePhoneToE164(`+${raw}`);
  } catch {
    return null;
  }
}

/** The customer messages in one webhook delivery, in the order Meta sent them. */
export function parseWhatsAppWebhook(payload: unknown, now: Date = new Date()): WhatsAppInboundMessage[] {
  if (!isObject(payload) || payload.object !== 'whatsapp_business_account') return [];

  const messages: WhatsAppInboundMessage[] = [];
  for (const entry of list(payload.entry)) {
    for (const change of list(entry.changes)) {
      if (change.field !== 'messages' || !isObject(change.value)) continue;
      const value = change.value;
      const phoneNumberId = text(field(value, 'metadata', 'phone_number_id'), 100);
      if (!phoneNumberId) continue;

      const names = new Map<string, string>();
      for (const contact of list(value.contacts)) {
        const name = text(field(contact, 'profile', 'name'), MAX_NAME);
        if (typeof contact.wa_id === 'string' && name) names.set(contact.wa_id, name);
      }

      for (const message of list(value.messages)) {
        const type = text(message.type, 40);
        const waMessageId = text(message.id, 200);
        const fromPhone = phoneOf(message.from);
        if (!type || NOT_A_MESSAGE.has(type) || !waMessageId || !fromPhone) continue;

        const seconds = Number(message.timestamp);
        messages.push({
          phoneNumberId,
          waMessageId,
          fromPhone,
          profileName: names.get(message.from as string) ?? null,
          type,
          body: bodyOf(message, type),
          adHeadline: text(field(message, 'referral', 'headline'), 500),
          adSourceUrl: text(field(message, 'referral', 'source_url'), 2000),
          sentAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : now,
        });
      }
    }
  }
  return messages;
}
