import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { connectTestDb, uniqueToken } from './setup/db';
import {
  DuplicateAccountContactError,
  PrimaryContactConflictError,
  createAccount,
  linkContactToAccount,
  listAccountsForContact,
  listContactsForAccount,
} from '../../src/server/crm/accounts/repository';
import {
  DuplicateContactEmailError,
  DuplicatePhoneError,
  addPhoneChannel,
  createContact,
  findContactById,
  findContactByPhone,
  listContactChannels,
} from '../../src/server/crm/contacts/repository';
import { InvalidPhoneError, normalisePhoneToE164 } from '../../src/server/crm/contacts/phone';
import { createProduct, createProductCategory } from '../../src/server/crm/catalog/repository';

let db: Client;

beforeAll(async () => {
  db = await connectTestDb();
});

afterAll(async () => {
  await db.end();
});

describe('accounts', () => {
  it('does not treat account names as globally unique', async () => {
    const name = uniqueToken('Bright Smile Dental');
    const first = await createAccount(db, { name });
    const second = await createAccount(db, { name });

    expect(second.id).not.toBe(first.id);
  });
});

describe('contacts', () => {
  it('carries no account reference of its own', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'crm_contact'`,
    );
    expect(rows.map((row) => row.column_name)).not.toContain('account_id');
  });

  it('normalises email to lowercase trimmed form', async () => {
    const contact = await createContact(db, {
      fullName: 'Email Person',
      email: `  ${uniqueToken('Person')}@Example.COM `,
    });

    expect(contact.email).toBe(contact.email?.toLowerCase());
    expect(contact.email).toBe(contact.email?.trim());
  });

  it('treats an absent email as no email at all', async () => {
    const blank = await createContact(db, { fullName: 'Blank Email', email: '   ' });
    expect(blank.email).toBeNull();
  });

  it('lets any number of contacts have no email (NULLS DISTINCT)', async () => {
    await createContact(db, { fullName: 'No Email One' });
    await createContact(db, { fullName: 'No Email Two' });

    const { rows } = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM crm_contact WHERE email IS NULL',
    );
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(2);
  });

  it('rejects a duplicate email, whatever the casing', async () => {
    const email = `${uniqueToken('dup')}@dentalhub.test`;
    await createContact(db, { fullName: 'First', email });

    await expect(
      createContact(db, { fullName: 'Second', email: ` ${email.toUpperCase()} ` }),
    ).rejects.toBeInstanceOf(DuplicateContactEmailError);

    // The constraint itself, not just the repository, refuses the duplicate.
    await expect(
      db.query('INSERT INTO crm_contact (full_name, email) VALUES ($1, $2)', ['Raw', email]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('lets the database itself refuse a non-normalised email', async () => {
    await expect(
      db.query(`INSERT INTO crm_contact (full_name, email) VALUES ('Raw', '  HasSpace@x.co  ')`),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('account-contact relationships', () => {
  it('lets one contact relate to many accounts', async () => {
    const contact = await createContact(db, { fullName: 'Multi Account' });
    const accountA = await createAccount(db, { name: uniqueToken('Clinic A') });
    const accountB = await createAccount(db, { name: uniqueToken('Clinic B') });

    await linkContactToAccount(db, { accountId: accountA.id, contactId: contact.id });
    await linkContactToAccount(db, { accountId: accountB.id, contactId: contact.id });

    const accounts = await listAccountsForContact(db, contact.id);
    expect(accounts.map((link) => link.accountId).sort()).toEqual(
      [accountA.id, accountB.id].sort(),
    );
    expect(await listContactsForAccount(db, accountA.id)).toHaveLength(1);
  });

  it('rejects the same account-contact pair twice', async () => {
    const contact = await createContact(db, { fullName: 'Duplicate Link' });
    const account = await createAccount(db, { name: uniqueToken('Clinic') });

    await linkContactToAccount(db, { accountId: account.id, contactId: contact.id });
    await expect(
      linkContactToAccount(db, { accountId: account.id, contactId: contact.id }),
    ).rejects.toBeInstanceOf(DuplicateAccountContactError);

    // The pair unique constraint itself refuses it.
    await expect(
      db.query('INSERT INTO crm_account_contact (account_id, contact_id) VALUES ($1, $2)', [
        account.id,
        contact.id,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('requires both sides of a link to exist', async () => {
    const contact = await createContact(db, { fullName: 'FK Contact' });
    const account = await createAccount(db, { name: uniqueToken('FK Clinic') });

    await expect(
      linkContactToAccount(db, { accountId: randomUUID(), contactId: contact.id }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      linkContactToAccount(db, { accountId: account.id, contactId: randomUUID() }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('allows at most one primary contact per account', async () => {
    const account = await createAccount(db, { name: uniqueToken('Primary Clinic') });
    const first = await createContact(db, { fullName: 'Primary One' });
    const second = await createContact(db, { fullName: 'Primary Two' });

    await linkContactToAccount(db, { accountId: account.id, contactId: first.id, isPrimary: true });
    // A non-primary second contact is fine.
    await linkContactToAccount(db, { accountId: account.id, contactId: second.id });
    // A second primary is not.
    await expect(
      linkContactToAccount(db, { accountId: account.id, contactId: second.id, isPrimary: true }),
    ).rejects.toBeInstanceOf(DuplicateAccountContactError);

    const other = await createContact(db, { fullName: 'Primary Three' });
    await expect(
      linkContactToAccount(db, { accountId: account.id, contactId: other.id, isPrimary: true }),
    ).rejects.toBeInstanceOf(PrimaryContactConflictError);
  });
});

describe('canonical phone identity', () => {
  it('normalises Egyptian local numbers to E.164', () => {
    const canonical = '+201012345678';

    expect(normalisePhoneToE164('01012345678')).toBe(canonical);
    expect(normalisePhoneToE164('010 1234 5678')).toBe(canonical);
    expect(normalisePhoneToE164('(010) 123-45678')).toBe(canonical);
    expect(normalisePhoneToE164('+20 10 1234 5678')).toBe(canonical);
    expect(normalisePhoneToE164('0020 101 234 5678')).toBe(canonical);
    expect(normalisePhoneToE164('201012345678')).toBe(canonical);
    expect(normalisePhoneToE164('10 1234 5678')).toBe(canonical);
    expect(normalisePhoneToE164('٠١٠١٢٣٤٥٦٧٨')).toBe(canonical);
    expect(normalisePhoneToE164('۰۱۰۱۲۳۴۵۶۷۸')).toBe(canonical);
    expect(normalisePhoneToE164('\u200F01012345678')).toBe(canonical);
    expect(normalisePhoneToE164('٠١٠٠١٢٣٤٥٦٧')).toBe('+201001234567');

    // Cairo landline: trunk form, country-code form and bare national form agree.
    expect(normalisePhoneToE164('02 2345 6789')).toBe('+20223456789');
    expect(normalisePhoneToE164('20223456789')).toBe('+20223456789');
    expect(normalisePhoneToE164('03 4567890')).toBe('+2034567890');

    // Already-international non-Egyptian numbers pass through untouched.
    expect(normalisePhoneToE164('+1 (415) 555-0132')).toBe('+14155550132');
  });

  it('rejects invalid phone numbers', () => {
    for (const bad of [
      '', '   ', 'abc', '+', '01012', '010123456789012345678', '010-1234-ab',
      '1001234', '0100123456789', '01312345678', '0101234567',
      '+201312345678', '0020 131 234 5678', '201312345678',
    ]) {
      expect(() => normalisePhoneToE164(bad)).toThrow(InvalidPhoneError);
    }
  });

  it('stores the canonical E.164 value regardless of input format', async () => {
    const contact = await createContact(db, { fullName: 'Phone Owner' });
    const channel = await addPhoneChannel(db, { contactId: contact.id, phone: '010 1234 5678' });

    expect(channel.value).toBe('+201012345678');
  });

  it('never lets the same canonical phone belong to two contacts', async () => {
    const first = await createContact(db, { fullName: 'Phone First' });
    const second = await createContact(db, { fullName: 'Phone Second' });
    const prefix = ['010', '011', '012', '015'][Math.floor(Math.random() * 4)];
    const phone = `${prefix}${Math.floor(10000000 + Math.random() * 90000000)}`;

    await addPhoneChannel(db, { contactId: first.id, phone });

    // A different dialling format is still the same identity.
    await expect(
      addPhoneChannel(db, { contactId: second.id, phone: `+20 ${phone.slice(1)}` }),
    ).rejects.toBeInstanceOf(DuplicatePhoneError);

    // The unique index itself refuses it, even bypassing the repository.
    await expect(
      db.query(
        `INSERT INTO crm_contact_channel (contact_id, channel_type, value)
         VALUES ($1, 'PHONE', $2)`,
        [second.id, normalisePhoneToE164(phone)],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('resolves a contact by phone in any dialling format', async () => {
    const contact = await createContact(db, { fullName: 'Lookup Target' });
    const phone = `012${Math.floor(10000000 + Math.random() * 89999999)}`;
    await addPhoneChannel(db, { contactId: contact.id, phone });

    expect((await findContactByPhone(db, `+20${phone.slice(1)}`))?.id).toBe(contact.id);
    expect((await findContactByPhone(db, `00 20 ${phone.slice(1)}`))?.id).toBe(contact.id);
    const arabicPhone = phone.replace(/[0-9]/g, (digit) => String.fromCharCode(0x0660 + Number(digit)));
    expect((await findContactByPhone(db, `\u200F${arabicPhone}`))?.id).toBe(contact.id);
    expect(await findContactByPhone(db, '+201599999999')).toBeNull();
  });

  it('lets the database itself refuse a non-E.164 channel value', async () => {
    const contact = await createContact(db, { fullName: 'Raw Channel' });
    await expect(
      db.query(
        `INSERT INTO crm_contact_channel (contact_id, channel_type, value)
         VALUES ($1, 'PHONE', '01012345678')`,
        [contact.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('treats WhatsApp as a capability of a phone channel, not an identity', async () => {
    const contact = await createContact(db, { fullName: 'WhatsApp Owner' });
    const phone = `011${Math.floor(10000000 + Math.random() * 89999999)}`;

    const channel = await addPhoneChannel(db, { contactId: contact.id, phone, isWhatsapp: true });
    expect(channel.channelType).toBe('PHONE');
    expect(channel.isWhatsapp).toBe(true);

    const channels = await listContactChannels(db, contact.id);
    expect(channels).toHaveLength(1);

    // There is no WhatsApp channel type: only PHONE exists in Slice 1.
    await expect(
      db.query(
        `INSERT INTO crm_contact_channel (contact_id, channel_type, value)
         VALUES ($1, 'WHATSAPP', $2)`,
        [contact.id, normalisePhoneToE164(`015${Math.floor(10000000 + Math.random() * 89999999)}`)],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('carries a database rule that WhatsApp can never be a non-phone channel', async () => {
    const { rows } = await db.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name = 'crm_contact_channel' AND constraint_type = 'CHECK'`,
    );
    expect(rows.map((row) => row.constraint_name)).toContain(
      'crm_contact_channel_whatsapp_phone_only',
    );
  });
});

describe('delete policy', () => {
  it('restricts deleting a source that has campaigns', async () => {
    const source = await db.query<{ id: string }>(
      "SELECT id FROM crm_source WHERE code = 'website'",
    );
    await db.query(
      'INSERT INTO crm_source_campaign (source_id, code, name) VALUES ($1, $2, $3)',
      [source.rows[0].id, uniqueToken('guard'), 'Guard campaign'],
    );

    await expect(
      db.query('DELETE FROM crm_source WHERE id = $1', [source.rows[0].id]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('restricts deleting a category that has products', async () => {
    const category = await createProductCategory(db, { code: uniqueToken('delcat'), name: 'Del' });
    await createProduct(db, { categoryId: category.id, name: uniqueToken('Del product') });

    await expect(
      db.query('DELETE FROM crm_product_category WHERE id = $1', [category.id]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('restricts deleting an account or contact that has a relationship', async () => {
    const account = await createAccount(db, { name: uniqueToken('Linked Clinic') });
    const contact = await createContact(db, { fullName: 'Linked Contact' });
    await linkContactToAccount(db, { accountId: account.id, contactId: contact.id });

    await expect(db.query('DELETE FROM crm_account WHERE id = $1', [account.id])).rejects.toMatchObject({
      code: '23503',
    });
    await expect(db.query('DELETE FROM crm_contact WHERE id = $1', [contact.id])).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('restricts deleting a contact that has channels', async () => {
    const contact = await createContact(db, { fullName: 'Channel Holder' });
    await addPhoneChannel(db, {
      contactId: contact.id,
      phone: `015${Math.floor(10000000 + Math.random() * 89999999)}`,
    });

    await expect(db.query('DELETE FROM crm_contact WHERE id = $1', [contact.id])).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('allows deleting unreferenced rows', async () => {
    const account = await createAccount(db, { name: uniqueToken('Temporary Clinic') });
    const contact = await createContact(db, { fullName: 'Temporary Contact' });

    await expect(db.query('DELETE FROM crm_account WHERE id = $1', [account.id])).resolves.toBeDefined();
    await expect(db.query('DELETE FROM crm_contact WHERE id = $1', [contact.id])).resolves.toBeDefined();

    expect(await findContactById(db, contact.id)).toBeNull();
  });
});
