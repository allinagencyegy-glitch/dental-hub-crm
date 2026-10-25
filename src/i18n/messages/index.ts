import type { Locale } from '../config';
import { ar } from './ar';
import { en, type Messages } from './en';

export type { Messages };

const MESSAGES: Record<Locale, Messages> = { ar, en };

export function messagesFor(locale: Locale): Messages {
  return MESSAGES[locale];
}
