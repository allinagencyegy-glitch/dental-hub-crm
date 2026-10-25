import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import type { Client } from 'pg';
import { connectTestDb, uniqueEmail, TEST_PASSWORD } from './setup/db';
import { HttpClient, LOCALE_COOKIE, parseHiddenFields, type HttpResponse } from './setup/http';
import { createUser } from '../../src/server/users/repository';
import { captureLeadUseCase } from '../../src/server/crm/leads/service';

function visitor(locale: 'ar' | 'en' | null): HttpClient {
  return new HttpClient(inject('baseUrl'), locale);
}

function postLocale(
  http: HttpClient,
  fields: Record<string, string>,
  headers?: Record<string, string>,
): Promise<HttpResponse> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return http.request('/api/locale', { method: 'POST', body, headers });
}

function htmlTag(body: string): string {
  return /<html[^>]*>/.exec(body)?.[0] ?? '';
}

describe('interface language', () => {
  let db: Client;

  beforeAll(async () => {
    db = await connectTestDb();
  });

  afterAll(async () => {
    await db.end();
  });

  describe('choosing the language', () => {
    it('is Arabic, right to left, on a first visit', async () => {
      const page = await visitor(null).get('/login');

      expect(page.status).toBe(200);
      expect(htmlTag(page.body)).toContain('lang="ar"');
      expect(htmlTag(page.body)).toContain('dir="rtl"');
      expect(page.body).toContain('سجّل الدخول للمتابعة');
    });

    it('is English, left to right, with the English cookie', async () => {
      const page = await visitor('en').get('/login');

      expect(htmlTag(page.body)).toContain('lang="en"');
      expect(htmlTag(page.body)).toContain('dir="ltr"');
      expect(page.body).toContain('Sign in to continue');
    });

    it('falls back to Arabic for a cookie it does not know', async () => {
      const http = visitor(null);
      http.setCookieManually(LOCALE_COOKIE, 'fr');

      expect(htmlTag((await http.get('/login')).body)).toContain('lang="ar"');
    });
  });

  describe('the switch', () => {
    it('is on the sign-in page and offers the other language', async () => {
      const arabic = await visitor('ar').get('/login?next=/crm/leads');
      const form = /<form[^>]*action="\/api\/locale"[\s\S]*?<\/form>/.exec(arabic.body)?.[0] ?? '';

      expect(parseHiddenFields(form)).toEqual({ locale: 'en', returnTo: '/login?next=%2Fcrm%2Fleads' });
      expect(form).toContain('English');
    });

    it('remembers the language for a year and returns to the page', async () => {
      const http = visitor(null);
      const response = await postLocale(http, { locale: 'en', returnTo: '/login?next=/crm/leads' });

      expect(response.status).toBe(303);
      expect(response.location).toBe('/login?next=/crm/leads');
      const cookie = response.setCookie.find((c) => c.startsWith(`${LOCALE_COOKIE}=`)) ?? '';
      expect(cookie).toMatch(/^dental_hub_locale=en;/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).toMatch(/Max-Age=31536000/);

      expect(htmlTag((await http.get('/login')).body)).toContain('lang="en"');
    });

    it.each(['//evil.example/', '/\\evil.example/', 'https://evil.example/', 'crm', ''])(
      'never sends the visitor off the site (returnTo %j)',
      async (returnTo) => {
        const response = await postLocale(visitor(null), { locale: 'ar', returnTo });

        expect(response.status).toBe(303);
        expect(response.location).toBe('/crm');
      },
    );

    it('refuses a language it does not have, and sets nothing', async () => {
      const response = await postLocale(visitor(null), { locale: 'fr', returnTo: '/login' });

      expect(response.status).toBe(400);
      expect(response.setCookie).toEqual([]);
    });

    it('refuses a post from another site', async () => {
      const response = await postLocale(
        visitor(null),
        { locale: 'en', returnTo: '/login' },
        { origin: 'https://evil.example' },
      );

      expect(response.status).toBe(403);
      expect(response.setCookie).toEqual([]);
    });
  });

  describe('Arabic pages', () => {
    async function signedInArabic(role: 'ADMIN' | 'SALES_REP') {
      const user = await createUser(db, {
        displayName: 'Arabic User',
        email: uniqueEmail(`arabic.${role.toLowerCase()}`),
        password: TEST_PASSWORD,
        role,
      });
      const http = visitor('ar');
      const response = await http.submitForm('/login', { email: user.email, password: TEST_PASSWORD });
      expect(response.status).toBe(303);
      return http;
    }

    it('shows the sign-in error in Arabic', async () => {
      const response = await visitor('ar').submitForm('/login', {
        email: uniqueEmail('arabic.nobody'),
        password: 'not-the-password',
      });

      expect(response.body).toContain('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    });

    it('labels the shell, the roles and the switch in Arabic', async () => {
      const http = await signedInArabic('ADMIN');
      const body = (await http.get('/crm/settings/users')).body;

      for (const text of ['مساحة العمل', 'العملاء المحتملون', 'المتابعات', 'خروج', 'مدير النظام', 'إضافة مستخدم']) {
        expect(body).toContain(text);
      }
      expect(body).toContain('<span lang="en">English</span>');
      expect(body).toContain('<title>المستخدمون | Dental Hub CRM</title>');
    });

    it('answers a Server Action in Arabic', async () => {
      const http = await signedInArabic('SALES_REP');
      const page = await http.get('/crm/settings/password');
      const form = [...page.body.matchAll(/<form\b[\s\S]*?<\/form>/g)]
        .map((match) => match[0])
        .find((html) => html.includes('name="currentPassword"'));
      if (!form) throw new Error('The change-password form was not rendered.');

      const body = new FormData();
      for (const [name, value] of Object.entries(parseHiddenFields(form))) body.set(name, value);
      body.set('currentPassword', 'not-my-password');
      body.set('newPassword', 'BrandNewSecret!2026');
      body.set('confirmPassword', 'BrandNewSecret!2026');
      const response = await http.request('/crm/settings/password', { method: 'POST', body });

      expect(response.body).toContain('كلمة المرور الحالية غير صحيحة.');
    });

    it('shows the leads pages in Arabic, catalog names included', async () => {
      const rep = await createUser(db, {
        displayName: 'Arabic Leads Rep',
        email: uniqueEmail('arabic.leads'),
        password: TEST_PASSWORD,
        role: 'SALES_REP',
      });
      const captured = await captureLeadUseCase(
        { userId: rep.id, role: 'SALES_REP' },
        {
          fullName: 'Dr. Arabic Lead',
          email: uniqueEmail('arabic.lead.contact'),
          sourceCode: 'whatsapp',
          productCategoryCode: 'dental_units',
        },
        db,
      );
      if (!captured.ok) throw new Error(`capture failed: ${captured.message}`);

      const http = visitor('ar');
      expect((await http.submitForm('/login', { email: rep.email, password: TEST_PASSWORD })).status).toBe(303);

      const inbox = (await http.get('/crm/leads')).body;
      for (const text of ['صندوق العملاء المحتملين', 'جديد', 'واتساب', 'وحدات الأسنان', 'إضافة عميل محتمل']) {
        expect(inbox).toContain(text);
      }
      expect(inbox).toContain('<title>العملاء المحتملون | Dental Hub CRM</title>');
      expect(inbox).not.toContain('Lead inbox');

      const detail = (await http.get(`/crm/leads/${captured.leadId}`)).body;
      for (const text of ['ملخص العميل المحتمل', 'الخطوات القادمة', 'تحويل إلى فرصة', 'Dr. Arabic Lead']) {
        expect(detail).toContain(text);
      }

      expect((await http.get('/crm/leads/capture')).body).toContain('إضافة عميل محتمل جديد');
      expect((await http.get(`/crm/leads/${captured.leadId}/edit`)).body).toContain('تعديل العميل المحتمل');

      // The same lead, in English, for a browser that chose English.
      const english = visitor('en');
      await english.submitForm('/login', { email: rep.email, password: TEST_PASSWORD });
      const englishDetail = (await english.get(`/crm/leads/${captured.leadId}`)).body;
      expect(englishDetail).toContain('Lead overview');
      expect(englishDetail).toContain('Dental units');
    });
  });
});
