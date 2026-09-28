'use client';

import { useFormStatus } from 'react-dom';
import { logoutAction } from '@/server/auth/actions';
import { CrmIcon } from '@/components/crm/CrmIcon';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-white/55 transition hover:bg-white/[0.06] hover:text-white"
    >
      <CrmIcon name="chevron" className="h-[18px] w-[18px] text-white/38 rotate-90" />
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
