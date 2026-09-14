'use client';

import { useFormStatus } from 'react-dom';
import { logoutAction } from '@/server/auth/actions';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-white/30 hover:text-white disabled:opacity-50"
    >
      {pending ? 'Signing out...' : 'Sign out'}
    </button>
  );
}

export function SignOutButton() {
  // The Server Action is the form's action directly, so signing out works
  // without JavaScript. useFormStatus supplies the pending state.
  return (
    <form action={logoutAction}>
      <SubmitButton />
    </form>
  );
}
