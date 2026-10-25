import type { Messages } from './messages';
import { isQuotationStatus } from '@/server/crm/quotations/status';

/**
 * Why a quotation's saved copy was taken, in the reader's language.
 *
 * The repository stores the reason as English text. The reasons it writes
 * itself are matched and rebuilt; any other text (a reason typed by a person,
 * or one written by an older version) is shown as it was stored.
 */
export function snapshotReason(reason: string, m: Messages): string {
  const t = m.quotations.snapshotReasons;
  if (reason === 'Quotation created') return t.created;
  if (reason === 'Draft updated') return t.draftUpdated;
  if (reason === 'Draft edited') return t.draftEdited;

  const moved = /^Status moved to ([A-Z]+)$/.exec(reason);
  if (moved && isQuotationStatus(moved[1])) return t.statusMoved(m.quotationStatus[moved[1]]);

  const revision = /^Revision of (\S+)$/.exec(reason);
  if (revision) return t.revisionOf(revision[1]);

  return reason;
}
