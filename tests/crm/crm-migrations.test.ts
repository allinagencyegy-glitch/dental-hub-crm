import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';

describe('crm migrations', () => {
  // A private disposable database so this file observes a genuinely fresh
  // schema rather than the shared one the rest of the suite uses.
  let database: DisposableDatabase;
  let client: Client;

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  it('applies foundation, Slice 1, Slice 2A and Slice 2B migrations cleanly to a fresh database', async () => {
    const outcome = await runMigrations(client);

    expect(outcome.applied).toEqual([
      { version: 1, name: 'foundation' },
      { version: 2, name: 'crm_catalogs' },
      { version: 3, name: 'crm_identity' },
      { version: 4, name: 'crm_leads' },
      { version: 5, name: 'crm_lead_archiving' },
      { version: 6, name: 'crm_opportunities_followups' },
      { version: 7, name: 'crm_quotations' },
      { version: 8, name: 'crm_quotation_rounding' },
      { version: 9, name: 'crm_quotation_history_protection' },
      { version: 10, name: 'crm_lead_followups' },
    ]);
    expect(outcome.skipped).toEqual([]);
  });

  it('is a no-op when re-run against an already-migrated database', async () => {
    const outcome = await runMigrations(client);

    expect(outcome.applied).toEqual([]);
    expect(outcome.skipped).toHaveLength(10);

    const { rows } = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM crm_schema_migration',
    );
    expect(rows[0].count).toBe('10');
  });

  it('seeds stable catalog reference data on fresh apply', async () => {
    const { rows: sources } = await client.query<{ code: string }>(
      'SELECT code FROM crm_source ORDER BY code',
    );
    // Postgres collation sorts "exhibition" before "existing_customer".
    expect(sources.map((row) => row.code)).toEqual([
      'exhibition',
      'existing_customer',
      'facebook',
      'instagram',
      'outbound',
      'phone',
      'referral',
      'walk_in',
      'website',
      'whatsapp',
    ]);

    const { rows: categories } = await client.query<{ code: string }>(
      'SELECT code FROM crm_product_category ORDER BY code',
    );
    expect(categories.map((row) => row.code)).toEqual([
      'accessories',
      'autoclaves',
      'clinic_packages',
      'compressors',
      'dental_units',
      'other_equipment',
      'scalers',
    ]);

    const { rows: reasons } = await client.query<{ kind: string; code: string; requires_note: boolean }>(
      'SELECT kind, code, requires_note FROM crm_outcome_reason ORDER BY kind, code',
    );
    expect(reasons).toHaveLength(20);
    expect([...new Set(reasons.map((row) => row.kind))].sort()).toEqual(['disqualify', 'hold', 'lost']);
    // Every kind carries an "other" reason; only "other" requires a note.
    for (const row of reasons) {
      expect(row.requires_note).toBe(row.code === 'other');
    }
    expect(reasons.map((row) => row.code)).not.toContain('callback_requested');

    // No product rows are seeded: real catalog data is operational, not reference data.
    const { rows: products } = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM crm_product',
    );
    expect(products[0].count).toBe('0');
  });

  it('gives crm_account_contact a surrogate primary key plus a pair unique constraint', async () => {
    const { rows: pkColumns } = await client.query<{ attname: string }>(
      `SELECT a.attname
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = 'crm_account_contact'::regclass AND i.indisprimary`,
    );
    expect(pkColumns.map((row) => row.attname)).toEqual(['id']);

    const { rows: uniqueConstraints } = await client.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'crm_account_contact'::regclass AND contype = 'u'`,
    );
    expect(uniqueConstraints.map((row) => row.conname)).toContain('crm_account_contact_pair_unique');
  });
});
