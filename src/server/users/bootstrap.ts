/**
 * Creating the first ADMIN on a fresh production database.
 *
 * The Users screen needs an admin to sign in first, and the seed scripts refuse
 * to run in production, so `npm run admin:create` calls this from the server's
 * shell. Whoever has that shell already controls the database; the guard here
 * is against creating a second admin by accident, not against an attacker.
 */
import { z } from 'zod';
import type { Db } from '@/server/db/types';
import { beginTransaction, commitTransaction, rollbackTransaction } from '@/server/db/transaction';
import { MIN_PASSWORD_LENGTH } from '@/server/auth/form-state';
import { createUser } from './repository';
import type { PublicUser } from './dto';

export const bootstrapAdminSchema = z.object({
  displayName: z.string().trim().min(1, 'Name is required.').max(120),
  email: z.string().trim().pipe(z.email('Enter a valid email address.').max(254)),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    .max(512),
});

export type BootstrapAdminInput = z.input<typeof bootstrapAdminSchema>;

export class AdminAlreadyExistsError extends Error {
  constructor() {
    super(
      'An active admin already exists. Sign in as that admin and add people from Settings → Users, ' +
        'or rerun with --force if every admin is locked out.',
    );
    this.name = 'AdminAlreadyExistsError';
  }
}

/**
 * Creates an active ADMIN. Refuses while any active admin exists unless
 * `force` is set, which is the recovery path when every admin has lost access.
 *
 * The check and the insert share one transaction behind an advisory lock, so
 * two runs at the same moment cannot both decide they are first.
 */
export async function createBootstrapAdmin(
  db: Db,
  input: BootstrapAdminInput,
  options: { force?: boolean } = {},
): Promise<PublicUser> {
  const parsed = bootstrapAdminSchema.parse(input);
  const { client, release } = await beginTransaction(db);

  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('crm_bootstrap_admin'))");

    if (!options.force) {
      const { rows } = await client.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM crm_user WHERE role = 'ADMIN' AND is_active = true) AS exists",
      );
      if (rows[0].exists) throw new AdminAlreadyExistsError();
    }

    const user = await createUser(client, { ...parsed, role: 'ADMIN' });
    await commitTransaction(client);
    return user;
  } catch (error) {
    await rollbackTransaction(client);
    throw error;
  } finally {
    release();
  }
}
