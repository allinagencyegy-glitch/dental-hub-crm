import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import type { Client } from 'pg';
import { connectTestDb, uniqueEmail, TEST_PASSWORD } from './setup/db';
import { HttpClient, LOCALE_COOKIE, parseHiddenFields, type HttpResponse } from './setup/http';
import { createUser } from '../../src/server/users/repository';
import { captureLeadUseCase } from '../../src/server/crm/leads/service';
import { createFollowUpUseCase, qualifyLeadUseCase } from '../../src/server/crm/opportunities/service';
import { createQuotationUseCase, transitionQuotationUseCase } from '../../src/server/crm/quotations/service';

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
      // The bell in the header.
      expect(body).toContain('aria-label="الإشعارات"');
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

    it('shows the opportunity, pipeline and follow-up pages in Arabic', async () => {
      const rep = await createUser(db, {
        displayName: 'Arabic Deals Rep',
        email: uniqueEmail('arabic.deals'),
        password: TEST_PASSWORD,
        role: 'SALES_REP',
      });
      const actor = { userId: rep.id, role: 'SALES_REP' as const };
      const captured = await captureLeadUseCase(
        actor,
        {
          fullName: 'Dr. Arabic Deal',
          email: uniqueEmail('arabic.deal.contact'),
          sourceCode: 'facebook',
          productCategoryCode: 'autoclaves',
        },
        db,
      );
      if (!captured.ok) throw new Error(`capture failed: ${captured.message}`);
      const qualified = await qualifyLeadUseCase(actor, captured.leadId, { estimatedValue: 185000 }, db);
      if (!qualified.ok) throw new Error(`qualify failed: ${qualified.message}`);
      const scheduled = await createFollowUpUseCase(
        actor,
        qualified.opportunity.id,
        { actionType: 'MEETING', dueAt: new Date(Date.now() + 86_400_000) },
        db,
      );
      if (!scheduled.ok) throw new Error(`schedule failed: ${scheduled.message}`);

      const http = visitor('ar');
      expect((await http.submitForm('/login', { email: rep.email, password: TEST_PASSWORD })).status).toBe(303);

      const list = (await http.get('/crm/opportunities')).body;
      for (const text of ['كل صفقة مؤهلة', 'مؤهلة', 'اجتماع', '185,000', 'ج.م.', 'الخطوة القادمة']) {
        expect(list).toContain(text);
      }
      expect(list).toContain('<title>الفرص | Dental Hub CRM</title>');
      expect(list).not.toContain('Next action');

      const detail = (await http.get(`/crm/opportunities/${qualified.opportunity.id}`)).body;
      for (const text of [
        'العودة إلى الفرص',
        'أجهزة التعقيم (أوتوكلاف)',
        'المصدر: فيسبوك',
        'تم التحويل إلى فرصة',
        'جدولة متابعة: اجتماع',
        'وصل العميل المحتمل عن طريق فيسبوك',
        'سجل المراحل',
      ]) {
        expect(detail).toContain(text);
      }
      // The props in the page's script payload keep the stored English description;
      // what is drawn is the Arabic title.
      expect(detail.replace(/<script[\s\S]*?<\/script>/g, '')).not.toContain('Qualified into an opportunity');

      const pipeline = (await http.get('/crm/pipeline')).body;
      for (const text of ['مسار المبيعات', 'تحليل الاحتياجات', 'التالي: اجتماع', 'كل المصادر', 'فيسبوك']) {
        expect(pipeline).toContain(text);
      }

      const followUps = (await http.get('/crm/followups')).body;
      for (const text of ['ما وعدت به', 'متأخرة', 'القادمة', 'صفقة', 'إنهاء']) {
        expect(followUps).toContain(text);
      }
      expect(followUps).toContain('<title>المتابعات | Dental Hub CRM</title>');
    });

    it('shows the quotation, its print view and the dashboard in Arabic', async () => {
      const rep = await createUser(db, {
        displayName: 'Arabic Quote Rep',
        email: uniqueEmail('arabic.quotes'),
        password: TEST_PASSWORD,
        role: 'SALES_REP',
      });
      const actor = { userId: rep.id, role: 'SALES_REP' as const };
      const captured = await captureLeadUseCase(
        actor,
        {
          fullName: 'Dr. Arabic Quote',
          email: uniqueEmail('arabic.quote.contact'),
          sourceCode: 'instagram',
          productCategoryCode: 'dental_units',
        },
        db,
      );
      if (!captured.ok) throw new Error(`capture failed: ${captured.message}`);
      const qualified = await qualifyLeadUseCase(actor, captured.leadId, { estimatedValue: 240000 }, db);
      if (!qualified.ok) throw new Error(`qualify failed: ${qualified.message}`);
      const created = await createQuotationUseCase(
        actor,
        qualified.opportunity.id,
        { items: [{ description: 'Dental unit', quantity: 2, unitPrice: 62250.25 }], discountAmount: 500 },
        db,
      );
      if (!created.ok) throw new Error(`quotation failed: ${created.message}`);
      const sent = await transitionQuotationUseCase(actor, created.quotation.id, 'SENT', db);
      if (!sent.ok) throw new Error(`send failed: ${sent.message}`);

      const http = visitor('ar');
      expect((await http.submitForm('/login', { email: rep.email, password: TEST_PASSWORD })).status).toBe(303);

      const workspace = (await http.get(`/crm/quotations/${created.quotation.id}`)).body;
      for (const text of [
        'العودة إلى الفرصة',
        'مُرسَل',
        'حالة عرض السعر: مُرسَل.',
        'البنود',
        'سعر الوحدة',
        '124,500.5',
        'ج.م.',
        'سجل الإصدارات',
        'تغيّرت الحالة إلى «مُرسَل»',
        'إنشاء نسخة معدّلة',
      ]) {
        expect(workspace).toContain(text);
      }
      expect(workspace).toContain('<title>عرض سعر | Dental Hub CRM</title>');
      expect(workspace.replace(/<script[\s\S]*?<\/script>/g, '')).not.toContain('Line items');

      const print = (await http.get(`/crm/quotations/${created.quotation.id}/print`)).body;
      for (const text of ['مقدَّم إلى', 'تاريخ العرض', 'الإجمالي قبل الخصم', 'طباعة / حفظ PDF', 'أعدّه Arabic Quote Rep']) {
        expect(print).toContain(text);
      }
      // The document carries the company's logo, address and phone.
      for (const text of [
        'src="/brand/dental-hub-logo.png"',
        'alt="دينتال هب، شركة تثق بها"',
        'برج المبتديان، شارع القصر العيني، أمام صيدلية المنيرة، القاهرة',
        'href="https://maps.google.com/?q=30.034927,31.236965"',
        '0111 6516 419',
      ]) {
        expect(print).toContain(text);
      }

      const fresh = (await http.get(`/crm/quotations/new?opportunity=${qualified.opportunity.id}`)).body;
      expect(fresh).toContain('<title>عرض سعر جديد | Dental Hub CRM</title>');
      expect(fresh).toContain('حفظ المسودة');

      const dashboard = (await http.get('/crm')).body;
      for (const text of ['لوحة مبيعاتي', 'آخر 30 يومًا', 'قمع التحويل', 'إنستجرام', 'نتائج عروض الأسعار', 'أدائي']) {
        expect(dashboard).toContain(text);
      }
      expect(dashboard).toContain('<title>لوحة المبيعات | Dental Hub CRM</title>');
    });
  });
});
