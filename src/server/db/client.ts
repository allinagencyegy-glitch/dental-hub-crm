/**
 * The application's single PostgreSQL connection pool.
 *
 * `server-only` makes importing this from a Client Component a build error,
 * which is the mechanical guarantee behind "no database access from the browser".
 */
import 'server-only';
import { Pool } from 'pg';
import type { Db } from './types';

// Next.js hot-reloads server modules in development; without this the dev server
// would leak a new pool on every edit.
const globalForPool = globalThis as unknown as { __dentalHubPool?: Pool };

/**
 * Lazy on purpose: `next build` must not require a reachable database.
 */
export function getPool(): Pool {
  if (globalForPool.__dentalHubPool) return globalForPool.__dentalHubPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and set it.');
  }

  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  globalForPool.__dentalHubPool = pool;
  return pool;
}

/** The app-wide handle passed to the repository and session modules. */
export function db(): Db {
  return getPool();
}
