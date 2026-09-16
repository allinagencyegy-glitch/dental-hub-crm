import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { loadEnv } from '../../../scripts/load-env';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  resolveAdminUrl,
  type DisposableDatabase,
} from '../../../scripts/test-db';
import { runMigrations } from '../../../src/server/db/migrator';

/**
 * CRM domain suite setup: one fully migrated disposable PostgreSQL database.
 * No production build and no HTTP server - these tests drive the schema and
 * the repositories directly.
 */
export default async function setup(project: TestProject) {
  loadEnv();

  const adminUrl = resolveAdminUrl();
  let database: DisposableDatabase | undefined;

  try {
    database = await createDisposableDatabase(adminUrl);

    const client = new Client({ connectionString: database.url });
    await client.connect();
    try {
      await runMigrations(client);
    } finally {
      await client.end();
    }

    project.provide('databaseUrl', database.url);
    project.provide('databaseName', database.name);
  } catch (error) {
    if (database) await dropDisposableDatabase(database, adminUrl).catch(() => {});
    throw error;
  }

  return async () => {
    if (database) await dropDisposableDatabase(database, adminUrl);
  };
}
