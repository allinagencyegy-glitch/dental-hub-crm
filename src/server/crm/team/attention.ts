/**
 * Why a person on the team page needs the manager's eye, worked out from
 * their snapshot alone so the rule is the same wherever it is shown.
 *
 * Pure: no database, safe to import from any component.
 */
import type { TeamMember } from './repository';

/** A new lead waiting longer than this for its first call is flagged. */
export const WAITING_TOO_LONG_HOURS = 24;
/** Someone who has not signed in for this many days is flagged. */
export const AWAY_DAYS = 3;

export type AttentionFlag =
  | { kind: 'overdue'; count: number }
  | { kind: 'waiting'; since: Date }
  | { kind: 'away'; since: Date | null };

const HOUR = 60 * 60 * 1000;

export function attentionFor(
  member: Pick<TeamMember, 'overdue' | 'waitingLeads' | 'oldestWaitingAt' | 'lastSignInAt'>,
  now: Date,
): AttentionFlag[] {
  const flags: AttentionFlag[] = [];
  if (member.overdue > 0) flags.push({ kind: 'overdue', count: member.overdue });
  if (
    member.waitingLeads > 0 &&
    member.oldestWaitingAt &&
    now.getTime() - member.oldestWaitingAt.getTime() > WAITING_TOO_LONG_HOURS * HOUR
  ) {
    flags.push({ kind: 'waiting', since: member.oldestWaitingAt });
  }
  if (!member.lastSignInAt || now.getTime() - member.lastSignInAt.getTime() > AWAY_DAYS * 24 * HOUR) {
    flags.push({ kind: 'away', since: member.lastSignInAt });
  }
  return flags;
}
