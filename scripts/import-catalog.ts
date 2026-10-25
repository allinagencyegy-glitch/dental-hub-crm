/**
 * npm run catalog:import
 *
 * Loads the Dental Hub price list (scripts/catalog/price-list.ts) into the
 * product catalogue. Meant for production: run it once on the server after
 * `npm run db:migrate`.
 *
 * Rerunnable and NON-DESTRUCTIVE: a model that is already in the catalogue,
 * matched by brand and name, is left exactly as it is. Prices and names
 * changed later in Settings -> Products are never overwritten.
 */
import { Client } from 'pg';
import { loadEnv } from './load-env';
import { importProducts } from '@/server/crm/catalog/repository';
import { beginTransaction, commitTransaction, rollbackTransaction } from '@/server/db/transaction';
import { PRICE_LIST } from './catalog/price-list';

loadEnv();

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and set it.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await beginTransaction(client);
    let result: Awaited<ReturnType<typeof importProducts>>;
    try {
      result = await importProducts(client, PRICE_LIST);
      await commitTransaction(client);
    } catch (error) {
      await rollbackTransaction(client);
      throw error;
    }
    for (const label of result.created) console.log(`  added   ${label}`);
    for (const label of result.existing) console.log(`  exists  ${label}`);
    console.log(
      `\nCatalogue import complete: ${result.created.length} added, ${result.existing.length} already present and left untouched.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
