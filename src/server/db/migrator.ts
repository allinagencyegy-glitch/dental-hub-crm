/**
 * Minimal, explicit forward-only migration runner.
 *
 * Deliberately owned in-repo rather than delegated to a CLI tool: the foundation
 * acceptance suite has to drive migrations programmatically (create a disposable
 * database, migrate, assert, migrate again, assert the second run is a no-op).
 *
 * No `server-only` marker here - this module is shared with `scripts/` and
 * `tests/`, which run in plain Node outside the Next.js server graph.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from './types';

/** Fixed key so concurrent migrators serialise instead of interleaving. */
const MIGRATION_LOCK_KEY = 4071326915;

const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface MigrationFile {
  version: number;
  name: string;
  filename: string;
  sql: string;
  checksum: string;
}

type LedgerRow = { version: number; name: string; checksum: string };

export interface MigrationOutcome {
  /** Migrations executed by this run. Empty on a no-op re-run. */
  applied: { version: number; name: string }[];
  /** Migrations already recorded in the ledger and therefore skipped. */
  skipped: { version: number; name: string }[];
}

export function defaultMigrationsDir(): string {
  return path.resolve(process.cwd(), 'migrations');
}

function checksum(sql: string): string {
  // Normalise line endings so a Windows checkout and a Linux checkout agree.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export async function loadMigrationFiles(dir = defaultMigrationsDir()): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const files: MigrationFile[] = [];

  for (const filename of entries.sort()) {
    if (!filename.endsWith('.sql')) continue;

    const match = MIGRATION_FILE_PATTERN.exec(filename);
    if (!match) {
      throw new Error(
        `Migration filename "${filename}" does not match the required NNNN_snake_case_name.sql format.`,
      );
    }

    const sql = await readFile(path.join(dir, filename), 'utf8');
    files.push({
      version: Number.parseInt(match[1], 10),
      name: match[2],
      filename,
      sql,
      checksum: checksum(sql),
    });
  }

  const versions = new Set<number>();
  for (const file of files) {
    if (versions.has(file.version)) {
      throw new Error(`Duplicate migration version ${file.version} in ${dir}.`);
    }
    versions.add(file.version);
  }

  return files.sort((a, b) => a.version - b.version);
}

async function ensureLedger(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS crm_schema_migration (
      version    integer     PRIMARY KEY,
      name       text        NOT NULL,
      checksum   text        NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Applies every pending migration inside its own transaction, together with its
 * ledger row - so a failure can never leave a half-applied migration recorded.
 *
 * Re-running with nothing pending is a no-op: `applied` comes back empty.
 */
export async function runMigrations(
  db: Db,
  options: { migrationsDir?: string; log?: (message: string) => void } = {},
): Promise<MigrationOutcome> {
  const log = options.log ?? (() => {});
  const files = await loadMigrationFiles(options.migrationsDir);

  await db.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    await ensureLedger(db);

    const { rows } = await db.query<LedgerRow>(
      'SELECT version, name, checksum FROM crm_schema_migration',
    );
    const ledger = new Map(rows.map((row) => [row.version, row]));

    const onDisk = new Set(files.map((file) => file.version));
    for (const version of ledger.keys()) {
      if (!onDisk.has(version)) {
        throw new Error(
          `Migration ${version} is recorded as applied but its file is missing. ` +
            'Refusing to run against a database migrated from a different revision.',
        );
      }
    }

    const outcome: MigrationOutcome = { applied: [], skipped: [] };

    for (const file of files) {
      const recorded = ledger.get(file.version);

      if (recorded) {
        if (recorded.checksum !== file.checksum) {
          throw new Error(
            `Migration ${file.filename} has changed since it was applied ` +
              `(recorded ${recorded.checksum.slice(0, 12)}, on disk ${file.checksum.slice(0, 12)}). ` +
              'Applied migrations are immutable - add a new migration instead.',
          );
        }
        outcome.skipped.push({ version: file.version, name: file.name });
        continue;
      }

      log(`applying ${file.filename}`);
      await db.query('BEGIN');
      try {
        await db.query(file.sql);
        await db.query(
          'INSERT INTO crm_schema_migration (version, name, checksum) VALUES ($1, $2, $3)',
          [file.version, file.name, file.checksum],
        );
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
      outcome.applied.push({ version: file.version, name: file.name });
    }

    return outcome;
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }
}
