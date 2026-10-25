'use client';

import { createContext, useContext } from 'react';
import { DEFAULT_LOCALE, type Locale } from './config';
import { messagesFor, type Messages } from './messages';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/**
 * Makes the request's language available to Client Components. Only the
 * locale crosses from the server: messages hold functions, which cannot be
 * serialised, so each side looks them up itself.
 */
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useMessages(): Messages {
  return messagesFor(useLocale());
}
