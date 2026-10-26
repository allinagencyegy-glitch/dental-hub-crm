/**
 * Row scope: WHICH records a user may reach, shared by every CRM repository.
 *
 * A SALES_REP reaches the rows they own. A SALES_TEAM_LEADER reaches the rows
 * they own and the rows owned by the reps on their team. SALES_MANAGER and
 * ADMIN reach everything. The capability side (may this role touch leads at
 * all) stays in `authz/permissions.ts`.
 */
import type { Db } from '@/server/db/types';
import { canOwnWork, type Role } from '@/server/authz/permissions';
import { findUserById } from '@/server/users/repository';
import type { UserRow } from '@/server/users/dto';

export type Actor = { userId: string; role: Role };

/**
 * The SQL predicate that keeps a row in the actor's scope, or null when the
 * actor sees everything. `columns` are owner columns of the same row - the row
 * passes when any of them names someone in scope - and the actor's id is
 * pushed onto `params`.
 */
export function ownerScopeSql(actor: Actor, params: unknown[], columns: readonly string[]): string | null {
  if (actor.role !== 'SALES_REP' && actor.role !== 'SALES_TEAM_LEADER') return null;

  params.push(actor.userId);
  const self = `$${params.length}`;
  const inScope =
    actor.role === 'SALES_REP'
      ? (column: string) => `${column} = ${self}`
      : (column: string) =>
          `${column} IN (SELECT ${self}::uuid UNION ALL SELECT tm.id FROM crm_user tm WHERE tm.team_leader_id = ${self})`;

  const predicates = columns.map(inScope);
  return predicates.length === 1 ? predicates[0] : `(${predicates.join(' OR ')})`;
}

export type AssignableOwner =
  | { ok: true; owner: UserRow }
  | { ok: false; error: 'UNAUTHORISED' | 'OWNER_NOT_FOUND' };

/**
 * Whether the actor may hand work to `ownerUserId`. A rep may not hand work
 * to anyone; a team leader only to themselves or a rep on their team; a
 * manager or admin to anyone. The owner must be an active user in a selling
 * role, so an admin can never become a sales owner.
 */
export async function checkAssignableOwner(
  db: Db,
  actor: Actor,
  ownerUserId: string,
): Promise<AssignableOwner> {
  if (actor.role === 'SALES_REP') return { ok: false, error: 'UNAUTHORISED' };

  const owner = await findUserById(db, ownerUserId);
  if (!owner || !owner.is_active || !canOwnWork(owner.role)) {
    return { ok: false, error: 'OWNER_NOT_FOUND' };
  }
  if (
    actor.role === 'SALES_TEAM_LEADER' &&
    owner.id !== actor.userId &&
    owner.team_leader_id !== actor.userId
  ) {
    return { ok: false, error: 'UNAUTHORISED' };
  }
  return { ok: true, owner };
}

/**
 * The people the actor may hand work to, for owner pickers: everyone in a
 * selling role for a manager or admin, the team for a team leader, and just
 * themselves for a rep.
 */
export async function listAssignableOwners(
  db: Db,
  actor: Actor,
): Promise<{ id: string; displayName: string; email: string; role: Role }[]> {
  const params: unknown[] = [];
  const clauses = ['u.is_active', `u.role IN ('SALES_MANAGER', 'SALES_TEAM_LEADER', 'SALES_REP')`];
  const scope = ownerScopeSql(actor, params, ['u.id']);
  if (scope) clauses.push(scope);

  const { rows } = await db.query<{ id: string; display_name: string; email: string; role: Role }>(
    `SELECT u.id, u.display_name, u.email, u.role
       FROM crm_user u
      WHERE ${clauses.join(' AND ')}
      ORDER BY u.display_name ASC`,
    params,
  );
  return rows.map((row) => ({ id: row.id, displayName: row.display_name, email: row.email, role: row.role }));
}
