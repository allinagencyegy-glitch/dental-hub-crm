import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, isLocale, textDirection } from '../../src/i18n/config';
import { messagesFor, type Messages } from '../../src/i18n/messages';

/** Every leaf of a message tree, by dotted path. */
function leaves(tree: object, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') {
      for (const [p, v] of leaves(value, path)) out.set(p, v);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

describe('i18n configuration', () => {
  it('speaks Arabic and English, Arabic by default', () => {
    expect([...LOCALES]).toEqual(['ar', 'en']);
    expect(DEFAULT_LOCALE).toBe('ar');
    expect(isLocale('ar')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('writes Arabic right to left', () => {
    expect(textDirection('ar')).toBe('rtl');
    expect(textDirection('en')).toBe('ltr');
  });
});

describe('message catalogues', () => {
  const ar = leaves(messagesFor('ar'));
  const en = leaves(messagesFor('en'));

  it('have exactly the same keys in both languages', () => {
    expect([...ar.keys()].sort()).toEqual([...en.keys()].sort());
  });

  it('hold no empty text, and text that takes values in both languages', () => {
    for (const [path, value] of en) {
      const other = ar.get(path);
      expect(typeof other, path).toBe(typeof value);
      if (typeof value === 'string') {
        expect(value.trim(), path).not.toBe('');
        expect((other as string).trim(), path).not.toBe('');
      }
    }
  });

  it('puts the values into the sentence', () => {
    const check = (m: Messages) => {
      expect(m.users.created('Omar')).toContain('Omar');
      expect(m.password.description('a@b.test')).toContain('a@b.test');
      expect(m.forbidden.body(m.roles.SALES_REP)).toContain(m.roles.SALES_REP);
    };
    check(messagesFor('ar'));
    check(messagesFor('en'));
  });

  it('counts minutes with the Arabic plural forms', () => {
    const { tooManyAttempts } = messagesFor('ar').login;
    expect(tooManyAttempts(1)).toContain('بعد دقيقة.');
    expect(tooManyAttempts(2)).toContain('بعد دقيقتين.');
    expect(tooManyAttempts(5)).toContain('بعد 5 دقائق.');
    expect(tooManyAttempts(15)).toContain('بعد 15 دقيقة.');
    expect(messagesFor('en').login.tooManyAttempts(1)).toContain('1 minute.');
    expect(messagesFor('en').login.tooManyAttempts(15)).toContain('15 minutes.');
  });
});
