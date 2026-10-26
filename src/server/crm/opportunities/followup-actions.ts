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

/**
 * What happened when a follow-up was done, picked from a fixed list so calls
 * can be counted and reported on. Mirrored by crm_followup_outcome_known in
 * migration 0015. The order is the order the picker shows.
 */
export const FOLLOW_UP_OUTCOMES = [
  // The customer was not reached.
  'NO_ANSWER',
  'BUSY',
  'UNREACHABLE',
  'MESSAGED_ON_WHATSAPP',
  // The customer was reached.
  'ASKING_PRICES',
  'STILL_DECIDING',
  'CALL_BACK_LATER',
  'VISIT_PLANNED',
  'DEMO_REQUESTED',
  'QUOTATION_REQUESTED',
  'READY_TO_BUY',
  'NOT_INTERESTED',
  'BOUGHT_ELSEWHERE',
  'WRONG_NUMBER',
] as const;

export type FollowUpOutcome = (typeof FOLLOW_UP_OUTCOMES)[number];

/** The outcomes that mean nobody was reached, so another try is due. */
export const NOT_REACHED_OUTCOMES: readonly FollowUpOutcome[] = [
  'NO_ANSWER',
  'BUSY',
  'UNREACHABLE',
  'MESSAGED_ON_WHATSAPP',
];

export function isFollowUpOutcome(value: unknown): value is FollowUpOutcome {
  return typeof value === 'string' && (FOLLOW_UP_OUTCOMES as readonly string[]).includes(value);
}

export function isNotReached(outcome: FollowUpOutcome | null): boolean {
  return outcome !== null && NOT_REACHED_OUTCOMES.includes(outcome);
}

/**
 * Which try each unanswered follow-up was, so the history reads "No answer
 * (attempt 3)" the way the team counts them. Attempts run in completion order
 * and start again after a follow-up that reached the customer. Follow-ups
 * that reached the customer, or have no outcome, are not in the map.
 */
export function notReachedAttempts(
  followUps: readonly { id: string; outcome: FollowUpOutcome | null; completedAt: Date | null }[],
): Map<string, number> {
  const attempts = new Map<string, number>();
  const done = followUps
    .filter((followUp) => followUp.completedAt !== null)
    .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime());
  let streak = 0;
  for (const followUp of done) {
    if (followUp.outcome === null) continue;
    if (isNotReached(followUp.outcome)) {
      streak += 1;
      attempts.set(followUp.id, streak);
    } else {
      streak = 0;
    }
  }
  return attempts;
}
