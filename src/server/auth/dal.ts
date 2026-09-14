/**
 * Data Access Layer - the authoritative authentication and authorization
 * boundary. `proxy.ts` is only a UX optimisation; every protected render and
 * every Server Action passes through here.
 */
import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { db } from '@/server/db/client';
import { can, type Permission } from '@/server/authz/permissions';
import { resolveSession, type AuthenticatedSession } from './session';
import { readSessionCookie } from './cookie';

/**
 * `cache()` dedupes this per request, so one render pass costs one query no
 * matter how many layouts, pages and components ask who the user is.
 */
export const getCurrentSession = cache(async (): Promise<AuthenticatedSession | null> => {
  const token = await readSessionCookie();
  if (!token) return null;
  return resolveSession(db(), token);
});

export async function requireSession(): Promise<AuthenticatedSession> {
  const session = await getCurrentSession();
  if (!session) redirect('/login');
  return session;
}

export async function requirePermission(permission: Permission): Promise<AuthenticatedSession> {
  const session = await requireSession();
  if (!can(session.role, permission)) redirect('/crm/forbidden');
  return session;
}

/**
 * For Server Actions: throws instead of redirecting, so a denied mutation
 * surfaces as an error rather than a confusing navigation.
 */
export async function assertPermission(permission: Permission): Promise<AuthenticatedSession> {
  const session = await getCurrentSession();
  if (!session) throw new Error('Not authenticated.');
  if (!can(session.role, permission)) throw new Error('Not authorised.');
  return session;
}
