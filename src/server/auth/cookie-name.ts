/**
 * Isolated so `proxy.ts` can read the cookie name without pulling in
 * `next/headers` or any `server-only` module.
 *
 * The `__Host-` prefix makes the browser itself enforce Secure + Path=/ + no
 * Domain. It requires HTTPS, so it is production-only; local development runs
 * over plain HTTP.
 */
export const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === 'production' ? '__Host-dental_hub_session' : 'dental_hub_session';
