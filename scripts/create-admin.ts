/**
 * npm run admin:create [-- --force]
 *
 * Creates the first ADMIN account on a fresh database, production included.
 * Run it once on the server after `npm run db:migrate`; that admin then adds
 * the rest of the team from Settings → Users.
 *
 * Asks for the name, email and password interactively; the password is not
 * echoed and is never read from an argument or environment variable, so it
 * does not end up in shell history or the process list.
 *
 * Refuses while an active admin exists. `--force` skips that check, for the
 * case where every admin is locked out.
 */
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { Client } from 'pg';
import { z } from 'zod';
import { loadEnv } from './load-env';
import { AdminAlreadyExistsError, createBootstrapAdmin } from '@/server/users/bootstrap';
import { DuplicateEmailError } from '@/server/users/repository';

loadEnv();

let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  },
});

const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });
// The iterator buffers lines, so input piped in ahead of the prompts is not lost.
const lines = rl[Symbol.asyncIterator]();

async function readLine(): Promise<string> {
  const next = await lines.next();
  if (next.done) throw new Error('Input ended early. Nothing was created.');
  return next.value;
}

async function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return (await readLine()).trim();
}

async function askHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  muted = true;
  try {
    return await readLine();
  } finally {
    muted = false;
    process.stdout.write('\n');
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Set it in .env on this server.');
  }

  const force = process.argv.includes('--force');

  console.log('Create a Dental Hub CRM admin account.\n');
  const displayName = await ask('Name: ');
  const email = await ask('Email: ');
  const password = await askHidden('Password (at least 12 characters): ');
  const confirm = await askHidden('Repeat password: ');
  if (password !== confirm) throw new Error('The passwords do not match. Nothing was created.');

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const user = await createBootstrapAdmin(client, { displayName, email, password }, { force });
    console.log(`\nCreated admin ${user.email}. Sign in with it and add the team from Settings → Users.`);
  } finally {
    await client.end();
  }
}

main()
  .catch((error: unknown) => {
    if (error instanceof z.ZodError) {
      console.error(error.issues[0]?.message ?? 'That input is not valid.');
    } else if (error instanceof AdminAlreadyExistsError || error instanceof DuplicateEmailError) {
      console.error(error.message);
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  })
  .finally(() => rl.close());
