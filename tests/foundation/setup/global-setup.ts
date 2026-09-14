import { existsSync } from 'node:fs';
import path from 'node:path';
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
import { startProductionServer, type RunningServer } from './server';

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string;
    databaseName: string;
    baseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  loadEnv();

  if (!existsSync(path.resolve(process.cwd(), '.next/BUILD_ID'))) {
    throw new Error(
      'No production build found. Run `npm run test:foundation`, which builds before testing.',
    );
  }

  const adminUrl = resolveAdminUrl();
  let database: DisposableDatabase | undefined;
  let server: RunningServer | undefined;

  try {
    database = await createDisposableDatabase(adminUrl);

    const client = new Client({ connectionString: database.url });
    await client.connect();
    try {
      await runMigrations(client);
    } finally {
      await client.end();
    }

    server = await startProductionServer(database.url);

    project.provide('databaseUrl', database.url);
    project.provide('databaseName', database.name);
    project.provide('baseUrl', server.baseUrl);
  } catch (error) {
    await server?.stop();
    if (database) await dropDisposableDatabase(database, adminUrl).catch(() => {});
    throw error;
  }

  return async () => {
    await server?.stop();
    if (database) await dropDisposableDatabase(database, adminUrl);
  };
}
