import { Client } from 'pg';
import { inject } from 'vitest';

/** Opens a dedicated connection to the disposable test database. */
export async function connectTestDb(): Promise<Client> {
  const client = new Client({ connectionString: inject('databaseUrl') });
  await client.connect();
  return client;
}

/** Unique per call so tests never collide on unique constraints. */
export function uniqueToken(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
