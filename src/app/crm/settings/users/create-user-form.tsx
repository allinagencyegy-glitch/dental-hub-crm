'use client';

import { useActionState } from 'react';
import { createUserAction } from '@/server/users/admin-actions';
import { EMPTY_ADMIN_STATE, MIN_PASSWORD_LENGTH } from '@/server/auth/form-state';
import { ROLES } from '@/server/authz/permissions';
import { useMessages } from '@/i18n/I18nProvider';

const LABEL_CLASS = 'block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d]';
const FIELD_CLASS =
  'h-9 w-full rounded-lg border border-[#dfe4e7] bg-white px-3 text-[12px] text-[#17242c] outline-none transition placeholder:text-[#94a0a9] focus:border-[#18b6a4]';

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(createUserAction, EMPTY_ADMIN_STATE);
  const m = useMessages();

  return (
    <form action={formAction} className="rounded-xl border border-[#dfe5e8] bg-white p-5">
      <h2 className="text-sm font-semibold text-[#1c2831]">{m.users.addTitle}</h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="displayName" className={LABEL_CLASS}>
            {m.users.displayName}
          </label>
          <input id="displayName" name="displayName" required maxLength={120} className={FIELD_CLASS} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="new-email" className={LABEL_CLASS}>
            {m.users.email}
          </label>
          <input id="new-email" name="email" type="email" dir="ltr" required className={FIELD_CLASS} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="new-password" className={LABEL_CLASS}>
            {m.users.initialPassword}
          </label>
          <input
            id="new-password"
            name="password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className={FIELD_CLASS}
          />
          <p className="text-[10px] text-[#8a959d]">{m.common.minCharacters(MIN_PASSWORD_LENGTH)}</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="new-role" className={LABEL_CLASS}>
            {m.users.role}
          </label>
          <select id="new-role" name="role" defaultValue="SALES_REP" className={FIELD_CLASS}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {m.roles[role]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="mt-4 rounded-lg border border-[#f4c7ca] bg-[#ffe9ea] px-3 py-2 text-sm text-[#c43f47]">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="mt-4 rounded-lg bg-[#e8f8f1] px-3 py-2 text-sm text-[#14815f]">
          {state.success}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 inline-flex h-9 items-center rounded-lg bg-[#132932] px-4 text-[11px] font-semibold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
      >
        {pending ? m.users.creating : m.users.create}
      </button>
    </form>
  );
}
