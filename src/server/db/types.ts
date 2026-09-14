import type { Client, Pool, PoolClient } from 'pg';

/**
 * Every data-access function takes its connection explicitly rather than
 * reaching for a module-level pool. That is what lets the same code run against
 * the app pool, a transaction client, and a disposable test database.
 */
export type Db = Pool | PoolClient | Client;
