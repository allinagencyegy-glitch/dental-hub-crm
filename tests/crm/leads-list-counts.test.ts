import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';
import { createUser } from '../../src/server/users/repository';
import { createContact } from '../../src/server/crm/contacts/repository';
import { createLead, listLeads, type LeadStatus } from '../../src/server/crm/leads/repository';
import { uniqueToken } from './setup/db';

/**
 * The leads list tabs (Active / Archived / All, and the status tabs) count the
 * whole of the actor's scope, not the 25 rows on the page.
 */
describe('leads list tab counts', () => {
  let database: DisposableDatabase;
  let db: Client;
  let rep: { userId: string; role: 'SALES_REP' };
  let manager: { userId: string; role: 'SALES_MANAGER' };

  beforeAll(async () => {
    database = await createDisposableDatabase();
    db = new Client({ connectionString: database.url });
    await db.connect();
    await runMigrations(db);

    const mkUser = async (name: string, role: 'SALES_REP' | 'SALES_MANAGER') =>
      (await createUser(db, { displayName: name, email: `${uniqueToken(role)}@test.com`, password: 'Password123!', role })).id;
    rep = { userId: await mkUser('Counted Rep', 'SALES_REP'), role: 'SALES_REP' };
    manager = { userId: await mkUser('Counting Manager', 'SALES_MANAGER'), role: 'SALES_MANAGER' };
    const other = await mkUser('Other Rep', 'SALES_REP');

    const { rows } = await db.query<{ id: string }>(`SELECT id FROM crm_source WHERE code = 'whatsapp'`);
    const { rows: reasons } = await db.query<{ id: string }>(
      `SELECT id FROM crm_outcome_reason WHERE kind = 'disqualify' AND code = 'not_interested'`,
    );
    const lead = async (owner: string, name: string, status: LeadStatus, archived = false) => {
      const contact = await createContact(db, { fullName: name });
      const created = await createLead(db, {
        sourceId: rows[0].id,
        campaignId: null,
        contactId: contact.id,
        accountId: null,
        productCategoryId: null,
        note: null,
        ownerUserId: owner,
      });
      await db.query(
        `UPDATE crm_lead
            SET status = $2,
                disqualified_at = CASE WHEN $2 = 'DISQUALIFIED' THEN now() END,
                disqualify_reason_id = CASE WHEN $2 = 'DISQUALIFIED' THEN $3::uuid END,
                archived_at = CASE WHEN $4 THEN now() END,
                archived_by_user_id = CASE WHEN $4 THEN $5::uuid END
          WHERE id = $1`,
        [created.id, status, reasons[0].id, archived, owner],
      );
    };

    await lead(rep.userId, 'Dr Amal', 'NEW');
    await lead(rep.userId, 'Dr Basma', 'NEW');
    await lead(rep.userId, 'Dr Camilia', 'NEW', true);
    await lead(rep.userId, 'Dr Dalia', 'CONTACTED');
    await lead(rep.userId, 'Dr Amira', 'CONTACTED');
    await lead(rep.userId, 'Dr Fady', 'DISQUALIFIED');
    await lead(other, 'Dr Other', 'NEW');
  });

  afterAll(async () => {
    await db.end();
    await dropDisposableDatabase(database);
  });

  it('counts the whole scope whatever the page size', async () => {
    const { leads, total, counts } = await listLeads(db, rep, { limit: 2 });

    expect(leads).toHaveLength(2);
    expect(total).toBe(5);
    expect(counts).toEqual({
      status: { ALL: 5, NEW: 2, CONTACTED: 2, DISQUALIFIED: 1 },
      archive: { active: 5, archived: 1, all: 6 },
    });
  });

  it('counts status tabs within the open archive tab, and archive tabs within the open status tab', async () => {
    const archivedNew = await listLeads(db, rep, { status: 'NEW', archiveFilter: 'archived', limit: 2 });
    expect(archivedNew.total).toBe(1);
    expect(archivedNew.counts).toEqual({
      status: { ALL: 1, NEW: 1, CONTACTED: 0, DISQUALIFIED: 0 },
      archive: { active: 2, archived: 1, all: 3 },
    });
  });

  it('counts within the search', async () => {
    const { total, counts } = await listLeads(db, rep, { search: 'dr am', limit: 2 });
    expect(total).toBe(2);
    expect(counts.status).toEqual({ ALL: 2, NEW: 1, CONTACTED: 1, DISQUALIFIED: 0 });
  });

  it('counts a manager’s whole book', async () => {
    const { counts } = await listLeads(db, manager, { limit: 2 });
    expect(counts.archive).toEqual({ active: 6, archived: 1, all: 7 });
  });
});
