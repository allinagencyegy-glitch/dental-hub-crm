import type { Messages } from './messages';
import type { OpportunityActivityEntry } from '@/server/crm/opportunities/repository';
import { isOpportunityStage } from '@/server/crm/opportunities/stage';
import { isFollowUpActionType, isFollowUpOutcome } from '@/server/crm/opportunities/followup-actions';

/**
 * The title of an opportunity activity entry, in the reader's language.
 *
 * Each entry stores an English description for logs, plus its type and the
 * facts behind it as metadata. The title is rebuilt from those facts; an entry
 * whose metadata lacks them (older rows) shows its stored description.
 */
export function activityTitle(entry: OpportunityActivityEntry, m: Messages): string {
  const t = m.opportunities.activity;
  const meta = entry.metadata ?? {};
  const text = (key: string) => (typeof meta[key] === 'string' ? (meta[key] as string) : null);
  const action = isFollowUpActionType(meta.actionType) ? m.followUpTypes[meta.actionType] : null;
  const quote = text('quoteNumber');

  switch (entry.activityType) {
    case 'STAGE_CHANGE': {
      if (!isOpportunityStage(meta.toStage)) break;
      if (meta.fromStage === null) return t.qualified;
      if (!isOpportunityStage(meta.fromStage)) break;
      return t.stageMoved(m.opportunityStage[meta.fromStage], m.opportunityStage[meta.toStage]);
    }
    case 'FOLLOW_UP_CREATED':
      return action === null ? entry.description : t.followUpScheduled(action);
    case 'FOLLOW_UP_COMPLETED':
      if (action === null) return entry.description;
      return isFollowUpOutcome(meta.outcome)
        ? t.followUpCompletedWithResult(action, m.followUpOutcomes[meta.outcome])
        : t.followUpCompleted(action);
    case 'FOLLOW_UP_RESCHEDULED':
      return action === null ? entry.description : t.followUpRescheduled(action);
    case 'FOLLOW_UP_MOVED':
      return typeof meta.count === 'number' ? t.followUpsCarried(meta.count) : entry.description;
    case 'NOTE_ADDED':
      return t.notesUpdated;
    case 'OWNER_CHANGED': {
      const owner = text('toOwnerName');
      return owner === null ? entry.description : t.ownerChanged(owner);
    }
    case 'QUOTATION_CREATED':
      return quote === null ? entry.description : t.quotationCreated(quote);
    case 'QUOTATION_REVISED': {
      const previous = text('previousQuoteNumber');
      return quote === null || previous === null ? entry.description : t.quotationRevised(previous, quote);
    }
    case 'QUOTATION_SENT':
      return quote === null ? entry.description : t.quotationSent(quote);
    case 'QUOTATION_ACCEPTED':
      return quote === null ? entry.description : t.quotationAccepted(quote);
    case 'QUOTATION_REJECTED':
      return quote === null ? entry.description : t.quotationRejected(quote);
    case 'QUOTATION_EXPIRED':
      return quote === null ? entry.description : t.quotationExpired(quote);
  }
  return entry.description;
}
