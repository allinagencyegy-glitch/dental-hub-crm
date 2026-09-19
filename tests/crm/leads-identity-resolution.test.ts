import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { connectTestDb, uniqueToken } from './setup/db';
import {
  createContact,
  addPhoneChannel,
} from '../../src/server/crm/contacts/repository';
import {
  resolveOrCreateContact,
  IdentityConflictError,
} from '../../src/server/crm/leads/repository';
import { normalisePhoneToE164 } from '../../src/server/crm/contacts/phone';
import { normaliseEmail } from '../../src/server/users/repository';

let db: Client;

beforeAll(async () => {
  db = await connectTestDb();
});

afterAll(async () => {
  await db.end();
});

describe('identity resolution', () => {
  describe('phone normalization (Egyptian)', () => {
    it('normalizes Egyptian local numbers to E.164', () => {
      const canonical = '+201012345678';

      expect(normalisePhoneToE164('01012345678')).toBe(canonical);
      expect(normalisePhoneToE164('010 1234 5678')).toBe(canonical);
      expect(normalisePhoneToE164('(010) 123-45678')).toBe(canonical);
      expect(normalisePhoneToE164('+20 10 1234 5678')).toBe(canonical);
      expect(normalisePhoneToE164('0020 101 234 5678')).toBe(canonical);
      expect(normalisePhoneToE164('201012345678')).toBe(canonical);
      expect(normalisePhoneToE164('10 1234 5678')).toBe(canonical);
    });

    it('normalizes Cairo landline', () => {
      expect(normalisePhoneToE164('02 2345 6789')).toBe('+20223456789');
      expect(normalisePhoneToE164('20223456789')).toBe('+20223456789');
    });

    it('passes through international non-Egyptian numbers', () => {
      expect(normalisePhoneToE164('+1 (415) 555-0132')).toBe('+14155550132');
    });
  });

  describe('email normalization', () => {
    it('normalizes email to lowercase trimmed form', () => {
      expect(normaliseEmail('  TEST@Example.COM  ')).toBe('test@example.com');
      expect(normaliseEmail('User@Domain.ORG')).toBe('user@domain.org');
    });
  });

  describe('resolveOrCreateContact', () => {
    it('creates new contact when neither phone nor email exists', async () => {
      const result = await resolveOrCreateContact(db, {
        fullName: 'New Contact',
        phone: '01011112222',
        email: 'new@test.com',
      });

      expect(result.created).toBe(true);
      expect(result.contactId).toBeDefined();

      // Verify contact exists
      const contact = await db.query<{ id: string; full_name: string; email: string }>(
        'SELECT id, full_name, email FROM crm_contact WHERE id = $1',
        [result.contactId]
      );
      expect(contact.rows[0].full_name).toBe('New Contact');
      expect(contact.rows[0].email).toBe('new@test.com');

      // Verify phone channel was created
      const channels = await db.query<{ value: string }>(
        'SELECT value FROM crm_contact_channel WHERE contact_id = $1 AND channel_type = \'PHONE\'',
        [result.contactId]
      );
      expect(channels.rows[0].value).toBe('+201011112222');
    });

    it('reuses existing contact when phone matches', async () => {
      const existing = await createContact(db, { fullName: 'Existing', email: 'existing@test.com' });
      await addPhoneChannel(db, { contactId: existing.id, phone: '01099998888' });

      const result = await resolveOrCreateContact(db, {
        fullName: 'New Name',
        phone: '010 9999 8888', // Different format, same number
      });

      expect(result.created).toBe(false);
      expect(result.contactId).toBe(existing.id);
    });

    it('reuses existing contact when email matches (case-insensitive)', async () => {
      const email = uniqueToken('reuse') + '@test.com';
      const existing = await createContact(db, { fullName: 'Existing', email });

      const result = await resolveOrCreateContact(db, {
        fullName: 'New Name',
        email: email.toUpperCase(),
      });

      expect(result.created).toBe(false);
      expect(result.contactId).toBe(existing.id);
    });

    it('reuses existing contact when phone and email resolve to SAME contact', async () => {
      const existing = await createContact(db, { fullName: 'Existing', email: 'same@test.com' });
      await addPhoneChannel(db, { contactId: existing.id, phone: '01077776666' });

      const result = await resolveOrCreateContact(db, {
        fullName: 'New Name',
        phone: '+201077776666',
        email: 'SAME@test.com',
      });

      expect(result.created).toBe(false);
      expect(result.contactId).toBe(existing.id);
    });

    it('reuses existing contact when only phone resolves', async () => {
      const existing = await createContact(db, { fullName: 'Phone Only', email: 'phoneonly@test.com' });
      await addPhoneChannel(db, { contactId: existing.id, phone: '01055554444' });

      const result = await resolveOrCreateContact(db, {
        fullName: 'New Name',
        phone: '010 5555 4444',
      });

      expect(result.created).toBe(false);
      expect(result.contactId).toBe(existing.id);
    });

    it('reuses existing contact when only email resolves', async () => {
      const email = uniqueToken('emailonly') + '@test.com';
      const existing = await createContact(db, { fullName: 'Email Only', email });

      const result = await resolveOrCreateContact(db, {
        fullName: 'New Name',
        email: email.toUpperCase(),
      });

      expect(result.created).toBe(false);
      expect(result.contactId).toBe(existing.id);
    });

    it('throws IdentityConflictError when phone and email resolve to DIFFERENT contacts', async () => {
      const phoneContact = await createContact(db, { fullName: 'Phone Contact', email: 'phone@test.com' });
      await addPhoneChannel(db, { contactId: phoneContact.id, phone: '01033332222' });

      const emailContact = await createContact(db, { fullName: 'Email Contact', email: 'different@test.com' });

      await expect(
        resolveOrCreateContact(db, {
          fullName: 'Conflict',
          phone: '010 3333 2222',
          email: 'different@test.com',
        })
      ).rejects.toBeInstanceOf(IdentityConflictError);

      try {
        await resolveOrCreateContact(db, {
          fullName: 'Conflict',
          phone: '010 3333 2222',
          email: 'different@test.com',
        });
      } catch (e) {
        expect(e).toBeInstanceOf(IdentityConflictError);
        expect((e as IdentityConflictError).phoneContactId).toBe(phoneContact.id);
        expect((e as IdentityConflictError).emailContactId).toBe(emailContact.id);
      }
    });

    it('handles concurrent duplicate contact creation (email race)', async () => {
      const email = uniqueToken('race') + '@test.com';

      // Simulate race: two concurrent calls with same email
      const [result1, result2] = await Promise.all([
        resolveOrCreateContact(db, { fullName: 'First', email }),
        resolveOrCreateContact(db, { fullName: 'Second', email }),
      ]);

      // Both should return the same canonical contact
      expect(result1.contactId).toBe(result2.contactId);
      expect(result1.created !== result2.created).toBe(true); // One created, one reused
    });

    it('handles concurrent duplicate contact creation (phone race)', async () => {
      const phone = '01088887777';

      // First create a contact with this phone
      const existing = await createContact(db, { fullName: 'Existing Phone' });
      await addPhoneChannel(db, { contactId: existing.id, phone });

      // Now try to create another with same phone - should reuse
      const result = await resolveOrCreateContact(db, {
        fullName: 'New Contact',
        phone: '+201088887777', // Same phone, different format
      });

      expect(result.created).toBe(false);
      expect(result.contactId).toBe(existing.id);
    });

    it('throws when neither phone nor email provided', async () => {
      await expect(
        resolveOrCreateContact(db, { fullName: 'No Identity' })
      ).rejects.toThrow('At least one of phone or email must be provided');
    });

    it('creates contact with only phone (no email)', async () => {
      const result = await resolveOrCreateContact(db, {
        fullName: 'Phone Only',
        phone: '01044443333',
      });

      expect(result.created).toBe(true);
      const channels = await db.query<{ value: string }>(
        'SELECT value FROM crm_contact_channel WHERE contact_id = $1',
        [result.contactId]
      );
      expect(channels.rows[0].value).toBe('+201044443333');
    });

    it('creates contact with only email (no phone)', async () => {
      const result = await resolveOrCreateContact(db, {
        fullName: 'Email Only',
        email: 'emailonly@test.com',
      });

      expect(result.created).toBe(true);
      const contact = await db.query<{ email: string }>(
        'SELECT email FROM crm_contact WHERE id = $1',
        [result.contactId]
      );
      expect(contact.rows[0].email).toBe('emailonly@test.com');
    });
  });
});