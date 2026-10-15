/**
 * Follow-up / next-action vocabulary.
 *
 * A follow-up is a durable scheduled action on an open opportunity. It is never
 * deleted - completing one stamps completed_at - so the timeline of what was
 * actually promised and when remains readable after the deal closes.
 *
 * Mirrored by crm_followup_action_type_known in migration 0006.
 */

export const FOLLOW_UP_ACTION_TYPES = [
  'CALL',
  'WHATSAPP',
  'MEETING',
  'SEND_QUOTATION',
  'FOLLOW_UP',
  'OTHER',
] as const;

export type FollowUpActionType = (typeof FOLLOW_UP_ACTION_TYPES)[number];

export const ACTION_TYPE_LABELS: Record<FollowUpActionType, string> = {
  CALL: 'Call',
  WHATSAPP: 'WhatsApp',
  MEETING: 'Meeting',
  SEND_QUOTATION: 'Send quotation',
  FOLLOW_UP: 'Follow up',
  OTHER: 'Other',
};

export function isFollowUpActionType(value: unknown): value is FollowUpActionType {
  return typeof value === 'string' && (FOLLOW_UP_ACTION_TYPES as readonly string[]).includes(value);
}
