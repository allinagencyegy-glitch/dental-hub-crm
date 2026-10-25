import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE, isLocale } from '@/i18n/config';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Only a path on this site may be returned to: never `//host` or `/\host`. */
function safeReturnPath(raw: FormDataEntryValue | null): string {
  const value = typeof raw === 'string' ? raw : '';
  return /^\/(?![/\\])/.test(value) ? value : '/crm';
}

/**
 * Switches the interface language. A plain form posts here (it works without
 * JavaScript and before sign-in); the language is remembered in a cookie and
 * the visitor is sent back to the page they were on.
 *
 * A Route Handler, not a Server Action: it changes no data, needs no session,
 * and the sign-in page has none to check.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Browsers always send Origin on a form POST. A different host is another
  // site. Only the host is compared: behind Caddy the app itself sees http.
  const origin = request.headers.get('origin');
  if (origin && URL.canParse(origin) && new URL(origin).host !== request.headers.get('host')) {
    return new NextResponse('Cross-site request refused.', { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const locale = form?.get('locale');
  if (!form || !isLocale(locale)) {
    return new NextResponse('Unknown language.', { status: 400 });
  }

  // A relative Location, for the same reason: the app does not know its public URL.
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: safeReturnPath(form.get('returnTo')) },
  });
  response.cookies.set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
  });
  return response;
}
