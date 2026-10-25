import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, isLocale, textDirection } from '../../src/i18n/config';
import { messagesFor, type Messages } from '../../src/i18n/messages';
import { catalogLabel, formatters } from '../../src/i18n/format';

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

  it('counts things with the Arabic plural forms', () => {
    const quotations = messagesFor('ar').opportunities.detail.quotationsOnRecord;
    expect([1, 2, 3, 10, 11, 100].map(quotations)).toEqual([
      'عرض سعر واحد في السجل',
      'عرضا سعر في السجل',
      '3 عروض أسعار في السجل',
      '10 عروض أسعار في السجل',
      '11 عرض سعر في السجل',
      '100 عرض سعر في السجل',
    ]);
    expect(messagesFor('en').opportunities.detail.quotationsOnRecord(1)).toBe('1 quotation on record');
    expect(messagesFor('ar').opportunities.detail.closedKept(0)).toMatch(/^لا توجد خطوات منتهية في السجل\./);
    expect(messagesFor('ar').pipeline.summary(2, '535,000 ج.م.')).not.toContain('..');
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

describe('catalog labels', () => {
  /** The codes a migration seeds into `table`, read from its INSERT. */
  function seededCodes(table: string, kind?: string): string[] {
    const sql = readFileSync(path.resolve(process.cwd(), 'migrations/0002_crm_catalogs.sql'), 'utf8');
    const insert = new RegExp(`INSERT INTO ${table} \\([^)]*\\) VALUES([\\s\\S]*?);`).exec(sql)?.[1] ?? '';
    const rows = [...insert.matchAll(/\(([^)]*)\)/g)].map((row) => row[1].split(',').map((cell) => cell.trim().replace(/^'|'$/g, '')));
    return kind ? rows.filter((row) => row[0] === kind).map((row) => row[1]) : rows.map((row) => row[0]);
  }

  it('translates every seeded source, product category, disqualification and lost reason', () => {
    const sources = seededCodes('crm_source');
    const categories = seededCodes('crm_product_category');
    const reasons = seededCodes('crm_outcome_reason', 'disqualify');
    const lostReasons = seededCodes('crm_outcome_reason', 'lost');
    expect(sources).toContain('whatsapp');
    expect(categories).toContain('dental_units');
    expect(reasons).toContain('wrong_number');
    expect(lostReasons).toContain('price_too_high');

    for (const m of [messagesFor('ar'), messagesFor('en')]) {
      expect(Object.keys(m.catalog.sources).sort()).toEqual([...sources].sort());
      expect(Object.keys(m.catalog.productCategories).sort()).toEqual([...categories].sort());
      expect(Object.keys(m.catalog.disqualifyReasons).sort()).toEqual([...reasons].sort());
      expect(Object.keys(m.catalog.lostReasons).sort()).toEqual([...lostReasons].sort());
    }
  });

  it('falls back to the stored name for a row with no translation', () => {
    const { sources } = messagesFor('ar').catalog;
    expect(catalogLabel(sources, 'whatsapp', 'WhatsApp')).toBe('واتساب');
    expect(catalogLabel(sources, 'trade_fair_2027', 'Trade fair 2027')).toBe('Trade fair 2027');
    expect(catalogLabel(sources, null, 'Website')).toBe('Website');
    expect(catalogLabel(sources, 'toString', 'Website')).toBe('Website');
  });
});

describe('formatting', () => {
  // 13:30 UTC is 16:30 in Cairo (UTC+3 under summer time on this date).
  const instant = new Date('2026-10-25T13:30:00Z');

  it('writes dates and times on Cairo time, with Latin digits in Arabic', () => {
    const ar = formatters('ar');
    expect(ar.date(instant)).toBe('25 أكتوبر 2026');
    expect(ar.time(instant)).toMatch(/^04:30\s?م$/);
    expect(ar.number(1250000.5)).toBe('1,250,000.5');
    expect(ar.dateTime(instant)).not.toMatch(/[٠-٩]/);
  });

  it('writes English dates on Cairo time too', () => {
    const en = formatters('en');
    expect(en.date(instant)).toBe('Oct 25, 2026');
    expect(en.time(instant)).toMatch(/^04:30\sPM$/);
  });

  it('writes amounts in whole Egyptian pounds, with Latin digits in Arabic', () => {
    expect(formatters('en').currency(1250000.4)).toMatch(/^EGP\s1,250,000$/);
    const arabic = formatters('ar').currency(1250000.4);
    expect(arabic).toContain('1,250,000');
    expect(arabic).toContain('ج.م.');
    expect(arabic).not.toMatch(/[٠-٩]/);
  });
});
