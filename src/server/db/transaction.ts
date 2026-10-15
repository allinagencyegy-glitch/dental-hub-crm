/**
 * Minimal transaction helper.
 *
 * Repositories take their connection as a parameter so the same SQL can run
 * against the app pool or a disposable test database. When a function needs
 * several statements to be atomic it needs a real transaction, and that has to
 * work in all three cases:
 *
 *   Pool       - borrow a client from the pool and return it afterwards.
 *   PoolClient - the caller already lent us a pooled connection; use it as is.
 *   Client     - a direct connection (tests, scripts); use it as is.
 *
 * Only `Pool` needs releasing, so the sentinel is returned alongside the client
 * rather than guessed at the call site.
 */
import { Pool, type Client, type PoolClient } from 'pg';
import type { Db } from './types';

export interface Transaction {
  client: Db;
  /** True when this helper borrowed the connection and must give it back. */
  release: () => void;
}

function isPool(db: Db): db is Pool {
  // Client and PoolClient both expose `connect` (pg uses it to open the socket),
  // so duck-typing on method names misfires. Only a Pool lends connections.
  return db instanceof Pool;
}

export async function beginTransaction(db: Db): Promise<Transaction> {
  if (isPool(db)) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
    } catch (error) {
      client.release();
      throw error;
    }
    return { client, release: () => client.release() };
  }

  const client = db as Client | PoolClient;
  await client.query('BEGIN');
  return { client, release: () => {} };
}

export async function commitTransaction(client: Db): Promise<void> {
  await client.query('COMMIT');
}

/**
 * Rolls back, swallowing rollback errors.
 *
 * A failed rollback means the connection is already unusable; surfacing that
 * would mask the original error, which is the one worth reporting.
 */
export async function rollbackTransaction(client: Db): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Intentionally ignored: the originating error is the meaningful one.
  }
}
