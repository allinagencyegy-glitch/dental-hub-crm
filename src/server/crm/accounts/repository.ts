/**
 * All SQL touching crm_account and crm_account_contact.
 *
 * crm_account_contact is the ONLY place accounts and contacts meet:
 * crm_contact has no account_id, so a contact can relate to many accounts and
 * an account to many contacts. The pair unique constraint makes the same
 * relationship twice unrepresentable.
 */
import type { Db } from '@/server/db/types';

export class DuplicateAccountContactError extends Error {
  constructor() {
    super('This contact is already linked to that account.');
    this.name = 'DuplicateAccountContactError';
  }
}

export class PrimaryContactConflictError extends Error {
  constructor() {
    super('That account already has a primary contact.');
    this.name = 'PrimaryContactConflictError';
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === constraint
  );
}

export interface Account {
  id: string;
  name: string;
  isActive: boolean;
}

type AccountRow = {
  id: string;
  name: string;
  is_active: boolean;
};

function toAccount(row: AccountRow): Account {
  return { id: row.id, name: row.name, isActive: row.is_active };
}

const ACCOUNT_COLUMNS = 'id, name, is_active';

export async function createAccount(db: Db, input: { name: string }): Promise<Account> {
  const { rows } = await db.query<AccountRow>(
    `INSERT INTO crm_account (name) VALUES ($1) RETURNING ${ACCOUNT_COLUMNS}`,
    [input.name.trim()],
  );
  return toAccount(rows[0]);
}

export async function findAccountById(db: Db, id: string): Promise<Account | null> {
  const { rows } = await db.query<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM crm_account WHERE id = $1`,
    [id],
  );
  return rows[0] ? toAccount(rows[0]) : null;
}

export interface AccountContact {
  id: string;
  accountId: string;
  contactId: string;
  isPrimary: boolean;
}

type AccountContactRow = {
  id: string;
  account_id: string;
  contact_id: string;
  is_primary: boolean;
};

function toAccountContact(row: AccountContactRow): AccountContact {
  return { id: row.id, accountId: row.account_id, contactId: row.contact_id, isPrimary: row.is_primary };
}

const ACCOUNT_CONTACT_COLUMNS = 'id, account_id, contact_id, is_primary';

/**
 * Links a contact to an account. Linking the same pair twice fails, and only
 * one contact per account may be primary - both are database facts, not
 * conventions.
 */
export async function linkContactToAccount(
  db: Db,
  input: { accountId: string; contactId: string; isPrimary?: boolean },
): Promise<AccountContact> {
  try {
    const { rows } = await db.query<AccountContactRow>(
      `INSERT INTO crm_account_contact (account_id, contact_id, is_primary)
       VALUES ($1, $2, $3) RETURNING ${ACCOUNT_CONTACT_COLUMNS}`,
      [input.accountId, input.contactId, input.isPrimary ?? false],
    );
    return toAccountContact(rows[0]);
  } catch (error) {
    if (isUniqueViolation(error, 'crm_account_contact_pair_unique')) {
      throw new DuplicateAccountContactError();
    }
    if (isUniqueViolation(error, 'crm_account_contact_one_primary_idx')) {
      throw new PrimaryContactConflictError();
    }
    throw error;
  }
}

export async function listContactsForAccount(db: Db, accountId: string): Promise<AccountContact[]> {
  const { rows } = await db.query<AccountContactRow>(
    `SELECT ${ACCOUNT_CONTACT_COLUMNS} FROM crm_account_contact
      WHERE account_id = $1 ORDER BY is_primary DESC, created_at ASC`,
    [accountId],
  );
  return rows.map(toAccountContact);
}

export async function listAccountsForContact(db: Db, contactId: string): Promise<AccountContact[]> {
  const { rows } = await db.query<AccountContactRow>(
    `SELECT ${ACCOUNT_CONTACT_COLUMNS} FROM crm_account_contact
      WHERE contact_id = $1 ORDER BY created_at ASC`,
    [contactId],
  );
  return rows.map(toAccountContact);
}
