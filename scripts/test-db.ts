/**
 * Disposable PostgreSQL databases for the foundation acceptance suite.
 *
 * No Docker required: this creates and drops a uniquely-named database on a
 * local PostgreSQL instance using a role with CREATEDB.
 *
 * Three guards make it impossible for a test run to touch a real database.
 */
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';

const TEST_DB_NAME_PATTERN = /^dental_hub_crm_test_[0-9a-f]{8,}$/;

export function generateTestDatabaseName(): string {
  return `dental_hub_crm_test_${randomBytes(6).toString('hex')}`;
}

function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

/**
 * Refuses to proceed unless the target is unmistakably a disposable test
 * database. Any doubt is a hard failure, never a fallback.
 */
export function assertDisposableTarget(adminUrl: string, testDatabaseName: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the foundation suite with NODE_ENV=production.');
  }

  if (!TEST_DB_NAME_PATTERN.test(testDatabaseName)) {
    throw new Error(
      `Refusing to use "${testDatabaseName}" as a test database: ` +
        'the name must match dental_hub_crm_test_<hex>.',
    );
  }

  if (databaseNameOf(adminUrl) === testDatabaseName) {
    throw new Error('Refusing to run: the admin connection already points at the test database.');
  }

  const appUrl = process.env.DATABASE_URL;
  if (appUrl && databaseNameOf(appUrl) === testDatabaseName) {
    throw new Error('Refusing to run: the test database name collides with DATABASE_URL.');
  }
}

export function resolveAdminUrl(): string {
  const url = process.env.TEST_ADMIN_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_ADMIN_DATABASE_URL is not set. It must point at a maintenance database ' +
        '(for example .../postgres) using a role with CREATEDB. See .env.example.',
    );
  }
  return url;
}

export interface DisposableDatabase {
  name: string;
  url: string;
}

export async function createDisposableDatabase(adminUrl = resolveAdminUrl()): Promise<DisposableDatabase> {
  const name = generateTestDatabaseName();
  assertDisposableTarget(adminUrl, name);

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // Identifier cannot be parameterised; the name is generated here and
    // validated against TEST_DB_NAME_PATTERN above.
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  return { name, url: withDatabase(adminUrl, name) };
}

export async function dropDisposableDatabase(
  database: DisposableDatabase,
  adminUrl = resolveAdminUrl(),
): Promise<void> {
  assertDisposableTarget(adminUrl, database.name);

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${database.name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
