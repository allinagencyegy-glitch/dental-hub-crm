'use client';

import { useActionState } from 'react';
import { changePasswordAction } from '@/server/auth/password-actions';
import { EMPTY_PASSWORD_STATE, MIN_PASSWORD_LENGTH } from '@/server/auth/form-state';

const LABEL_CLASS = 'block text-[10px] font-bold uppercase tracking-[0.1em] text-[#7e8992]';
const FIELD_CLASS =
  'mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[12px] text-[#3c4a54] outline-none focus:border-[#18b6a4]';

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, EMPTY_PASSWORD_STATE);

  return (
    <form action={formAction} className="space-y-5 rounded-xl border border-[#dfe5e8] bg-white p-5">
      <div>
        <label htmlFor="currentPassword" className={LABEL_CLASS}>
          Current password
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className={FIELD_CLASS}
        />
      </div>

      <div>
        <label htmlFor="newPassword" className={LABEL_CLASS}>
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          className={FIELD_CLASS}
        />
        <p className="mt-1 text-[10px] text-[#87929a]">Minimum {MIN_PASSWORD_LENGTH} characters.</p>
      </div>

      <div>
        <label htmlFor="confirmPassword" className={LABEL_CLASS}>
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          className={FIELD_CLASS}
        />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-[#ffe9ea] px-3 py-2 text-[12px] text-[#c43f47]">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="rounded-lg bg-[#e8f8f1] px-3 py-2 text-[12px] text-[#14815f]">
          {state.success}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-9 items-center justify-center rounded-lg bg-[#132932] px-4 text-[11px] font-semibold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
      >
        {pending ? 'Saving...' : 'Change password'}
      </button>
    </form>
  );
}
