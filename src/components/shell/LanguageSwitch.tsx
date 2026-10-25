'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useLocale, useMessages } from '@/i18n/I18nProvider';

/**
 * Switches between Arabic and English. A plain form, so it works without
 * JavaScript and on the sign-in page; the page reloads in the new language
 * and direction.
 */
export function LanguageSwitch({ className }: { className: string }) {
  const locale = useLocale();
  const m = useMessages();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  return (
    <form method="post" action="/api/locale">
      <input type="hidden" name="locale" value={locale === 'ar' ? 'en' : 'ar'} />
      <input type="hidden" name="returnTo" value={search ? `${pathname}?${search}` : pathname} />
      <button type="submit" title={m.language.switchToLabel} className={className}>
        <span lang={locale === 'ar' ? 'en' : 'ar'}>{m.language.switchTo}</span>
      </button>
    </form>
  );
}
