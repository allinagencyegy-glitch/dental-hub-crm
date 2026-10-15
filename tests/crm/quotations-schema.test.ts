import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';
import { createUser } from '../../src/server/users/repository';
import { createContact } from '../../src/server/crm/contacts/repository';
import { createLead } from '../../src/server/crm/leads/repository';
import { uniqueToken } from './setup/db';

/**
 * Schema-level guarantees for the quotation tables (migrations 0007 + 0008).
 *
 * Each case names the exact constraint it expects: a test that merely
 * "rejects toThrow" could pass because of an unrelated failure.
 */
describe('crm_quotation / crm_quotation_item / crm_quotation_revision schema', () => {
  let database: DisposableDatabase;
  let client: Client;

  let userId: string;
  let contactId: string;
  let sourceId: string;
  let opportunityId: string;

  async function insertQuotation(overrides: Record<string, unknown> = {}) {
    const row = {
      opportunity_id: opportunityId,
      contact_id: contactId,
      account_id: null,
      quote_number: uniqueToken('Q'),
      version: 1,
      status: 'DRAFT',
      currency: 'EGP',
      subtotal: '100.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      total_amount: '100.00',
      notes: null,
      terms_conditions: null,
      valid_until: null,
      sent_at: null,
      accepted_at: null,
      rejected_at: null,
      expired_at: null,
      created_by: userId,
      previous_quote_id: null,
      ...overrides,
    };
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO crm_quotation
         (opportunity_id, contact_id, account_id, quote_number, version, status, currency,
          subtotal, discount_amount, tax_amount, total_amount, notes, terms_conditions,
          valid_until, sent_at, accepted_at, rejected_at, expired_at, created_by, previous_quote_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING id`,
      [
        row.opportunity_id, row.contact_id, row.account_id, row.quote_number, row.version,
        row.status, row.currency, row.subtotal, row.discount_amount, row.tax_amount,
        row.total_amount, row.notes, row.terms_conditions, row.valid_until, row.sent_at,
        row.accepted_at, row.rejected_at, row.expired_at, row.created_by, row.previous_quote_id,
      ],
    );
    return rows[0].id;
  }

  async function expectConstraint(constraint: string, work: Promise<unknown>) {
    const error = await work.then(
      () => null,
      (err: unknown) => err,
    );
    expect(error, `expected constraint ${constraint} to be violated`).not.toBeNull();
    expect(String((error as { constraint?: string }).constraint ?? '')).toBe(constraint);
  }

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);

    userId = (
      await createUser(client, {
        displayName: 'Schema User',
        email: uniqueToken('schema') + '@test.com',
        password: 'Password123!',
        role: 'SALES_REP',
      })
    ).id;
    contactId = (await createContact(client, { fullName: 'Schema Contact' })).id;

    const { rows: sourceRows } = await client.query<{ id: string }>(
      `SELECT id FROM crm_source WHERE code = 'website'`,
    );
    sourceId = sourceRows[0].id;

    const lead = await createLead(client, {
      sourceId,
      campaignId: null,
      contactId,
      accountId: null,
      productCategoryId: null,
      note: null,
      ownerUserId: userId,
    });
    const { rows: oppRows } = await client.query<{ id: string }>(
      `INSERT INTO crm_opportunity
         (lead_id, contact_id, owner_user_id, product_category_id, stage, estimated_value,
          notes, won_at, lost_at, lost_reason_id)
       VALUES ($1, $2, $3, NULL, 'QUALIFIED', NULL, NULL, NULL, NULL, NULL)
       RETURNING id`,
      [lead.id, contactId, userId],
    );
    opportunityId = oppRows[0].id;
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  describe('crm_quotation', () => {
    it('rejects an unknown status', async () => {
      // Enum violations surface as invalid input values (22P02) without a
      // table constraint name, so this case asserts on the error itself.
      const error = await insertQuotation({ status: 'SHIPPED' }).then(
        () => null,
        (err: unknown) => err,
      );
      expect(error).not.toBeNull();
      expect((error as { code?: string }).code).toBe('22P02');
      expect((error as Error).message).toContain('crm_quotation_status');
    });

    it('accepts every configured status in its valid shape', async () => {
      await insertQuotation({ status: 'DRAFT' });
      await insertQuotation({ status: 'SENT', sent_at: new Date() });
      await insertQuotation({ status: 'ACCEPTED', accepted_at: new Date(), sent_at: new Date() });
      await insertQuotation({ status: 'REJECTED', rejected_at: new Date(), sent_at: new Date() });
      await insertQuotation({ status: 'EXPIRED', expired_at: new Date() });
    });

    it('rejects a SENT quotation with no sent_at', async () => {
      await expectConstraint(
        'crm_quotation_status_timestamps',
        insertQuotation({ status: 'SENT' }),
      );
    });

    it('rejects a DRAFT carrying sent_at', async () => {
      await expectConstraint(
        'crm_quotation_status_timestamps',
        insertQuotation({ status: 'DRAFT', sent_at: new Date() }),
      );
    });

    it('rejects an ACCEPTED quotation with no accepted_at', async () => {
      await expectConstraint(
        'crm_quotation_status_timestamps',
        insertQuotation({ status: 'ACCEPTED' }),
      );
    });

    it('rejects negative amounts', async () => {
      await expectConstraint(
        'crm_quotation_amounts_non_negative',
        insertQuotation({ subtotal: '-1.00', total_amount: '-1.00' }),
      );
    });

    it('rejects a total that does not equal subtotal - discount + tax', async () => {
      await expectConstraint(
        'crm_quotation_total_consistent',
        insertQuotation({ subtotal: '100.00', discount_amount: '10.00', tax_amount: '5.00', total_amount: '96.00' }),
      );
    });

    it('rejects version zero', async () => {
      await expectConstraint(
        'crm_quotation_version_positive',
        insertQuotation({ version: 0 }),
      );
    });

    it('rejects a duplicate quote number', async () => {
      const number = uniqueToken('Q');
      await insertQuotation({ quote_number: number });
      await expectConstraint('crm_quotation_quote_number_key', insertQuotation({ quote_number: number }));
    });

    it('rejects a quotation for an opportunity that does not exist', async () => {
      await expectConstraint(
        'crm_quotation_opportunity_id_fkey',
        insertQuotation({ opportunity_id: '00000000-0000-0000-0000-000000000000' }),
      );
    });

    it('refuses to delete an opportunity that has a quotation', async () => {
      await insertQuotation();
      await expectConstraint(
        'crm_quotation_opportunity_id_fkey',
        client.query(`DELETE FROM crm_opportunity WHERE id = $1`, [opportunityId]),
      );
    });

    it('refuses to delete a quotation that a revision chain points at', async () => {
      const parentId = await insertQuotation();
      await insertQuotation({ previous_quote_id: parentId, version: 2 });
      await expectConstraint(
        'crm_quotation_previous_quote_id_fkey',
        client.query(`DELETE FROM crm_quotation WHERE id = $1`, [parentId]),
      );
    });
  });

  describe('crm_quotation_item', () => {
    let quotationId: string;

    beforeAll(async () => {
      quotationId = await insertQuotation();
    });

    async function insertItem(overrides: Record<string, unknown> = {}) {
      const row = {
        quotation_id: quotationId,
        sequence: 1,
        description: 'Line item',
        quantity: '1.00',
        unit_price: '100.00',
        line_total: '100.00',
        ...overrides,
      };
      return client.query(
        `INSERT INTO crm_quotation_item
           (quotation_id, sequence, description, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.quotation_id, row.sequence, row.description, row.quantity, row.unit_price, row.line_total],
      );
    }

    it('rejects a non-positive quantity', async () => {
      await expectConstraint(
        'crm_quotation_item_quantity_positive',
        insertItem({ sequence: 2, quantity: '0.00', line_total: '0.00' }),
      );
    });

    it('rejects a negative unit price', async () => {
      await expectConstraint(
        'crm_quotation_item_unit_price_non_negative',
        insertItem({ sequence: 2, unit_price: '-1.00', line_total: '-1.00' }),
      );
    });

    it('rejects a line total that disagrees with the product', async () => {
      await expectConstraint(
        'crm_quotation_item_line_total_correct',
        insertItem({ sequence: 2, quantity: '2.00', unit_price: '50.00', line_total: '99.00' }),
      );
    });

    it('rejects a sequence below one', async () => {
      await expectConstraint(
        'crm_quotation_item_sequence_positive',
        insertItem({ sequence: 0 }),
      );
    });

    it('accepts a product that needs rounding: line_total is the rounded product (0008)', async () => {
      // 1.11 x 1.11 = 1.2321 -> stored line_total 1.23. Before migration 0008
      // this exact insert was rejected; it is now the normal case.
      const { rows } = await client.query<{ line_total: string }>(
        `INSERT INTO crm_quotation_item
           (quotation_id, sequence, description, quantity, unit_price, line_total)
         VALUES ($1, 3, 'Rounded product', '1.11', '1.11', '1.23')
         RETURNING line_total::text AS line_total`,
        [quotationId],
      );
      expect(rows[0].line_total).toBe('1.23');
    });
  });

  describe('crm_quotation_revision', () => {
    let quotationId: string;

    beforeAll(async () => {
      quotationId = await insertQuotation();
    });

    it('stores an immutable snapshot with the acting user', async () => {
      await client.query(
        `INSERT INTO crm_quotation_revision
           (quotation_id, version, status, subtotal, discount_amount, tax_amount,
            total_amount, notes, terms_conditions, valid_until, changed_by, change_reason)
         VALUES ($1, 1, 'DRAFT', '100.00', '0.00', '0.00', '100.00', NULL, NULL, NULL, $2, 'Initial')`,
        [quotationId, userId],
      );
      const { rows } = await client.query<{ changed_by: string }>(
        `SELECT changed_by FROM crm_quotation_revision WHERE quotation_id = $1`,
        [quotationId],
      );
      expect(rows[0].changed_by).toBe(userId);
    });

    it('rejects deleting a quotation that has revision snapshots (0009 history protection)', async () => {
      // A quotation with a snapshot is commercial history: the database itself
      // must refuse to destroy it. Before 0009 the revision FK CASCADEed and
      // this delete would have silently taken the snapshot with it.
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM crm_quotation_revision WHERE quotation_id = $1`,
        [quotationId],
      );
      expect(Number(rows[0].count)).toBeGreaterThanOrEqual(1);

      await expectConstraint(
        'crm_quotation_revision_quotation_id_fkey',
        client.query(`DELETE FROM crm_quotation WHERE id = $1`, [quotationId]),
      );

      const { rows: quotationRows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM crm_quotation WHERE id = $1`,
        [quotationId],
      );
      const { rows: snapshotRows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM crm_quotation_revision WHERE quotation_id = $1`,
        [quotationId],
      );
      expect(quotationRows[0].count).toBe('1');
      expect(snapshotRows[0].count).toBe('1');
    });
  });

  describe('crm_opportunity_activity vocabulary', () => {
    it('accepts every quotation activity type', async () => {
      for (const activityType of [
        'QUOTATION_CREATED',
        'QUOTATION_REVISED',
        'QUOTATION_SENT',
        'QUOTATION_ACCEPTED',
        'QUOTATION_REJECTED',
        'QUOTATION_EXPIRED',
      ]) {
        await client.query(
          `INSERT INTO crm_opportunity_activity (opportunity_id, activity_type, description, actor_user_id)
           VALUES ($1, $2, 'probe', $3)`,
          [opportunityId, activityType, userId],
        );
      }
    });
  });

  describe('no quotation deletion surface', () => {
    // The 0009 RESTRICT guarantee is the backstop. The primary control is that
    // the application simply never offers deletion: no delete SQL in the
    // quotation server domain and no delete action or UI affordance.
    it('contains no DELETE statement in the quotation server domain or UI', () => {
      const roots = ['src/server/crm/quotations', 'src/app/crm/quotations'];
      for (const root of roots) {
        for (const entry of readdirSync(path.resolve(process.cwd(), root), { recursive: true })) {
          const file = path.join(root, String(entry));
          if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
          const content = readFileSync(path.resolve(process.cwd(), file), 'utf8');
          // Word boundary: deleting crm_quotation_item rows on a draft edit is
          // legitimate; deleting crm_quotation rows is not.
          expect(content, `${file} must never delete quotations`).not.toMatch(
            /DELETE\s+FROM\s+crm_quotation\b/,
          );
        }
      }
    });

    it('exposes no delete server action', () => {
      const actions = readFileSync(
        path.resolve(process.cwd(), 'src/server/crm/quotations/actions.ts'),
        'utf8',
      );
      expect(actions).not.toMatch(/export\s+async\s+function\s+\w*[Dd]elete/);
    });
  });
});
