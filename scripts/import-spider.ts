/**
 * npm run spider:import -- <folder with the Spider .xlsx exports> [--apply]
 *
 * Brings the old Spider CRM's clients into this CRM (see
 * src/server/crm/import/spider.ts for what is imported and how). Run it once
 * on the server after `npm run db:migrate` and `npm run catalog:import`.
 *
 * Without --apply it is a dry run: it reads the exports and prints what it
 * would do, writing nothing. With --apply it creates the team's user
 * accounts (with unusable random passwords - set each one from Settings ->
 * Users) and the leads, in one transaction. Running it again skips every
 * lead already imported and every user whose email already exists.
 *
 * The exports hold customer data: keep them on the server, never in git.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { loadEnv } from './load-env';
import { readXlsxRecords } from './spider/xlsx';
import {
  planSpiderImport,
  spiderClientFromRecord,
  spiderTeamFromRecords,
  writeSpiderImport,
  type SpiderImportPlan,
} from '@/server/crm/import/spider';
import { createUserIfAbsent } from '@/server/users/repository';
import { beginTransaction, commitTransaction, rollbackTransaction } from '@/server/db/transaction';

loadEnv();

/** Dental Hub's decisions about the Spider team, Oct 2026. */
const TEAM_OPTIONS = {
  managerDisplayName: 'د. عبدالله رجب',
  teamLeaderNames: ['عبدلله محمد', 'سيف الدين سعيد'],
};

function readExports(folder: string) {
  const clients: Record<string, string>[] = [];
  const team: Record<string, string>[] = [];
  for (const file of readdirSync(folder).filter((name) => name.toLowerCase().endsWith('.xlsx')).sort()) {
    const records = readXlsxRecords(path.join(folder, file));
    const header = Object.keys(records[0] ?? {});
    if (header.includes('Client Name') && header.includes('Member')) clients.push(...records);
    else if (header.includes('First Name') && header.includes('Title')) team.push(...records);
    else console.log(`  skipping ${file} (not a clients or team export)`);
  }
  return { clients, team };
}

function count<T>(items: T[], key: (item: T) => string): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `    ${String(n).padStart(5)}  ${name}`)
    .join('\n');
}

function printPlan(plan: SpiderImportPlan, clientRows: number): void {
  const outcome = (kind: string) => plan.leads.filter((lead) => lead.outcome.kind === kind).length;
  console.log(`\nSpider clients read: ${clientRows}`);
  console.log(`Leads to import:     ${plan.leads.length}`);
  console.log(`Left out:            ${plan.excluded.length} (Top Medical ${plan.excluded.filter((e) => e.because === 'top_medical').length}, Bojin ${plan.excluded.filter((e) => e.because === 'bojin').length})`);
  console.log(`Same phone as a newer client, noted on it: ${plan.duplicates.length}`);
  console.log(`\nTeam (${plan.team.length}):`);
  for (const member of plan.team) console.log(`    ${member.role.padEnd(18)} ${member.displayName}`);
  console.log('\nBy owner:\n' + count(plan.leads, (lead) => lead.ownerSpiderName));
  console.log(
    `\nBy state:\n    ${String(outcome('new')).padStart(5)}  NEW (never reached)\n    ${String(outcome('contacted')).padStart(5)}  CONTACTED` +
      `\n    ${String(outcome('disqualified')).padStart(5)}  DISQUALIFIED\n    ${String(outcome('won')).padStart(5)}  WON opportunity` +
      `\n    ${String(plan.leads.filter((lead) => lead.outcome.kind === 'contacted' && lead.outcome.callBack).length).padStart(5)}  with a call back due today`,
  );
  console.log('\nBy disqualify reason:\n' + count(plan.leads.filter((lead) => lead.outcome.kind === 'disqualified'), (lead) => (lead.outcome.kind === 'disqualified' ? lead.outcome.reason : '')));
  console.log('\nBy product category:\n' + count(plan.leads, (lead) => lead.categoryCode ?? '(none)'));
  console.log('\nBy source:\n' + count(plan.leads, (lead) => lead.sourceCode));
  console.log(`\nWithout a usable phone: ${plan.leads.filter((lead) => lead.phones.length === 0).length}`);
  console.log(`With two or more phones: ${plan.leads.filter((lead) => lead.phones.length > 1).length}`);
  console.log(`Phone values that could not be read: ${plan.rejectedPhones.length}`);
  console.log(`With a real customer name (not "Dental hub" / "Old Data"): ${plan.leads.filter((lead) => !lead.contactName.startsWith('عميل Spider')).length}`);
  const unmapped = [...plan.unmappedCodes.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\nCodes with no category (${unmapped.reduce((sum, [, n]) => sum + n, 0)} leads), top 25:`);
  for (const [code, n] of unmapped.slice(0, 25)) console.log(`    ${String(n).padStart(5)}  ${code}`);
  if (plan.unknownMembers.length > 0) {
    console.log(`\nOwners not on the team list (their clients are NOT imported): ${plan.unknownMembers.join(', ')}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const folder = args.find((arg) => !arg.startsWith('--'));
  const apply = args.includes('--apply');
  if (!folder) throw new Error('Usage: npm run spider:import -- <folder with the Spider .xlsx exports> [--apply]');

  const exports = readExports(folder);
  if (exports.team.length === 0) throw new Error('No team export (First Name / Title columns) found in that folder.');
  const team = spiderTeamFromRecords(exports.team, TEAM_OPTIONS);
  const plan = planSpiderImport(exports.clients.map(spiderClientFromRecord), team);
  printPlan(plan, exports.clients.length);

  if (plan.unknownMembers.length > 0) throw new Error('Fix the owners above before importing.');
  if (!apply) {
    console.log('\nDry run: nothing was written. Run again with --apply to import.');
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set. Copy .env.example to .env and set it.');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await beginTransaction(client);
    try {
      const ownerIds = new Map<string, string>();
      for (const member of team) {
        const { created, user } = await createUserIfAbsent(client, {
          displayName: member.displayName,
          email: member.email,
          // Unusable until an admin sets a real one from Settings -> Users.
          password: randomBytes(32).toString('base64url'),
          role: member.role,
        });
        ownerIds.set(member.spiderName, user.id);
        console.log(`  ${created ? 'added user ' : 'user exists'}  ${member.displayName}`);
      }
      const result = await writeSpiderImport(client, plan, ownerIds);
      await commitTransaction(client);
      console.log(
        `\nImported ${result.created} leads (${result.won} won, ${result.callBacks} call backs); ` +
          `${result.alreadyImported} were already imported; ${result.reusedContacts} joined an existing contact; ` +
          `${result.skippedOpenLead.length} skipped because that contact already has an open lead.`,
      );
    } catch (error) {
      await rollbackTransaction(client);
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
