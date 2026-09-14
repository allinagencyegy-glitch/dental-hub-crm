'use client';

import { useActionState } from 'react';
import { changeUserRoleAction, setUserActiveAction } from '@/server/users/admin-actions';
import { EMPTY_ADMIN_STATE } from '@/server/auth/form-state';
import { ROLES, ROLE_LABELS } from '@/server/authz/permissions';
import type { PublicUser } from '@/server/users/dto';

export function UserRowActions({ user }: { user: PublicUser }) {
  const [roleState, roleAction, rolePending] = useActionState(
    changeUserRoleAction,
    EMPTY_ADMIN_STATE,
  );
  const [activeState, activeAction, activePending] = useActionState(
    setUserActiveAction,
    EMPTY_ADMIN_STATE,
  );

  const error = roleState.error ?? activeState.error;

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <form action={roleAction} className="flex items-center gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <label htmlFor={`role-${user.id}`} className="sr-only">
            Role for {user.displayName}
          </label>
          <select
            id={`role-${user.id}`}
            name="role"
            defaultValue={user.role}
            className="rounded-md border border-white/10 bg-slate-950 px-2 py-1.5 text-xs text-white outline-none focus:border-teal-400/60"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={rolePending}
            className="rounded-md border border-white/15 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-white/30 hover:text-white disabled:opacity-50"
          >
            {rolePending ? 'Saving...' : 'Save role'}
          </button>
        </form>

        <form action={activeAction}>
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="isActive" value={user.isActive ? 'false' : 'true'} />
          <button
            type="submit"
            disabled={activePending}
            className={
              user.isActive
                ? 'rounded-md border border-red-500/30 px-2.5 py-1.5 text-xs text-red-300 transition hover:border-red-500/60 disabled:opacity-50'
                : 'rounded-md border border-teal-500/30 px-2.5 py-1.5 text-xs text-teal-300 transition hover:border-teal-500/60 disabled:opacity-50'
            }
          >
            {activePending ? 'Saving...' : user.isActive ? 'Deactivate' : 'Activate'}
          </button>
        </form>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
