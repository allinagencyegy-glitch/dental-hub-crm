'use client';

import { useActionState } from 'react';
import { createUserAction } from '@/server/users/admin-actions';
import { EMPTY_ADMIN_STATE } from '@/server/auth/form-state';
import { ROLES, ROLE_LABELS } from '@/server/authz/permissions';

const FIELD_CLASS =
  'w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-teal-400/60';

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(createUserAction, EMPTY_ADMIN_STATE);

  return (
    <form action={formAction} className="rounded-lg border border-white/10 bg-slate-900/40 p-5">
      <h2 className="text-sm font-semibold text-white">Add a user</h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="displayName" className="block text-xs font-medium text-slate-400">
            Display name
          </label>
          <input id="displayName" name="displayName" required maxLength={120} className={FIELD_CLASS} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="new-email" className="block text-xs font-medium text-slate-400">
            Email
          </label>
          <input id="new-email" name="email" type="email" required className={FIELD_CLASS} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="new-password" className="block text-xs font-medium text-slate-400">
            Initial password
          </label>
          <input
            id="new-password"
            name="password"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            className={FIELD_CLASS}
          />
          <p className="text-[11px] text-slate-600">Minimum 12 characters.</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="new-role" className="block text-xs font-medium text-slate-400">
            Role
          </label>
          <select id="new-role" name="role" defaultValue="SALES_REP" className={FIELD_CLASS}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="mt-4 rounded-md bg-teal-500/10 px-3 py-2 text-sm text-teal-300">
          {state.success}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-md bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-teal-400 disabled:opacity-60"
      >
        {pending ? 'Creating...' : 'Create user'}
      </button>
    </form>
  );
}
