import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';
import { createProductCategory } from '../../src/server/crm/catalog/repository';
import { uniqueToken } from './setup/db';
import { createUser } from '../../src/server/users/repository';
import {
  DuplicateOpenLeadError,
  archiveLead,
  disqualifyLead,
  findLeadById,
} from '../../src/server/crm/leads/repository';
import { captureLeadUseCase, restoreLeadUseCase, type Actor } from '../../src/server/crm/leads/service';
import { qualifyLeadUseCase } from '../../src/server/crm/opportunities/service';

/**
 * One open lead per contact. "Open" means still being worked: not
 * disqualified, not archived and not converted to an opportunity.
 *
 * Runs in its own database: converting a lead creates an opportunity, which
 * the shared database's `DELETE FROM crm_lead` clean-ups cannot remove.
 */
describe('duplicate lead prevention', () => {
  let database: DisposableDatabase;
  let db: Client;
  let categoryCode: string;
  let spamReasonId: string;

  const rep1: Actor = { userId: '', role: 'SALES_REP' };
  const rep2: Actor = { userId: '', role: 'SALES_REP' };
  const manager: Actor = { userId: '', role: 'SALES_MANAGER' };

  async function connect(): Promise<Client> {
    const client = new Client({ connectionString: database.url });
    await client.connect();
    return client;
  }

  beforeAll(async () => {
    database = await createDisposableDatabase();
    db = await connect();
    await runMigrations(db);

    for (const [actor, name] of [
      [rep1, 'Dup Rep One'],
      [rep2, 'Dup Rep Two'],
      [manager, 'Dup Manager'],
    ] as const) {
      const user = await createUser(db, {
        displayName: name,
        email: `${uniqueToken('dup')}@dup.test`,
        password: 'Password123!',
        role: actor.role,
      });
      actor.userId = user.id;
    }

    categoryCode = (await createProductCategory(db, { code: uniqueToken('cat'), name: 'Implants' })).code;

    const { rows: reasons } = await db.query<{ id: string }>(
      "SELECT id FROM crm_outcome_reason WHERE kind = 'disqualify' AND code = 'spam'",
    );
    spamReasonId = reasons[0].id;
  });

  afterAll(async () => {
    await db.end();
    await dropDisposableDatabase(database);
  });

  function uniqueEmail(): string {
    return `${uniqueToken('dup.contact')}@dup.test`;
  }

  /** An Egyptian mobile number nobody else in the suite uses. */
  function uniqueMobile(): { local: string; e164: string } {
    const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    return { local: `010${digits}`, e164: `+2010${digits}` };
  }

  function capture(actor: Actor, identity: { phone?: string; email?: string }, database: Client = db) {
    return captureLeadUseCase(
      actor,
      {
        fullName: 'Dr. Duplicate',
        phone: identity.phone ?? null,
        email: identity.email ?? null,
        sourceCode: 'website',
        productCategoryCode: categoryCode,
      },
      database,
    );
  }

  async function capturedLeadId(actor: Actor, identity: { phone?: string; email?: string }): Promise<string> {
    const result = await capture(actor, identity);
    if (!result.ok) throw new Error(`setup capture failed: ${result.message}`);
    return result.leadId;
  }

  async function leadCount(leadId: string): Promise<number> {
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM crm_lead
        WHERE contact_id = (SELECT contact_id FROM crm_lead WHERE id = $1)`,
      [leadId],
    );
    return Number(rows[0].count);
  }

  it('refuses a second capture for the same email and points at the open lead', async () => {
    const email = uniqueEmail();
    const firstId = await capturedLeadId(rep1, { email });

    const second = await capture(rep1, { email: email.toUpperCase() });

    expect(second).toMatchObject({ ok: false, error: 'DUPLICATE_LEAD', existingLeadId: firstId });
    if (second.ok) return;
    expect(second.message).toContain('already has an open lead, owned by Dup Rep One');
    expect(await leadCount(firstId)).toBe(1);
  });

  it('recognises the same phone written in local format', async () => {
    const phone = uniqueMobile();
    const firstId = await capturedLeadId(rep1, { phone: phone.e164 });

    const second = await capture(rep1, { phone: phone.local });

    expect(second).toMatchObject({ ok: false, error: 'DUPLICATE_LEAD', existingLeadId: firstId });
    expect(await leadCount(firstId)).toBe(1);
  });

  it("tells a rep who owns the colleague's lead without linking to it", async () => {
    const email = uniqueEmail();
    const firstId = await capturedLeadId(rep1, { email });

    const asRep2 = await capture(rep2, { email });
    expect(asRep2.ok).toBe(false);
    if (asRep2.ok) return;
    expect(asRep2.error).toBe('DUPLICATE_LEAD');
    expect(asRep2.message).toContain('owned by Dup Rep One');
    expect(asRep2.existingLeadId).toBeUndefined();

    const asManager = await capture(manager, { email });
    expect(asManager).toMatchObject({ ok: false, error: 'DUPLICATE_LEAD', existingLeadId: firstId });
  });

  it('allows a new lead once the open one is disqualified', async () => {
    const email = uniqueEmail();
    const firstId = await capturedLeadId(rep1, { email });
    await disqualifyLead(db, firstId, rep1, { reasonId: spamReasonId });

    expect((await capture(rep1, { email })).ok).toBe(true);
  });

  it('allows a new lead once the open one is archived', async () => {
    const email = uniqueEmail();
    const firstId = await capturedLeadId(rep1, { email });
    await archiveLead(db, firstId, rep1);

    expect((await capture(rep1, { email })).ok).toBe(true);
  });

  it('allows a new inquiry once the open lead has been converted to an opportunity', async () => {
    const email = uniqueEmail();
    const firstId = await capturedLeadId(rep1, { email });
    expect((await qualifyLeadUseCase(manager, firstId, {}, db)).ok).toBe(true);

    expect((await capture(rep1, { email })).ok).toBe(true);
  });

  it('lets exactly one of several simultaneous captures through', async () => {
    const email = uniqueEmail();
    // Create the contact first, so the race is only over the lead.
    const firstId = await capturedLeadId(rep1, { email });
    await archiveLead(db, firstId, rep1);

    const clients = await Promise.all(Array.from({ length: 5 }, () => connect()));
    try {
      const results = await Promise.all(clients.map((client) => capture(rep1, { email }, client)));

      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.error === 'DUPLICATE_LEAD')).toHaveLength(4);
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  });

  it('refuses to restore an open lead beside the contact’s newer open lead', async () => {
    const email = uniqueEmail();
    const archivedId = await capturedLeadId(rep1, { email });
    await archiveLead(db, archivedId, rep1);
    const newerId = await capturedLeadId(rep1, { email });

    const restore = restoreLeadUseCase(rep1, archivedId, db);
    await expect(restore).rejects.toBeInstanceOf(DuplicateOpenLeadError);
    await expect(restore).rejects.toMatchObject({ existingLeadId: newerId });

    expect((await findLeadById(db, archivedId, rep1))?.archivedAt).not.toBeNull();
  });

  it('still restores an archived lead that is no longer open', async () => {
    const email = uniqueEmail();
    const disqualifiedId = await capturedLeadId(rep1, { email });
    await disqualifyLead(db, disqualifiedId, rep1, { reasonId: spamReasonId });
    await archiveLead(db, disqualifiedId, rep1);
    await capturedLeadId(rep1, { email });

    const restored = await restoreLeadUseCase(rep1, disqualifiedId, db);
    expect(restored.archivedAt).toBeNull();
  });

  it('restores an archived lead when the contact has no other open lead', async () => {
    const email = uniqueEmail();
    const leadId = await capturedLeadId(rep1, { email });
    await archiveLead(db, leadId, rep1);

    const restored = await restoreLeadUseCase(rep1, leadId, db);
    expect(restored.archivedAt).toBeNull();
  });
});
