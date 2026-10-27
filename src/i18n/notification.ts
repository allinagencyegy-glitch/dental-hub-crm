import type { Messages } from './messages';
import type { Formatters } from './format';
import type { NotificationEntry } from '@/server/crm/notifications/repository';
import { isFollowUpActionType } from '@/server/crm/opportunities/followup-actions';

/**
 * Wraps a value typed in another script (an English name inside an Arabic
 * sentence, or the reverse) in a Unicode isolate, so the browser lays it out
 * as one block and the words around it keep their order.
 */
export function isolate(value: string): string {
  return `\u2068${value}\u2069`;
}

/** What a notification says, in the reader's language. */
export function notificationText(entry: NotificationEntry, m: Messages, format: Formatters): string {
  const t = m.notifications;
  const actor = isolate(entry.actorName ?? t.someone);
  const customer = isolate(entry.customerName ?? t.aCustomer);
  const quote = isolate(entry.quoteNumber ?? '—');

  switch (entry.kind) {
    case 'LEAD_RECEIVED':
      return t.kinds.LEAD_RECEIVED(actor, customer);
    case 'LEAD_ASSIGNED':
      return t.kinds.LEAD_ASSIGNED(actor, customer);
    case 'OPPORTUNITY_ASSIGNED':
      return t.kinds.OPPORTUNITY_ASSIGNED(actor, customer);
    case 'FOLLOW_UP_ASSIGNED': {
      const action = isFollowUpActionType(entry.followUpActionType)
        ? m.followUpTypes[entry.followUpActionType]
        : m.followUpTypes.OTHER;
      const due = entry.followUpDueAt ? format.dateTime(entry.followUpDueAt) : '—';
      return t.kinds.FOLLOW_UP_ASSIGNED(actor, action, customer, due);
    }
    case 'QUOTATION_ACCEPTED':
      return t.kinds.QUOTATION_ACCEPTED(actor, quote, customer);
    case 'QUOTATION_REJECTED':
      return t.kinds.QUOTATION_REJECTED(actor, quote, customer);
    case 'WHATSAPP_LEAD':
      return t.kinds.WHATSAPP_LEAD(customer);
    case 'WHATSAPP_MESSAGE':
      return t.kinds.WHATSAPP_MESSAGE(customer);
  }
}

/** The page a notification opens. */
export function notificationHref(entry: NotificationEntry): string {
  if (entry.quotationId) return `/crm/quotations/${entry.quotationId}`;
  if (entry.opportunityId) return `/crm/opportunities/${entry.opportunityId}`;
  if (entry.leadId) return `/crm/leads/${entry.leadId}`;
  return '/crm';
}
