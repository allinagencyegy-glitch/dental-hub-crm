/**
 * All SQL touching crm_contact and crm_contact_channel.
 *
 * Identity rules enforced here (and mirrored by database constraints):
 *   * a contact never carries an account id - account links live in
 *     crm_account_contact (see crm/accounts/repository.ts);
 *   * email is normalised with the shared normaliseEmail;
 *   * phone channels are normalised to E.164 before insert, and the global
 *     unique index turns a second claim on the same number into
 *     DuplicatePhoneError.
 */
import type { Db } from '@/server/db/types';
import { normaliseEmail } from '@/server/users/repository';
import { normalisePhoneToE164 } from './phone';

export class DuplicateContactEmailError extends Error {
  constructor(email: string) {
    super(`A contact with email "${email}" already exists.`);
    this.name = 'DuplicateContactEmailError';
  }
}

export class DuplicatePhoneError extends Error {
  constructor(phone: string) {
    super(`The phone number ${phone} already belongs to a contact.`);
    this.name = 'DuplicatePhoneError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export interface Contact {
  id: string;
  fullName: string;
  email: string | null;
  isActive: boolean;
}

type ContactRow = {
  id: string;
  full_name: string;
  email: string | null;
  is_active: boolean;
};

function toContact(row: ContactRow): Contact {
  return { id: row.id, fullName: row.full_name, email: row.email, isActive: row.is_active };
}

const CONTACT_COLUMNS = 'id, full_name, email, is_active';

export async function createContact(
  db: Db,
  input: { fullName: string; email?: string | null },
): Promise<Contact> {
  const email = input.email == null || input.email.trim() === '' ? null : normaliseEmail(input.email);
  try {
    const { rows } = await db.query<ContactRow>(
      `INSERT INTO crm_contact (full_name, email) VALUES ($1, $2) RETURNING ${CONTACT_COLUMNS}`,
      [input.fullName.trim(), email],
    );
    return toContact(rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateContactEmailError(email ?? '');
    throw error;
  }
}

export async function findContactById(db: Db, id: string): Promise<Contact | null> {
  const { rows } = await db.query<ContactRow>(
    `SELECT ${CONTACT_COLUMNS} FROM crm_contact WHERE id = $1`,
    [id],
  );
  return rows[0] ? toContact(rows[0]) : null;
}

/** Canonical identity lookup: any dialling format resolves to the same contact. */
export async function findContactByPhone(db: Db, rawPhone: string): Promise<Contact | null> {
  const e164 = normalisePhoneToE164(rawPhone);
  const { rows } = await db.query<ContactRow>(
    `SELECT c.id, c.full_name, c.email, c.is_active
       FROM crm_contact c
       JOIN crm_contact_channel ch ON ch.contact_id = c.id
      WHERE ch.channel_type = 'PHONE' AND ch.value = $1`,
    [e164],
  );
  return rows[0] ? toContact(rows[0]) : null;
}

export type ChannelType = 'PHONE';

export interface ContactChannel {
  id: string;
  contactId: string;
  channelType: ChannelType;
  value: string;
  isWhatsapp: boolean;
  isActive: boolean;
}

type ContactChannelRow = {
  id: string;
  contact_id: string;
  channel_type: ChannelType;
  value: string;
  is_whatsapp: boolean;
  is_active: boolean;
};

function toContactChannel(row: ContactChannelRow): ContactChannel {
  return {
    id: row.id,
    contactId: row.contact_id,
    channelType: row.channel_type,
    value: row.value,
    isWhatsapp: row.is_whatsapp,
    isActive: row.is_active,
  };
}

const CONTACT_CHANNEL_COLUMNS = 'id, contact_id, channel_type, value, is_whatsapp, is_active';

/**
 * Registers a phone for a contact. The value is normalised to E.164 first, so
 * "01012345678", "+20 10 1234 5678" and "00201012345678" are the same
 * identity - and the second claim on that identity fails.
 */
export async function addPhoneChannel(
  db: Db,
  input: { contactId: string; phone: string; isWhatsapp?: boolean },
): Promise<ContactChannel> {
  const value = normalisePhoneToE164(input.phone);
  try {
    const { rows } = await db.query<ContactChannelRow>(
      `INSERT INTO crm_contact_channel (contact_id, channel_type, value, is_whatsapp)
       VALUES ($1, 'PHONE', $2, $3) RETURNING ${CONTACT_CHANNEL_COLUMNS}`,
      [input.contactId, value, input.isWhatsapp ?? false],
    );
    return toContactChannel(rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicatePhoneError(value);
    throw error;
  }
}

export async function listContactChannels(db: Db, contactId: string): Promise<ContactChannel[]> {
  const { rows } = await db.query<ContactChannelRow>(
    `SELECT ${CONTACT_CHANNEL_COLUMNS} FROM crm_contact_channel
      WHERE contact_id = $1 ORDER BY created_at ASC`,
    [contactId],
  );
  return rows.map(toContactChannel);
}
