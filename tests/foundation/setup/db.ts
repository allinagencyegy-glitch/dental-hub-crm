import { Client } from 'pg';
import { inject } from 'vitest';

/** Opens a dedicated connection to the disposable test database. */
export async function connectTestDb(): Promise<Client> {
  const client = new Client({ connectionString: inject('databaseUrl') });
  await client.connect();
  return client;
}

/** Unique per call so tests never collide on the unique email constraint. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Math.random().toString(36).slice(2, 10)}@dentalhub.test`;
}

export const TEST_PASSWORD = 'FoundationTest!2024';
