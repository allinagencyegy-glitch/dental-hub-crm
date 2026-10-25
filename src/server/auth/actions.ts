'use server';

import 'server-only';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db/client';
import { findUserByEmail } from '@/server/users/repository';
import { verifyAgainstDummyHash, verifyPassword } from './password';
import { clearLoginAttempts, reserveLoginAttempt } from './login-throttle';
import { createSession, revokeSession } from './session';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookie';
import { getMessages } from '@/i18n/server';
import type { LoginFormState } from './form-state';

function minutesUntil(retryAt: Date): number {
  return Math.max(1, Math.ceil((retryAt.getTime() - Date.now()) / 60_000));
}

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
  const m = await getMessages();
  // One message for every failure mode - wrong email, wrong password, deactivated
  // account. Anything more specific is an account-enumeration oracle.
  const invalidCredentials = m.login.invalidCredentials;

  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: invalidCredentials };
  }

  // Reserved before any password check, so the limit holds under parallel guesses.
  const reservation = await reserveLoginAttempt(db(), parsed.data.email);
  // Shown for every email once its attempts run out, whether or not an account
  // exists, so it reveals nothing more than invalidCredentials does.
  if (!reservation.allowed) {
    return { error: m.login.tooManyAttempts(minutesUntil(reservation.retryAt)) };
  }

  const user = await findUserByEmail(db(), parsed.data.email);

  if (!user) {
    // Burn comparable CPU so a missing account is not detectable by timing.
    await verifyAgainstDummyHash(parsed.data.password);
    return { error: invalidCredentials };
  }

  const passwordMatches = await verifyPassword(user.password_hash, parsed.data.password);
  if (!passwordMatches) {
    return { error: invalidCredentials };
  }

  // Checked after verification so the response does not disclose account state.
  if (!user.is_active) {
    return { error: invalidCredentials };
  }

  await clearLoginAttempts(db(), parsed.data.email);
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
