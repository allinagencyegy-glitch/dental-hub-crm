/**
 * Next.js 16 renamed Middleware to Proxy. This runs on the Node.js runtime by
 * default and must not set a `runtime` config option.
 *
 * This is a UX optimisation ONLY. It performs an optimistic, cookie-presence
 * check so that obviously-signed-out visitors are bounced before a render is
 * attempted. It deliberately does no database work - Proxy runs on prefetches
 * too, and the opaque token means presence tells us nothing about validity.
 *
 * The authoritative check lives in `src/server/auth/dal.ts`.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/server/auth/cookie-name';

export function proxy(request: NextRequest): NextResponse {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);
  if (hasSessionCookie) return NextResponse.next();

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = '';
  loginUrl.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Only guards the authenticated area. Signed-in visitors are NOT bounced away
  // from /login here: a stale cookie would otherwise ping-pong against the DAL.
  matcher: ['/crm/:path*'],
};
