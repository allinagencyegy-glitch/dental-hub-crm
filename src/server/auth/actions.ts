'use server';

import 'server-only';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db/client';
import { findUserByEmail } from '@/server/users/repository';
import { verifyAgainstDummyHash, verifyPassword } from './password';
import { createSession, revokeSession } from './session';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookie';
import type { LoginFormState } from './form-state';

/**
 * One message for every failure mode - wrong email, wrong password, deactivated
 * account. Anything more specific is an account-enumeration oracle.
 */
const INVALID_CREDENTIALS = 'Invalid email or password.';

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(512),
});

/** Only same-origin CRM paths may be used as a post-login destination. */
function safeRedirectTarget(raw: FormDataEntryValue | null): string {
  const value = typeof raw === 'string' ? raw : '';
  return value.startsWith('/crm') && !value.startsWith('//') ? value : '/crm';
}

export async function loginAction(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: INVALID_CREDENTIALS };
  }

  const user = await findUserByEmail(db(), parsed.data.email);

  if (!user) {
    // Burn comparable CPU so a missing account is not detectable by timing.
    await verifyAgainstDummyHash(parsed.data.password);
    return { error: INVALID_CREDENTIALS };
  }

  const passwordMatches = await verifyPassword(user.password_hash, parsed.data.password);
  if (!passwordMatches) {
    return { error: INVALID_CREDENTIALS };
  }

  // Checked after verification so the response does not disclose account state.
  if (!user.is_active) {
    return { error: INVALID_CREDENTIALS };
  }

  const session = await createSession(db(), user.id);
  await setSessionCookie(session.token, session.expiresAt);

  // Outside the guarded paths above: redirect() signals by throwing.
  redirect(safeRedirectTarget(formData.get('next')));
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionCookie();
  if (token) {
    await revokeSession(db(), token);
  }
  await clearSessionCookie();
  redirect('/login');
}
