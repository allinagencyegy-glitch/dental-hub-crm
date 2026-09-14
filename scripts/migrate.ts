/**
 * npm run db:migrate
 *
 * Applies every pending migration. Safe to re-run: already-applied migrations
 * are skipped and the process exits 0 having changed nothing.
 */
import { Client } from 'pg';
import { loadEnv } from './load-env';
import { runMigrations } from '@/server/db/migrator';

loadEnv();

async function main(): Promise<void> {
  const connectionString = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and set it.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const outcome = await runMigrations(client, { log: (message) => console.log(`  ${message}`) });

    if (outcome.applied.length === 0) {
      console.log(`Database is up to date (${outcome.skipped.length} migration(s) already applied).`);
    } else {
      console.log(`Applied ${outcome.applied.length} migration(s):`);
      for (const migration of outcome.applied) {
        console.log(`  ${String(migration.version).padStart(4, '0')} ${migration.name}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
