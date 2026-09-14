/**
 * npm run db:seed
 *
 * Creates the three synthetic development operators if they are absent.
 *
 * Rerunnable and NON-DESTRUCTIVE: an existing account is left exactly as it is.
 * In particular this never resets a password. There is no real Dental Hub staff
 * or customer information here - every record is synthetic, and the addresses
 * use the reserved `.test` TLD, which can never resolve to a real mailbox.
 */
import { Client } from 'pg';
import { loadEnv } from './load-env';
import { createUserIfAbsent } from '@/server/users/repository';
import type { Role } from '@/server/authz/permissions';

loadEnv();

/** Development-only. Documented in .env.example and docs/FOUNDATION-V0.md. */
const DEFAULT_DEV_PASSWORD = 'DentalHubDev!2024';

const SEED_USERS: { displayName: string; email: string; role: Role }[] = [
  { displayName: 'Admin Operator', email: 'admin@dentalhub.test', role: 'ADMIN' },
  { displayName: 'Sales Manager Operator', email: 'manager@dentalhub.test', role: 'SALES_MANAGER' },
  { displayName: 'Sales Rep Operator', email: 'rep@dentalhub.test', role: 'SALES_REP' },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: NODE_ENV is production.');
  }

  const connectionString = process.env.SEED_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and set it.');
  }

  const password = process.env.SEED_DEV_PASSWORD ?? DEFAULT_DEV_PASSWORD;
  const client = new Client({ connectionString });
  await client.connect();

  try {
    for (const seed of SEED_USERS) {
      const { created, user } = await createUserIfAbsent(client, { ...seed, password });
      console.log(`  ${created ? 'created' : 'exists '}  ${user.email.padEnd(28)} ${user.role}`);
    }
    console.log('\nDevelopment seed complete. Existing accounts were left untouched.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
