import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from './cookie-name';

export { SESSION_COOKIE_NAME };

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export async function readSessionCookie(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE_NAME)?.value;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE_NAME, token, {
    httpOnly: true, // unreadable from document.cookie
    sameSite: 'lax', // blocks cross-site POST; still allows inbound links
    secure: IS_PRODUCTION, // __Host- additionally requires this in production
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    path: '/',
    maxAge: 0,
  });
}
