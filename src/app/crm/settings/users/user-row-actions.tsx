'use client';

import { useActionState } from 'react';
import {
  changeUserRoleAction,
  resetUserPasswordAction,
  setUserActiveAction,
} from '@/server/users/admin-actions';
import { EMPTY_ADMIN_STATE, MIN_PASSWORD_LENGTH } from '@/server/auth/form-state';
import { ROLES, ROLE_LABELS } from '@/server/authz/permissions';
import type { PublicUser } from '@/server/users/dto';

export function UserRowActions({ user, isSelf }: { user: PublicUser; isSelf: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState(
    changeUserRoleAction,
    EMPTY_ADMIN_STATE,
  );
  const [activeState, activeAction, activePending] = useActionState(
    setUserActiveAction,
    EMPTY_ADMIN_STATE,
  );
  const [resetState, resetAction, resetPending] = useActionState(
    resetUserPasswordAction,
    EMPTY_ADMIN_STATE,
  );

  const error = roleState.error ?? activeState.error ?? resetState.error;

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
            className="h-8 rounded-lg border border-[#dfe4e7] bg-white px-2 text-[11px] text-[#17242c] outline-none focus:border-[#18b6a4]"
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
            className="h-8 rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa] disabled:opacity-50"
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
                ? 'h-8 rounded-lg border border-[#f4c7ca] bg-white px-2.5 text-[11px] font-semibold text-[#c43f47] transition hover:bg-[#fff5f5] disabled:opacity-50'
                : 'h-8 rounded-lg border border-[#bce6df] bg-white px-2.5 text-[11px] font-semibold text-[#087f73] transition hover:bg-[#f0fbf9] disabled:opacity-50'
            }
          >
            {activePending ? 'Saving...' : user.isActive ? 'Deactivate' : 'Activate'}
          </button>
        </form>
      </div>

      {/* Your own password is changed from Settings → Password instead. */}
      {isSelf ? null : (
        <details className="text-[11px] sm:text-right">
          <summary className="cursor-pointer font-semibold text-[#53616b] hover:text-[#17242c]">
            Reset password
          </summary>
          <form action={resetAction} className="mt-2 flex items-center gap-2">
            <input type="hidden" name="userId" value={user.id} />
            <label htmlFor={`password-${user.id}`} className="sr-only">
              New password for {user.displayName}
            </label>
            <input
              id={`password-${user.id}`}
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              placeholder={`New password (${MIN_PASSWORD_LENGTH}+ characters)`}
              className="h-8 w-52 rounded-lg border border-[#dfe4e7] bg-white px-2 text-[11px] text-[#17242c] outline-none focus:border-[#18b6a4]"
            />
            <button
              type="submit"
              disabled={resetPending}
              className="h-8 rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa] disabled:opacity-50"
            >
              {resetPending ? 'Saving...' : 'Set password'}
            </button>
          </form>
        </details>
      )}

      {resetState.success ? (
        <p role="status" className="text-[11px] font-semibold text-[#14815f]">
          {resetState.success}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[11px] font-semibold text-[#c43f47]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
