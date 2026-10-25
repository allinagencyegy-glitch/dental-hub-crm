import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { inject } from 'vitest';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  assertDisposableTarget,
  generateTestDatabaseName,
  resolveAdminUrl,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { loadMigrationFiles, runMigrations } from '../../src/server/db/migrator';

describe('migrations', () => {
  // A second, private disposable database so this file can observe a genuinely
  // fresh schema without disturbing the shared one the HTTP tier is using.
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

  it('applies cleanly to a fresh PostgreSQL database', async () => {
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
      { version: 11, name: 'crm_quotation_single_accepted' },
      { version: 12, name: 'auth_login_throttle' },
      { version: 13, name: 'crm_notifications' },
    ]);
    expect(outcome.skipped).toEqual([]);

    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      'crm_account',
      'crm_account_contact',
      'crm_contact',
      'crm_contact_channel',
      'crm_followup',
      'crm_lead',
      'crm_login_throttle',
      'crm_notification',
      'crm_opportunity',
      'crm_opportunity_activity',
      'crm_opportunity_stage_history',
      'crm_outcome_reason',
      'crm_product',
      'crm_product_category',
      'crm_quotation',
      'crm_quotation_item',
      'crm_quotation_revision',
      'crm_schema_migration',
      'crm_session',
      'crm_source',
      'crm_source_campaign',
      'crm_user',
    ]);
  });

  it('is a no-op when re-run against an already-migrated database', async () => {
    const outcome = await runMigrations(client);

    expect(outcome.applied).toEqual([]);
    expect(outcome.skipped).toEqual([
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
      { version: 11, name: 'crm_quotation_single_accepted' },
      { version: 12, name: 'auth_login_throttle' },
      { version: 13, name: 'crm_notifications' },
    ]);

    const { rows } = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM crm_schema_migration',
    );
    expect(rows[0].count).toBe('13');
  });

  it('records a checksum for every applied migration', async () => {
    const files = await loadMigrationFiles();
    const { rows } = await client.query<{ version: number; checksum: string }>(
      'SELECT version, checksum FROM crm_schema_migration ORDER BY version',
    );

    expect(rows).toHaveLength(files.length);
    for (const [index, file] of files.entries()) {
      expect(rows[index].version).toBe(file.version);
      expect(rows[index].checksum).toBe(file.checksum);
    }
  });

  it('refuses to run when an applied migration has been edited', async () => {
    await client.query("UPDATE crm_schema_migration SET checksum = 'tampered' WHERE version = 1");

    await expect(runMigrations(client)).rejects.toThrow(/has changed since it was applied/);

    // Restore so later assertions in this file still see a consistent ledger.
    const files = await loadMigrationFiles();
    await client.query('UPDATE crm_schema_migration SET checksum = $1 WHERE version = 1', [
      files[0].checksum,
    ]);
  });

  it('uses uuid primary keys and timestamptz timestamps', async () => {
    const { rows } = await client.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'crm_user'
          AND column_name IN ('id', 'created_at', 'updated_at')`,
    );
    const types = Object.fromEntries(rows.map((row) => [row.column_name, row.data_type]));

    expect(types.id).toBe('uuid');
    expect(types.created_at).toBe('timestamp with time zone');
    expect(types.updated_at).toBe('timestamp with time zone');
  });

  it('creates the CRM Slice 1 domain tables', async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = rows.map((row) => row.table_name);

    for (const slice1 of [
      'crm_source',
      'crm_source_campaign',
      'crm_product_category',
      'crm_product',
      'crm_outcome_reason',
      'crm_account',
      'crm_contact',
      'crm_account_contact',
      'crm_contact_channel',
    ]) {
      expect(names).toContain(slice1);
    }
  });

  it('creates no tables for deferred CRM slices', async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = rows.map((row) => row.table_name);

    // Leads landed in Slice 2A; opportunities, their stage history and
    // follow-ups landed in Slice 2B. Activities are still deferred.
    for (const deferred of ['crm_activity']) {
      expect(names).not.toContain(deferred);
    }
    // Quotations, dashboards and after-sales remain out of scope.
    for (const deferred of ['customer', 'pipeline', 'task', 'report']) {
      expect(names.some((name) => name.includes(deferred))).toBe(false);
    }
  });
});

describe('disposable database guards', () => {
  it('rejects a target whose name is not a test database', () => {
    expect(() => assertDisposableTarget(resolveAdminUrl(), 'dental_hub_crm')).toThrow(
      /must match dental_hub_crm_test_/,
    );
    expect(() => assertDisposableTarget(resolveAdminUrl(), 'postgres')).toThrow(
      /must match dental_hub_crm_test_/,
    );
  });

  it('rejects a target that collides with DATABASE_URL', () => {
    const name = generateTestDatabaseName();
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `postgresql://u:p@127.0.0.1:5432/${name}`;
    try {
      expect(() => assertDisposableTarget(resolveAdminUrl(), name)).toThrow(/collides with DATABASE_URL/);
    } finally {
      process.env.DATABASE_URL = previous;
    }
  });

  it('runs against a disposable database, never a production one', () => {
    expect(inject('databaseName')).toMatch(/^dental_hub_crm_test_[0-9a-f]{8,}$/);
    expect(process.env.NODE_ENV).not.toBe('production');
  });
});
