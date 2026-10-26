/**
 * One-time import of the Spider CRM exports.
 *
 * Spider was used as a call log: every client row carries its owner, a phone,
 * a "Contact Name" that the team used for the campaign or product code
 * (ksensor, fomos, r2...), and the last call status. There are no stages, no
 * products and no deal values, so the import brings over what is there:
 *
 *   - each client becomes a contact (with their phone numbers) and a lead
 *     owned by the same person, received when Spider created the client;
 *   - the product code picks the product category;
 *   - the last status decides the lead's state: never called stays NEW, "not
 *     interested" / "bought elsewhere" / "invalid" are disqualified with that
 *     reason, a purchase becomes a WON opportunity, a "call back" also gets a
 *     pending call in the owner's queue, and everything else is CONTACTED;
 *   - the code, the last status and Spider's notes are kept in the lead note.
 *
 * Planning (pure, no database) and writing are separate, so a dry run can
 * show exactly what would happen before anything is written. Every imported
 * lead carries `import_ref = 'spider:<number>'`, so running it again skips
 * what is already there.
 */
import type { Db } from '@/server/db/types';
import type { Role } from '@/server/authz/permissions';
import { normalisePhoneToE164 } from '@/server/crm/contacts/phone';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface SpiderClient {
  number: string;
  member: string;
  clientName: string;
  code: string;
  phone: string;
  notes: string;
  lastStatus: string;
  referral: string;
  createdAt: string;
  tags: string;
}

/** A row of the Spider "Clients" export, keyed by its header. */
export function spiderClientFromRecord(record: Record<string, string>): SpiderClient {
  return {
    number: clean(record['Number']),
    member: clean(record['Member']),
    clientName: clean(record['Client Name']),
    code: clean(record['Contact Name']),
    phone: record['Contact Phone'] ?? '',
    notes: clean(record['Notes']),
    lastStatus: clean(record['Last Status']),
    referral: clean(record['Referral']),
    createdAt: clean(record['Created At']),
    tags: clean(record['Tags']),
  };
}

export interface SpiderTeamMember {
  /** How client rows name this person in their "Member" column. */
  spiderName: string;
  displayName: string;
  email: string;
  role: Role;
}

export interface SpiderTeamOptions {
  /** The display name for Spider's company "Super Admin" account, who becomes the sales manager. */
  managerDisplayName: string;
  /** Members who lead a team, by their Spider name. Spider's own "team leader" title also counts. */
  teamLeaderNames: string[];
}

/** The rows of the Spider "Team" export as CRM users. */
export function spiderTeamFromRecords(
  records: Record<string, string>[],
  options: SpiderTeamOptions,
): SpiderTeamMember[] {
  const leaders = new Set(options.teamLeaderNames.map(memberKey));
  return records.map((record) => {
    const first = clean(record['First Name']);
    const last = clean(record['Last Name']);
    const title = matchKey(record['Title'] ?? '');
    const spiderName = matchKey(last) === 'dentalhub' ? first : `${first} ${last}`.trim();
    const email = clean(record['Email']).toLowerCase();

    if (title === 'superadmin') {
      return { spiderName, displayName: options.managerDisplayName, email, role: 'SALES_MANAGER' };
    }
    const role: Role = title === 'teamleader' || leaders.has(memberKey(spiderName)) ? 'SALES_TEAM_LEADER' : 'SALES_REP';
    return { spiderName, displayName: spiderName, email, role };
  });
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Trimmed, single-spaced, and empty for Spider's "N/A" / "none" placeholders. */
export function clean(value: string | undefined): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return /^(n\/a|none|null|unknown)$/i.test(text) ? '' : text;
}

/** For matching only: lower case, unified Arabic letter forms, no spaces. */
export function matchKey(value: string): string {
  return clean(value)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ً-ْ]/g, '')
    .replace(/\s+/g, '');
}

/** Client rows write the owner as "<name> dental hub", the team list as the bare name. */
export function memberKey(value: string): string {
  return matchKey(value).replace(/dentalhub$/, '');
}

// ---------------------------------------------------------------------------
// Phones
// ---------------------------------------------------------------------------

/**
 * Country codes that Spider wrongly prefixed with +20 ("+20966..." is a Saudi
 * number). Only tried when the number is not a valid Egyptian one.
 */
const FOREIGN_COUNTRY_CODES = [
  '966', '971', '965', '974', '968', '973', '962', '964', '961', '963', '967', '970',
  '249', '218', '212', '216', '213', '380', '90', '44', '49', '33', '1',
];

const ARABIC_DIGIT = /[٠-٩۰-۹]/g;

function fixOne(candidate: string): string | null {
  let value = candidate;
  // A doubled country code (+20 20 10...) or a kept trunk zero (+20 0 10...).
  if (/^\+2020\d{10}$/.test(value)) value = `+20${value.slice(5)}`;
  else if (/^\+200\d{10}$/.test(value)) value = `+20${value.slice(4)}`;

  try {
    return normalisePhoneToE164(value);
  } catch {
    if (value.startsWith('+20')) {
      const rest = value.slice(3);
      if (FOREIGN_COUNTRY_CODES.some((code) => rest.startsWith(code)) && /^[1-9]\d{6,14}$/.test(rest)) {
        return `+${rest}`;
      }
    }
    return null;
  }
}

/**
 * Every phone number in a Spider "Contact Phone" cell, as E.164. A cell can
 * hold two numbers ("+2010...,+2011..." or run together) and stray text.
 */
export function parseSpiderPhones(raw: string): { phones: string[]; rejected: string[] } {
  const text = raw
    .replace(ARABIC_DIGIT, (digit) => {
      const code = digit.charCodeAt(0);
      return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
    })
    .replace(/^="?|"$/g, '');

  const phones: string[] = [];
  const rejected: string[] = [];
  for (const part of text.split(/[,،/;]/)) {
    // Excel turned some numbers into scientific notation, losing digits for good.
    if (/\d[.]?\d*e\+?\d+\s*$/i.test(part)) {
      rejected.push(part.trim());
      continue;
    }
    const compact = part.replace(/[^\d+]/g, '').replace(/^\++/, '+');
    if (compact.replace(/\D/g, '').length === 0) continue;
    // Two numbers run together: "+2010...+2011..."
    const pieces = compact.split(/(?=\+)/).filter((piece) => piece.replace(/\D/g, '').length > 0);
    for (const piece of pieces) {
      const phone = fixOne(piece);
      if (phone) {
        if (!phones.includes(phone)) phones.push(phone);
      } else {
        rejected.push(piece);
      }
    }
  }
  return { phones, rejected };
}

// ---------------------------------------------------------------------------
// Codes, sources and statuses
// ---------------------------------------------------------------------------

/** The first rule that matches the code (lower-cased, single-spaced) wins. */
const CATEGORY_RULES: readonly [RegExp, string][] = [
  [/k ?sens|sensor|سنسور|ai ?ray|airay|x ?ray/, 'xray_sensors'],
  [/bleach|بليتش|تبييض/, 'whitening'],
  [/x ?smile|camera|كاميرا|^x$|^x /, 'intraoral_cameras'],
  [/seal|distill|تعقيم/, 'sterilization'],
  [/fomos|فوموس|autoclave|اوتوكلاف|أوتوكلاف|class ?n|كلاس|^f$|^f[ _]|^fb\b|^fo_|^insta?_f|^inst_f|^ista_f|bundle|باندل/, 'autoclaves'],
  [/roson|روسن|روسون|^r$|^r[\d _/-]|r1|r2|a3s|a1 pro|\bs6\b|toye|unit|يونت|wellin|ويلن|younker/, 'dental_units'],
  [/clinic|تجهيز|باكدج|package|^pac|عياد|باقه|باقة/, 'clinic_packages'],
  [/scaler/, 'scalers'],
  [/compressor|كمبروسر/, 'compressors'],
];

export function categoryForCode(code: string): string | null {
  const text = clean(code).toLowerCase();
  if (!text) return null;
  return CATEGORY_RULES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

export function sourceForReferral(referral: string): string {
  const key = matchKey(referral);
  if (key === 'facebook') return 'facebook';
  if (key === 'instagram') return 'instagram';
  // "Dental hub" marks a client the company reached itself.
  if (key === 'dentalhub') return 'outbound';
  return 'whatsapp';
}

export type LeadOutcome =
  | { kind: 'new' }
  | { kind: 'contacted'; callBack: boolean }
  | { kind: 'disqualified'; reason: 'not_interested' | 'bought_elsewhere' | 'wrong_number' }
  | { kind: 'won' };

const STATUS_OUTCOMES: Record<string, LeadOutcome> = {
  [matchKey('غير مهتم')]: { kind: 'disqualified', reason: 'not_interested' },
  [matchKey('اشتري من برا')]: { kind: 'disqualified', reason: 'bought_elsewhere' },
  [matchKey('INVALID')]: { kind: 'disqualified', reason: 'wrong_number' },
  [matchKey('تم الشراء')]: { kind: 'won' },
  [matchKey('استلم و ركب')]: { kind: 'won' },
  [matchKey('ف مرحله التنفيذ')]: { kind: 'won' },
  [matchKey('حجز واستلام بعد فتره')]: { kind: 'won' },
  [matchKey('إعادة الإتصال')]: { kind: 'contacted', callBack: true },
  [matchKey('متابعه مجدوله')]: { kind: 'contacted', callBack: true },
};

/** What Spider's "Last Status" means for the imported lead. */
export function outcomeForStatus(lastStatus: string): LeadOutcome {
  const key = matchKey(lastStatus);
  if (!key) return { kind: 'new' };
  return STATUS_OUTCOMES[key] ?? { kind: 'contacted', callBack: false };
}

/** Spider's "Client Name" is mostly the company name or "Old Data", not the customer. */
export function isPlaceholderName(name: string): boolean {
  const key = matchKey(name);
  return key === '' || /^dental?hu/.test(key) || key === 'dental' || key === 'دنتالهاب' || key === 'olddata';
}

/** Clients the import leaves out: Top Medical and Bojin belong to another business. */
export function excludedBecause(client: SpiderClient): 'top_medical' | 'bojin' | null {
  const text = matchKey(`${client.clientName} ${client.code}`);
  if (/topmedical|توبميديكال/.test(text)) return 'top_medical';
  if (/bojin|pojin|بوجين/.test(text)) return 'bojin';
  return null;
}

/** "2026-10-26 12:56:05" on Cairo time, as an instant. */
export function cairoTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(clean(value));
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  // Cairo's offset at that moment (it changes with daylight saving).
  const offsetAt = (instant: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo',
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
        .formatToParts(new Date(instant))
        .map((part) => [part.type, part.value]),
    );
    const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return local - instant;
  };
  const first = asUtc - offsetAt(asUtc);
  return new Date(asUtc - offsetAt(first));
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface PlannedLead {
  importRef: string;
  spiderNumber: string;
  ownerSpiderName: string;
  contactName: string;
  phones: string[];
  sourceCode: string;
  categoryCode: string | null;
  outcome: LeadOutcome;
  receivedAt: Date;
  note: string;
}

export interface SpiderImportPlan {
  team: SpiderTeamMember[];
  leads: PlannedLead[];
  excluded: { spiderNumber: string; because: 'top_medical' | 'bojin' }[];
  /** Clients folded into another client that has the same phone number. */
  duplicates: { spiderNumber: string; keptSpiderNumber: string }[];
  /** Cell text that is not a usable phone number, by client. */
  rejectedPhones: { spiderNumber: string; value: string }[];
  /** Owners in the client rows that are not on the team list. */
  unknownMembers: string[];
  unmappedCodes: Map<string, number>;
}

function noteFor(client: SpiderClient, extra: string[]): string {
  const lines = [`مستورد من Spider (عميل رقم ${client.number})`];
  if (isPlaceholderName(client.clientName) && matchKey(client.clientName) === 'olddata') lines.push('بيانات قديمة');
  if (client.code) lines.push(`الكود: ${client.code}`);
  if (client.lastStatus) lines.push(`آخر حالة: ${client.lastStatus}`);
  if (client.notes) lines.push(`ملاحظات: ${client.notes}`);
  if (client.tags) lines.push(`الوسوم: ${client.tags}`);
  return [...lines, ...extra].join('\n').slice(0, 5000);
}

/**
 * Turns the export rows into the leads to write. Newer clients win a shared
 * phone number: Spider kept duplicates, and the newer row carries the latest
 * status, so the older one is noted on it and not imported separately.
 */
export function planSpiderImport(clients: SpiderClient[], team: SpiderTeamMember[]): SpiderImportPlan {
  const members = new Map(team.map((member) => [memberKey(member.spiderName), member]));
  const plan: SpiderImportPlan = {
    team,
    leads: [],
    excluded: [],
    duplicates: [],
    rejectedPhones: [],
    unknownMembers: [],
    unmappedCodes: new Map(),
  };

  const newestFirst = [...clients].sort((a, b) => Number(b.number) - Number(a.number));
  const phoneOwner = new Map<string, PlannedLead>();
  const unknown = new Set<string>();

  for (const client of newestFirst) {
    const because = excludedBecause(client);
    if (because) {
      plan.excluded.push({ spiderNumber: client.number, because });
      continue;
    }

    const member = members.get(memberKey(client.member));
    if (!member) {
      unknown.add(client.member || '(empty)');
      continue;
    }

    const { phones, rejected } = parseSpiderPhones(client.phone);
    for (const value of rejected) plan.rejectedPhones.push({ spiderNumber: client.number, value });

    const kept = phones[0] ? phoneOwner.get(phones[0]) : undefined;
    if (kept) {
      plan.duplicates.push({ spiderNumber: client.number, keptSpiderNumber: kept.spiderNumber });
      kept.note = `${kept.note}\nمكرر في Spider: عميل رقم ${client.number}${client.lastStatus ? ` (آخر حالة: ${client.lastStatus})` : ''}`.slice(0, 5000);
      continue;
    }

    const categoryCode = categoryForCode(client.code);
    if (!categoryCode && client.code) {
      const key = client.code.toLowerCase();
      plan.unmappedCodes.set(key, (plan.unmappedCodes.get(key) ?? 0) + 1);
    }

    const lead: PlannedLead = {
      importRef: `spider:${client.number}`,
      spiderNumber: client.number,
      ownerSpiderName: member.spiderName,
      contactName: isPlaceholderName(client.clientName)
        ? `عميل Spider ${client.number}`
        : client.clientName.slice(0, 200),
      phones: phones.filter((phone) => !phoneOwner.has(phone)),
      sourceCode: sourceForReferral(client.referral),
      categoryCode,
      outcome: outcomeForStatus(client.lastStatus),
      receivedAt: cairoTime(client.createdAt) ?? new Date(),
      // Nothing from the old record is dropped: an unreadable phone stays visible.
      note: noteFor(client, rejected.length > 0 ? [`هاتف غير مقروء: ${rejected.join('، ')}`] : []),
    };
    for (const phone of lead.phones) phoneOwner.set(phone, lead);
    plan.leads.push(lead);
  }

  plan.unknownMembers = [...unknown];
  return plan;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface SpiderImportResult {
  created: number;
  alreadyImported: number;
  /** The phone already belonged to a contact in the CRM; the lead went on that contact. */
  reusedContacts: number;
  /** That existing contact already had an open lead, so this one was not added. */
  skippedOpenLead: string[];
  won: number;
  callBacks: number;
}

async function idsByCode(db: Db, sql: string): Promise<Map<string, string>> {
  const { rows } = await db.query<{ id: string; code: string }>(sql);
  return new Map(rows.map((row) => [row.code, row.id]));
}

/**
 * Writes the planned leads. Runs inside the caller's transaction: the whole
 * import commits or none of it does. `ownerIds` maps a team member's Spider
 * name to their CRM user id.
 */
export async function writeSpiderImport(
  db: Db,
  plan: SpiderImportPlan,
  ownerIds: Map<string, string>,
  now: Date = new Date(),
): Promise<SpiderImportResult> {
  const sources = await idsByCode(db, 'SELECT id, code FROM crm_source');
  const categories = await idsByCode(db, 'SELECT id, code FROM crm_product_category');
  const reasons = await idsByCode(db, `SELECT id, code FROM crm_outcome_reason WHERE kind = 'disqualify'`);
  const { rows: existing } = await db.query<{ import_ref: string }>(
    `SELECT import_ref FROM crm_lead WHERE import_ref LIKE 'spider:%'`,
  );
  const imported = new Set(existing.map((row) => row.import_ref));

  const result: SpiderImportResult = {
    created: 0,
    alreadyImported: 0,
    reusedContacts: 0,
    skippedOpenLead: [],
    won: 0,
    callBacks: 0,
  };

  for (const lead of plan.leads) {
    if (imported.has(lead.importRef)) {
      result.alreadyImported++;
      continue;
    }
    const ownerUserId = ownerIds.get(lead.ownerSpiderName);
    if (!ownerUserId) throw new Error(`No CRM user for Spider member "${lead.ownerSpiderName}".`);
    const sourceId = sources.get(lead.sourceCode);
    if (!sourceId) throw new Error(`Unknown source "${lead.sourceCode}".`);
    const categoryId = lead.categoryCode ? (categories.get(lead.categoryCode) ?? null) : null;

    // A phone already in the CRM is that contact's identity: the lead joins it.
    let contactId: string | null = null;
    if (lead.phones.length > 0) {
      const { rows } = await db.query<{ contact_id: string }>(
        `SELECT contact_id FROM crm_contact_channel WHERE channel_type = 'PHONE' AND value = ANY($1::text[]) LIMIT 1`,
        [lead.phones],
      );
      contactId = rows[0]?.contact_id ?? null;
    }
    if (contactId) {
      const { rows: open } = await db.query(
        `SELECT 1 FROM crm_lead l
          WHERE l.contact_id = $1 AND l.status <> 'DISQUALIFIED' AND l.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM crm_opportunity o WHERE o.lead_id = l.id)`,
        [contactId],
      );
      if (open.length > 0 && lead.outcome.kind !== 'disqualified' && lead.outcome.kind !== 'won') {
        result.skippedOpenLead.push(lead.spiderNumber);
        continue;
      }
      result.reusedContacts++;
    } else {
      const { rows } = await db.query<{ id: string }>(
        'INSERT INTO crm_contact (full_name, created_at) VALUES ($1, $2) RETURNING id',
        [lead.contactName, lead.receivedAt],
      );
      contactId = rows[0].id;
      for (const phone of lead.phones) {
        await db.query(
          `INSERT INTO crm_contact_channel (contact_id, channel_type, value, is_whatsapp)
           VALUES ($1, 'PHONE', $2, $3)
           ON CONFLICT DO NOTHING`,
          [contactId, phone, lead.sourceCode === 'whatsapp'],
        );
      }
    }

    const outcome = lead.outcome;
    const status = outcome.kind === 'new' ? 'NEW' : outcome.kind === 'disqualified' ? 'DISQUALIFIED' : 'CONTACTED';
    const reasonId = outcome.kind === 'disqualified' ? reasons.get(outcome.reason) : null;
    if (outcome.kind === 'disqualified' && !reasonId) throw new Error(`Unknown disqualify reason "${outcome.reason}".`);

    const { rows: leadRows } = await db.query<{ id: string }>(
      `INSERT INTO crm_lead (source_id, contact_id, product_category_id, status, note, owner_user_id,
                             received_at, disqualified_at, disqualify_reason_id, created_at, import_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $7, $10)
       RETURNING id`,
      [
        sourceId,
        contactId,
        categoryId,
        status,
        lead.note,
        ownerUserId,
        lead.receivedAt,
        reasonId ? lead.receivedAt : null,
        reasonId ?? null,
        lead.importRef,
      ],
    );
    const leadId = leadRows[0].id;
    result.created++;

    if (outcome.kind === 'won') {
      // Spider has no deal date or value: the sale is dated when the client was
      // entered, and the value is left for the owner to fill in.
      const { rows: opportunityRows } = await db.query<{ id: string }>(
        `INSERT INTO crm_opportunity (lead_id, contact_id, owner_user_id, product_category_id, stage,
                                      won_at, created_at, notes)
         VALUES ($1, $2, $3, $4, 'WON', $5, $5, $6)
         RETURNING id`,
        [leadId, contactId, ownerUserId, categoryId, lead.receivedAt, 'مستورد من Spider'],
      );
      await db.query(
        `INSERT INTO crm_opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_at, note)
         VALUES ($1, NULL, 'WON', $2, $3)`,
        [opportunityRows[0].id, lead.receivedAt, 'مستورد من Spider'],
      );
      result.won++;
    }

    if (outcome.kind === 'contacted' && outcome.callBack) {
      await db.query(
        `INSERT INTO crm_followup (lead_id, owner_user_id, action_type, note, due_at)
         VALUES ($1, $2, 'CALL', $3, $4)`,
        [leadId, ownerUserId, 'معاودة اتصال من Spider', now],
      );
      result.callBacks++;
    }
  }

  return result;
}
