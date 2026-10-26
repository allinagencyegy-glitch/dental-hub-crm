import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { readXlsxRecords } from '../../scripts/spider/xlsx';
import { runMigrations } from '../../src/server/db/migrator';
import { createUser } from '../../src/server/users/repository';
import { createContact } from '../../src/server/crm/contacts/repository';
import { createLead } from '../../src/server/crm/leads/repository';
import {
  CALL_BACKS_PER_DAY,
  cairoTime,
  callBackDueAt,
  categoryForCode,
  excludedBecause,
  outcomeForStatus,
  parseSpiderPhones,
  planSpiderImport,
  sourceForReferral,
  spiderClientFromRecord,
  spiderTeamFromRecords,
  writeSpiderImport,
  type SpiderClient,
  type SpiderTeamMember,
} from '../../src/server/crm/import/spider';
import { uniqueToken } from './setup/db';

function client(overrides: Partial<SpiderClient>): SpiderClient {
  return {
    number: '1',
    member: 'Test Rep dental hub',
    clientName: 'Dental hub',
    code: '',
    phone: '',
    notes: '',
    lastStatus: '',
    referral: 'Whatsapp',
    createdAt: '2026-05-01 10:00:00',
    tags: '',
    ...overrides,
  };
}

const TEAM: SpiderTeamMember[] = [
  { spiderName: 'Test Rep', displayName: 'Test Rep', email: 'rep@spider.test', role: 'SALES_REP' },
];

describe('reading the Spider exports', () => {
  it('reads shared strings, rich text, inline strings and phone formulas', () => {
    const records = readXlsxRecords(path.join(__dirname, 'fixtures', 'spider-clients.xlsx'));

    expect(records).toHaveLength(3);
    const [first, second, sparse] = records.map(spiderClientFromRecord);
    expect(first).toMatchObject({
      number: '12',
      member: 'Test Rep dental hub',
      code: 'ksensor',
      phone: '+201001234567',
      notes: '',
      lastStatus: 'مردش 1',
      createdAt: '2026-10-26 12:56:05',
    });
    expect(second).toMatchObject({
      clientName: 'عيادة د. & شركاه',
      phone: '+201001234568,+201101234568',
      notes: 'يسأل عن التقسيط',
      lastStatus: '',
    });
    expect(sparse).toMatchObject({ number: '', member: '', phone: '' });
  });
});

describe('cleaning Spider values', () => {
  it('reads Egyptian numbers however Spider stored them', () => {
    expect(parseSpiderPhones('="+201001234567"').phones).toEqual(['+201001234567']);
    expect(parseSpiderPhones('01001234567').phones).toEqual(['+201001234567']);
    expect(parseSpiderPhones('201001234567').phones).toEqual(['+201001234567']);
    expect(parseSpiderPhones('++201001234567').phones).toEqual(['+201001234567']);
    expect(parseSpiderPhones('+20201001234567').phones).toEqual(['+201001234567']);
    expect(parseSpiderPhones('+2001001234567').phones).toEqual(['+201001234567']);
    expect(parseSpiderPhones('٠١٠٠١٢٣٤٥٦٧').phones).toEqual(['+201001234567']);
  });

  it('takes the +20 off a foreign number Spider prefixed', () => {
    expect(parseSpiderPhones('+20966501234567').phones).toEqual(['+966501234567']);
    expect(parseSpiderPhones('+20971501234567').phones).toEqual(['+971501234567']);
  });

  it('splits a cell with two numbers, and keeps a repeated number once', () => {
    expect(parseSpiderPhones('+201001234567,+201101234567').phones).toEqual(['+201001234567', '+201101234567']);
    expect(parseSpiderPhones('+201001234567+201101234567').phones).toEqual(['+201001234567', '+201101234567']);
    expect(parseSpiderPhones('+201001234567,+201001234567').phones).toEqual(['+201001234567']);
  });

  it('reports what is not a phone number', () => {
    expect(parseSpiderPhones('+201.001234567E+21')).toEqual({ phones: [], rejected: ['+201.001234567E+21'] });
    expect(parseSpiderPhones('+EG.12').rejected).toEqual(['+12']);
    expect(parseSpiderPhones('')).toEqual({ phones: [], rejected: [] });
  });

  it('maps the campaign codes the team used to product categories', () => {
    expect(categoryForCode('ksensor')).toBe('xray_sensors');
    expect(categoryForCode('K sensor')).toBe('xray_sensors');
    expect(categoryForCode('سنسور')).toBe('xray_sensors');
    expect(categoryForCode('fomos 18')).toBe('autoclaves');
    expect(categoryForCode('f_bundle old')).toBe('autoclaves');
    expect(categoryForCode('اوتوكلاف')).toBe('autoclaves');
    expect(categoryForCode('r2')).toBe('dental_units');
    expect(categoryForCode('r1_installment')).toBe('dental_units');
    expect(categoryForCode('روسن')).toBe('dental_units');
    expect(categoryForCode('toye e1')).toBe('dental_units');
    expect(categoryForCode('xsmile')).toBe('intraoral_cameras');
    expect(categoryForCode('camera')).toBe('intraoral_cameras');
    expect(categoryForCode('bleaching')).toBe('whitening');
    expect(categoryForCode('sealing')).toBe('sterilization');
    expect(categoryForCode('تجهيز')).toBe('clinic_packages');
    expect(categoryForCode('باكدج')).toBe('clinic_packages');
    expect(categoryForCode('c249')).toBeNull();
    expect(categoryForCode('test_name, test_name2')).toBeNull();
    expect(categoryForCode('')).toBeNull();
  });

  it('maps the referral to a source, merging the two WhatsApp spellings', () => {
    expect(sourceForReferral('Whatsapp')).toBe('whatsapp');
    expect(sourceForReferral('whatsapp')).toBe('whatsapp');
    expect(sourceForReferral('Facebook')).toBe('facebook');
    expect(sourceForReferral('Dental hub')).toBe('referral');
    expect(sourceForReferral('')).toBe('whatsapp');
  });

  it('maps the last status to the lead’s state', () => {
    expect(outcomeForStatus('Unknown')).toEqual({ kind: 'new' });
    expect(outcomeForStatus('')).toEqual({ kind: 'new' });
    expect(outcomeForStatus('غير مهتم')).toEqual({ kind: 'disqualified', reason: 'not_interested' });
    expect(outcomeForStatus('اشتري من برا')).toEqual({ kind: 'disqualified', reason: 'bought_elsewhere' });
    expect(outcomeForStatus('INVALID')).toEqual({ kind: 'disqualified', reason: 'wrong_number' });
    expect(outcomeForStatus('تم الشراء')).toEqual({ kind: 'won' });
    expect(outcomeForStatus('استلم و ركب')).toEqual({ kind: 'won' });
    expect(outcomeForStatus('إعادة الإتصال')).toEqual({ kind: 'contacted', callBack: true });
    expect(outcomeForStatus('اعادة الاتصال')).toEqual({ kind: 'contacted', callBack: true });
    expect(outcomeForStatus('متابعه مجدوله')).toEqual({ kind: 'contacted', callBack: true });
    expect(outcomeForStatus('مردش 1')).toEqual({ kind: 'contacted', callBack: false });
    expect(outcomeForStatus('لسا بيشوف')).toEqual({ kind: 'contacted', callBack: false });
  });

  it('leaves out Top Medical and Bojin', () => {
    expect(excludedBecause(client({ clientName: 'Top medical' }))).toBe('top_medical');
    expect(excludedBecause(client({ code: 'top medical' }))).toBe('top_medical');
    expect(excludedBecause(client({ code: 'bojin' }))).toBe('bojin');
    expect(excludedBecause(client({ code: 'بوجين' }))).toBe('bojin');
    expect(excludedBecause(client({ code: 'ksensor' }))).toBeNull();
  });

  it('spreads call backs over the next working days, ten a day, Fridays off', () => {
    expect(CALL_BACKS_PER_DAY).toBe(10);
    const tuesday = new Date('2026-10-27T08:00:00Z');
    const day = (index: number) => callBackDueAt(index, tuesday).toISOString();

    expect(day(0)).toBe(cairoTime('2026-10-28 10:00:00')?.toISOString());
    expect(day(9)).toBe(cairoTime('2026-10-28 10:00:00')?.toISOString());
    expect(day(10)).toBe(cairoTime('2026-10-29 10:00:00')?.toISOString());
    // Friday the 30th is skipped.
    expect(day(20)).toBe(cairoTime('2026-10-31 10:00:00')?.toISOString());
    // The day is Cairo's: just after midnight in Cairo is already the next day.
    expect(callBackDueAt(0, new Date('2026-10-27T22:30:00Z')).toISOString()).toBe(
      cairoTime('2026-10-29 10:00:00')?.toISOString(),
    );
  });

  it('reads Spider times as Cairo time, daylight saving included', () => {
    expect(cairoTime('2026-01-19 10:00:00')?.toISOString()).toBe('2026-01-19T08:00:00.000Z');
    expect(cairoTime('2026-07-01 10:00:00')?.toISOString()).toBe('2026-07-01T07:00:00.000Z');
    expect(cairoTime('not a date')).toBeNull();
  });
});

describe('the Spider team', () => {
  it('makes the company account the sales manager and marks the team leaders', () => {
    const team = spiderTeamFromRecords(
      [
        { 'First Name': 'Dental', 'Last Name': 'Hub', Title: 'Super Admin', Email: 'Boss@Spider.test' },
        { 'First Name': 'عبدلله محمد', 'Last Name': 'dental hub ', Title: 'team leader', Email: 'a@spider.test' },
        { 'First Name': 'سيف الدين سعيد', 'Last Name': 'dental hub', Title: 'sales', Email: 's@spider.test' },
        { 'First Name': 'اسراء', 'Last Name': 'بكري', Title: 'Sales', Email: 'e@spider.test' },
      ],
      { managerDisplayName: 'د. عبدالله رجب', teamLeaderNames: ['سيف الدين سعيد'] },
    );

    expect(team).toEqual([
      { spiderName: 'Dental Hub', displayName: 'د. عبدالله رجب', email: 'boss@spider.test', role: 'SALES_MANAGER' },
      { spiderName: 'عبدلله محمد', displayName: 'عبدلله محمد', email: 'a@spider.test', role: 'SALES_TEAM_LEADER' },
      { spiderName: 'سيف الدين سعيد', displayName: 'سيف الدين سعيد', email: 's@spider.test', role: 'SALES_TEAM_LEADER' },
      { spiderName: 'اسراء بكري', displayName: 'اسراء بكري', email: 'e@spider.test', role: 'SALES_REP' },
    ]);
  });
});

describe('planning the import', () => {
  it('names a customer only when Spider has a real name', () => {
    const plan = planSpiderImport(
      [
        client({ number: '1', clientName: 'Dental hub', phone: '+201001234561' }),
        client({ number: '2', clientName: 'Old Data', phone: '+201001234562' }),
        client({ number: '3', clientName: 'Dr Mona Clinic', phone: '+201001234563' }),
      ],
      TEAM,
    );
    const names = Object.fromEntries(plan.leads.map((lead) => [lead.spiderNumber, lead.contactName]));
    expect(names).toEqual({ '1': 'عميل Spider 1', '2': 'عميل Spider 2', '3': 'Dr Mona Clinic' });
    expect(plan.leads.find((lead) => lead.spiderNumber === '2')?.note).toContain('بيانات قديمة');
  });

  it('keeps the code, the last status and the notes in the lead note', () => {
    const [lead] = planSpiderImport(
      [client({ number: '7', code: 'ksensor', lastStatus: 'مردش 2', notes: 'H5', tags: 'IMPORTANT', phone: '+201001234567' })],
      TEAM,
    ).leads;
    expect(lead.note).toBe(
      ['مستورد من Spider (عميل رقم 7)', 'الكود: ksensor', 'آخر حالة: مردش 2', 'ملاحظات: H5', 'الوسوم: IMPORTANT'].join('\n'),
    );
    expect(lead.importRef).toBe('spider:7');

    const [referred] = planSpiderImport([client({ number: '8', referral: 'Dental hub', phone: '+201001234568' })], TEAM).leads;
    expect(referred.sourceCode).toBe('referral');
    expect(referred.note).toContain('ترشيح عن طريق الإدارة (المصدر في Spider: Dental hub)');
    expect(lead.categoryCode).toBe('xray_sensors');
  });

  it('folds an older client with the same phone into the newer one', () => {
    const plan = planSpiderImport(
      [
        client({ number: '10', phone: '+201001234567', lastStatus: 'مردش 1' }),
        client({ number: '20', phone: '+201001234567', lastStatus: 'لسا بيشوف' }),
      ],
      TEAM,
    );
    expect(plan.leads.map((lead) => lead.spiderNumber)).toEqual(['20']);
    expect(plan.duplicates).toEqual([{ spiderNumber: '10', keptSpiderNumber: '20' }]);
    expect(plan.leads[0].note).toContain('مكرر في Spider: عميل رقم 10 (آخر حالة: مردش 1)');
  });

  it('leaves out excluded clients and reports owners it does not know', () => {
    const plan = planSpiderImport(
      [
        client({ number: '1', clientName: 'Top medical' }),
        client({ number: '2', member: 'Somebody Else dental hub' }),
        client({ number: '3', phone: '+201001234567' }),
      ],
      TEAM,
    );
    expect(plan.excluded).toEqual([{ spiderNumber: '1', because: 'top_medical' }]);
    expect(plan.unknownMembers).toEqual(['Somebody Else dental hub']);
    expect(plan.leads.map((lead) => lead.spiderNumber)).toEqual(['3']);
  });

  it('keeps a phone it could not read in the note', () => {
    const [lead] = planSpiderImport([client({ number: '4', phone: '+201.001234567E+21' })], TEAM).leads;
    expect(lead.phones).toEqual([]);
    expect(lead.note).toContain('هاتف غير مقروء: +201.001234567E+21');
  });
});

describe('writing the import', () => {
  let database: DisposableDatabase;
  let db: Client;
  let repId: string;
  const ownerIds = new Map<string, string>();

  beforeAll(async () => {
    database = await createDisposableDatabase();
    db = new Client({ connectionString: database.url });
    await db.connect();
    await runMigrations(db);
    repId = (
      await createUser(db, {
        displayName: 'Test Rep',
        email: `${uniqueToken('spider.rep')}@test.com`,
        password: 'Password123!',
        role: 'SALES_REP',
      })
    ).id;
    ownerIds.set('Test Rep', repId);
  });

  afterAll(async () => {
    await db.end();
    await dropDisposableDatabase(database);
  });

  async function contactWithPhone(fullName: string, phone: string) {
    const contact = await createContact(db, { fullName });
    await db.query(`INSERT INTO crm_contact_channel (contact_id, channel_type, value) VALUES ($1, 'PHONE', $2)`, [
      contact.id,
      phone,
    ]);
    return contact;
  }

  const plan = () =>
    planSpiderImport(
      [
        client({ number: '101', phone: '+201001110001', lastStatus: 'Unknown', code: 'ksensor', createdAt: '2026-03-02 11:00:00' }),
        client({ number: '102', phone: '+201001110002', lastStatus: 'غير مهتم', referral: 'Facebook' }),
        client({ number: '103', phone: '+201001110003', lastStatus: 'تم الشراء', code: 'r2' }),
        client({ number: '104', phone: '+201001110004', lastStatus: 'إعادة الإتصال' }),
        client({ number: '105', phone: '+201001110005', lastStatus: 'مردش 1' }),
      ],
      TEAM,
    );

  it('writes contacts, leads, won deals and call backs', async () => {
    // A customer already in the CRM, with an open lead, keeps that lead.
    const existing = await contactWithPhone('Already here', '+201001110005');
    const { rows: sources } = await db.query<{ id: string }>(`SELECT id FROM crm_source WHERE code = 'whatsapp'`);
    await createLead(db, {
      sourceId: sources[0].id,
      campaignId: null,
      contactId: existing.id,
      accountId: null,
      productCategoryId: null,
      note: null,
      ownerUserId: repId,
    });

    const now = new Date('2026-10-27T08:00:00Z');
    const result = await writeSpiderImport(db, plan(), ownerIds, now);

    expect(result).toEqual({
      created: 4,
      alreadyImported: 0,
      reusedContacts: 0,
      skippedOpenLead: ['105'],
      won: 1,
      callBacks: 1,
    });

    const { rows } = await db.query<{
      import_ref: string;
      status: string;
      reason: string | null;
      category: string | null;
      source: string;
      received_at: Date;
      created_at: Date;
      full_name: string;
      phone: string;
      is_whatsapp: boolean;
      owner_user_id: string;
    }>(
      `SELECT l.import_ref, l.status, r.code AS reason, pc.code AS category, s.code AS source,
              l.received_at, l.created_at, c.full_name, ch.value AS phone, ch.is_whatsapp, l.owner_user_id
         FROM crm_lead l
         JOIN crm_contact c ON c.id = l.contact_id
         JOIN crm_source s ON s.id = l.source_id
         JOIN crm_contact_channel ch ON ch.contact_id = c.id
         LEFT JOIN crm_outcome_reason r ON r.id = l.disqualify_reason_id
         LEFT JOIN crm_product_category pc ON pc.id = l.product_category_id
        WHERE l.import_ref IS NOT NULL
        ORDER BY l.import_ref`,
    );
    expect(rows.map((row) => [row.import_ref, row.status, row.reason, row.category, row.source])).toEqual([
      ['spider:101', 'NEW', null, 'xray_sensors', 'whatsapp'],
      ['spider:102', 'DISQUALIFIED', 'not_interested', null, 'facebook'],
      ['spider:103', 'CONTACTED', null, 'dental_units', 'whatsapp'],
      ['spider:104', 'CONTACTED', null, null, 'whatsapp'],
    ]);
    const first = rows[0];
    expect(first.received_at.toISOString()).toBe('2026-03-02T09:00:00.000Z');
    expect(first.created_at.toISOString()).toBe('2026-03-02T09:00:00.000Z');
    expect(first).toMatchObject({ full_name: 'عميل Spider 101', phone: '+201001110001', is_whatsapp: true, owner_user_id: repId });
    expect(rows[1].is_whatsapp).toBe(false);

    const { rows: won } = await db.query<{ stage: string; won_at: Date; history: string }>(
      `SELECT o.stage, o.won_at, h.to_stage AS history
         FROM crm_opportunity o
         JOIN crm_lead l ON l.id = o.lead_id
         JOIN crm_opportunity_stage_history h ON h.opportunity_id = o.id
        WHERE l.import_ref = 'spider:103'`,
    );
    expect(won).toEqual([{ stage: 'WON', won_at: new Date('2026-05-01T07:00:00Z'), history: 'WON' }]);

    const { rows: calls } = await db.query<{ action_type: string; due_at: Date; owner_user_id: string; completed_at: Date | null }>(
      `SELECT f.action_type, f.due_at, f.owner_user_id, f.completed_at
         FROM crm_followup f JOIN crm_lead l ON l.id = f.lead_id
        WHERE l.import_ref = 'spider:104'`,
    );
    expect(calls).toEqual([
      { action_type: 'CALL', due_at: callBackDueAt(0, now), owner_user_id: repId, completed_at: null },
    ]);
  });

  it('skips what is already imported when run again', async () => {
    const result = await writeSpiderImport(db, plan(), ownerIds);
    expect(result).toMatchObject({ created: 0, alreadyImported: 4, skippedOpenLead: ['105'] });

    const { rows } = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM crm_lead WHERE import_ref LIKE 'spider:%'`);
    expect(rows[0].count).toBe('4');
  });

  it('puts a lead on the contact who already has that phone when they have no open lead', async () => {
    await contactWithPhone('Known customer', '+201001110099');

    const result = await writeSpiderImport(
      db,
      planSpiderImport([client({ number: '199', phone: '+201001110099', lastStatus: 'مردش 1' })], TEAM),
      ownerIds,
    );

    expect(result).toMatchObject({ created: 1, reusedContacts: 1 });
    const { rows } = await db.query<{ full_name: string }>(
      `SELECT c.full_name FROM crm_lead l JOIN crm_contact c ON c.id = l.contact_id WHERE l.import_ref = 'spider:199'`,
    );
    expect(rows[0].full_name).toBe('Known customer');
  });
});
