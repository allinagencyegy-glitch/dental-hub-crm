import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { connectTestDb, uniqueToken } from './setup/db';
import {
  DuplicateCodeError,
  createProduct,
  createProductCategory,
  createSource,
  createSourceCampaign,
  findProductCategoryByCode,
  findSourceByCode,
  listOutcomeReasons,
  listProducts,
  listSourceCampaigns,
  listSources,
  normaliseCode,
  outcomeReasonRequiresNote,
} from '../../src/server/crm/catalog/repository';

let db: Client;

beforeAll(async () => {
  db = await connectTestDb();
});

afterAll(async () => {
  await db.end();
});

describe('sources', () => {
  it('normalises codes to lowercase trimmed form', async () => {
    const code = uniqueToken('Source X');
    const source = await createSource(db, { code: `  ${code} `, name: 'A source' });

    expect(source.code).toBe(normaliseCode(code));
    expect(source.code).toBe(source.code.toLowerCase().trim());

    // Lookups normalise too, so any casing finds the same row.
    expect((await findSourceByCode(db, code.toUpperCase()))?.id).toBe(source.id);
  });

  it('rejects a duplicate source code, whatever the casing', async () => {
    const code = uniqueToken('duplicate');
    await createSource(db, { code, name: 'First' });

    await expect(createSource(db, { code: code.toUpperCase(), name: 'Second' })).rejects.toBeInstanceOf(
      DuplicateCodeError,
    );
  });

  it('rejects a duplicate of a seeded source code', async () => {
    await expect(createSource(db, { code: ' Website ', name: 'Copy' })).rejects.toBeInstanceOf(
      DuplicateCodeError,
    );
  });

  it('lets the database itself refuse a non-normalised code', async () => {
    await expect(
      db.query(`INSERT INTO crm_source (code, name) VALUES ('Not Normalised', 'x')`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('seeds the stable Dental Hub source catalog', async () => {
    // The shared suite database also holds sources created by other tests,
    // so assert the locked catalog is present rather than exclusive.
    const codes = (await listSources(db)).map((source) => source.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'existing_customer',
        'exhibition',
        'facebook',
        'instagram',
        'outbound',
        'phone',
        'referral',
        'walk_in',
        'website',
        'whatsapp',
      ]),
    );

    // WhatsApp is a valid lead source even though PHONE is the canonical
    // contact identity; lookups normalise casing.
    expect((await findSourceByCode(db, 'WHATSAPP'))?.name).toBe('WhatsApp');
  });
});

describe('source campaigns', () => {
  it('requires every campaign to belong to an existing source', async () => {
    await expect(
      createSourceCampaign(db, {
        sourceId: randomUUID(),
        code: uniqueToken('orphan'),
        name: 'Orphan campaign',
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('keeps campaign codes unique within their source only', async () => {
    const sourceA = await createSource(db, { code: uniqueToken('src_a'), name: 'Source A' });
    const sourceB = await createSource(db, { code: uniqueToken('src_b'), name: 'Source B' });
    const code = uniqueToken('launch');

    const campaign = await createSourceCampaign(db, {
      sourceId: sourceA.id,
      code: ` ${code.toUpperCase()} `,
      name: 'Launch',
    });
    expect(campaign.code).toBe(code.toLowerCase());

    // The same code under a different source is a different campaign.
    await expect(
      createSourceCampaign(db, { sourceId: sourceB.id, code, name: 'Launch B' }),
    ).resolves.toMatchObject({ sourceId: sourceB.id, code: code.toLowerCase() });

    // The same code under the same source is a duplicate.
    await expect(
      createSourceCampaign(db, { sourceId: sourceA.id, code: code.toUpperCase(), name: 'Again' }),
    ).rejects.toBeInstanceOf(DuplicateCodeError);

    const campaigns = await listSourceCampaigns(db, sourceA.id);
    expect(campaigns).toHaveLength(1);
  });
});

describe('product catalog', () => {
  it('requires every product to belong to an existing category', async () => {
    await expect(
      createProduct(db, { categoryId: randomUUID(), name: 'Orphan product' }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('creates products inside a category and lists them', async () => {
    const category = await createProductCategory(db, {
      code: uniqueToken('cat'),
      name: 'Category',
    });
    const name = uniqueToken('Product');
    await createProduct(db, { categoryId: category.id, name });

    const products = await listProducts(db, category.id);
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe(name);
  });

  it('enforces category code uniqueness and normalisation', async () => {
    const code = uniqueToken('catdup');
    await createProductCategory(db, { code, name: 'First' });

    await expect(
      createProductCategory(db, { code: ` ${code.toUpperCase()} `, name: 'Second' }),
    ).rejects.toBeInstanceOf(DuplicateCodeError);

    expect((await findProductCategoryByCode(db, code.toUpperCase()))?.code).toBe(code);
  });
});

describe('outcome reasons', () => {
  const KINDS = ['disqualify', 'hold', 'lost'] as const;

  const expectedCodes: Record<(typeof KINDS)[number], string[]> = {
    disqualify: ['job_applicant', 'other', 'out_of_scope', 'spam', 'student_research', 'wrong_number'],
    hold: [
      'awaiting_clinic_readiness',
      'awaiting_finance',
      'awaiting_stock',
      'customer_travelling',
      'other',
      'ramadan_seasonal',
    ],
    lost: [
      'bought_competitor',
      'clinic_closed',
      'no_budget',
      'no_response',
      'other',
      'price_too_high',
      'timing_postponed',
      'wrong_fit',
    ],
  };

  it('seeds the stable outcome reasons by kind', async () => {
    for (const kind of KINDS) {
      const reasons = await listOutcomeReasons(db, kind);
      expect(reasons.map((reason) => reason.code)).toEqual(expectedCodes[kind]);
      for (const reason of reasons) {
        expect(reason.kind).toBe(kind);
        expect(reason.label.length).toBeGreaterThan(0);
        expect(reason.isActive).toBe(true);
      }
    }
  });

  it('marks exactly the free-text "other" reason of each kind as requiring a note', async () => {
    for (const kind of KINDS) {
      // Lookup normalises kind casing.
      const reasons = await listOutcomeReasons(db, kind.toUpperCase());
      for (const reason of reasons) {
        expect(reason.requiresNote).toBe(reason.code === 'other');
        expect(await outcomeReasonRequiresNote(db, reason.id)).toBe(reason.code === 'other');
      }
    }
  });

  it('treats a callback as future work, not a terminal outcome', async () => {
    for (const kind of KINDS) {
      const codes = (await listOutcomeReasons(db, kind)).map((reason) => reason.code);
      expect(codes).not.toContain('callback_requested');
    }
  });
});
