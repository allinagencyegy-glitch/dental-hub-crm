import { randomUUID } from 'node:crypto';
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
import { createLead } from '../../src/server/crm/leads/repository';
import { qualifyLeadUseCase, type Actor } from '../../src/server/crm/opportunities/service';
import {
  createQuotationUseCase,
  getQuotationUseCase,
  reviseQuotationUseCase,
  transitionQuotationUseCase,
  updateDraftQuotationUseCase,
} from '../../src/server/crm/quotations/service';
import {
  DuplicateProductError,
  createCatalogProduct,
  findProductCategoryByCode,
  importProducts,
  listCatalogProducts,
  updateCatalogProduct,
} from '../../src/server/crm/catalog/repository';
import {
  createProductUseCase,
  getCatalogUseCase,
  updateProductUseCase,
} from '../../src/server/crm/catalog/service';
import { PRICE_LIST } from '../../scripts/catalog/price-list';
import { messagesFor } from '../../src/i18n/messages';
import { uniqueToken } from './setup/db';

/**
 * Product catalogue V1: brands and list prices, the price-list import, the
 * Settings -> Products rules, and quotation lines that name a model.
 *
 * A private database, because the import loads the real price list and the
 * shared one must not carry it.
 */
describe('product catalogue', () => {
  let database: DisposableDatabase;
  let client: Client;
  let unitsId: string;
  let lightsId: string;
  const manager: Actor = { userId: '', role: 'SALES_MANAGER' };
  const rep: Actor = { userId: '', role: 'SALES_REP' };
  let contactId: string;
  let sourceId: string;

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);

    unitsId = (await findProductCategoryByCode(client, 'dental_units'))!.id;
    lightsId = (await findProductCategoryByCode(client, 'curing_lights'))!.id;

    const mkUser = async (displayName: string, role: Actor['role']) =>
      (
        await createUser(client, {
          displayName,
          email: uniqueToken(displayName.replace(/ /g, '.')) + '@test.com',
          password: 'Password123!',
          role,
        })
      ).id;
    manager.userId = await mkUser('Catalogue Manager', 'SALES_MANAGER');
    rep.userId = await mkUser('Catalogue Rep', 'SALES_REP');
    contactId = (await createContact(client, { fullName: 'Dr Catalogue', email: 'dr.catalogue@clinic.test' })).id;
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM crm_source WHERE code = 'website'`);
    sourceId = rows[0].id;
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  describe('products', () => {
    it('stores the brand and list price, and an empty brand as no brand', async () => {
      const branded = await createCatalogProduct(client, {
        categoryId: unitsId,
        brand: '  ROSON ',
        name: ' R9 Test Unit ',
        listPrice: 99_500.5,
      });
      expect(branded).toMatchObject({ brand: 'ROSON', name: 'R9 Test Unit', listPrice: 99_500.5, isActive: true });

      const plain = await createCatalogProduct(client, {
        categoryId: unitsId,
        brand: '   ',
        name: 'Installation kit',
        listPrice: null,
      });
      expect(plain.brand).toBeNull();
      expect(plain.listPrice).toBeNull();
    });

    it('refuses the same brand and name twice, whatever the casing or spaces', async () => {
      await createCatalogProduct(client, { categoryId: unitsId, brand: 'Toye', name: 'TY-Dup', listPrice: 1 });
      await expect(
        createCatalogProduct(client, { categoryId: unitsId, brand: ' toye', name: 'ty-dup ', listPrice: 2 }),
      ).rejects.toBeInstanceOf(DuplicateProductError);
      // Another brand may use the same model name.
      await expect(
        createCatalogProduct(client, { categoryId: unitsId, brand: 'Other', name: 'TY-Dup', listPrice: 2 }),
      ).resolves.toMatchObject({ brand: 'Other' });
    });

    it('lets the database itself refuse a negative list price', async () => {
      await expect(
        client.query(
          `INSERT INTO crm_product (category_id, brand, name, list_price) VALUES ($1, 'X', 'Negative', -1)`,
          [unitsId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('updates a product and hides a retired one from the quotation picker', async () => {
      const product = await createCatalogProduct(client, {
        categoryId: lightsId,
        brand: 'Mecco',
        name: uniqueToken('Light'),
        listPrice: 2_000,
      });
      const updated = await updateCatalogProduct(client, product.id, {
        categoryId: lightsId,
        brand: 'Mecco',
        name: product.name,
        listPrice: 2_250,
        isActive: false,
      });
      expect(updated).toMatchObject({ listPrice: 2_250, isActive: false });

      const all = await listCatalogProducts(client);
      const active = await listCatalogProducts(client, { activeOnly: true });
      expect(all.map((row) => row.id)).toContain(product.id);
      expect(active.map((row) => row.id)).not.toContain(product.id);
      expect(all.find((row) => row.id === product.id)?.categoryCode).toBe('curing_lights');

      expect(await updateCatalogProduct(client, randomUUID(), { ...updated!, isActive: true })).toBeNull();
    });

    it('lists the catalogue brand by brand, unbranded items last', async () => {
      const brands = (await listCatalogProducts(client)).map((row) => row.brand);
      const firstUnbranded = brands.indexOf(null);
      expect(firstUnbranded).toBeGreaterThan(0);
      expect(brands.slice(firstUnbranded).every((brand) => brand === null)).toBe(true);
      // Each brand's models sit together.
      const runs = brands.filter((brand, index) => index === 0 || brand !== brands[index - 1]);
      expect(new Set(runs).size).toBe(runs.length);
    });
  });

  describe('Settings -> Products rules', () => {
    it('names the rule a product write breaks', async () => {
      const base = { categoryId: unitsId, brand: 'Rules', name: uniqueToken('Model'), listPrice: 10 };
      expect(await createProductUseCase({ ...base, name: '  ' }, client)).toMatchObject({ ok: false, problem: 'NAME_REQUIRED' });
      expect(await createProductUseCase({ ...base, name: 'x'.repeat(201) }, client)).toMatchObject({ ok: false, problem: 'NAME_TOO_LONG' });
      expect(await createProductUseCase({ ...base, brand: 'b'.repeat(61) }, client)).toMatchObject({ ok: false, problem: 'BRAND_TOO_LONG' });
      expect(await createProductUseCase({ ...base, listPrice: -5 }, client)).toMatchObject({ ok: false, problem: 'PRICE_INVALID' });
      expect(await createProductUseCase({ ...base, listPrice: Number.NaN }, client)).toMatchObject({ ok: false, problem: 'PRICE_INVALID' });
      expect(await createProductUseCase({ ...base, categoryId: randomUUID() }, client)).toMatchObject({ ok: false, problem: 'CATEGORY_UNKNOWN' });

      const created = await createProductUseCase(base, client);
      expect(created.ok).toBe(true);
      expect(await createProductUseCase(base, client)).toMatchObject({ ok: false, problem: 'DUPLICATE' });
      expect(
        await updateProductUseCase(randomUUID(), { ...base, name: uniqueToken('Gone'), isActive: true }, client),
      ).toMatchObject({ ok: false, problem: 'NOT_FOUND' });
    });

    it('offers only the active categories', async () => {
      const { categories } = await getCatalogUseCase({}, client);
      expect(categories.map((category) => category.code)).toEqual(
        expect.arrayContaining(['dental_units', 'autoclaves', 'sterilization', 'curing_lights', 'endodontics']),
      );
      expect(categories.every((category) => category.isActive)).toBe(true);
    });

    it('has text for every problem in both languages', () => {
      const problems = ['NAME_REQUIRED', 'NAME_TOO_LONG', 'BRAND_TOO_LONG', 'PRICE_INVALID', 'CATEGORY_UNKNOWN', 'DUPLICATE', 'NOT_FOUND', 'UNREADABLE'];
      for (const m of [messagesFor('ar'), messagesFor('en')]) {
        expect(Object.keys(m.products.problems).sort()).toEqual([...problems].sort());
      }
      expect(messagesFor('ar').products.count(1)).toBe('منتج واحد');
      expect(messagesFor('ar').products.count(2)).toBe('منتجان');
      expect(messagesFor('ar').products.count(6)).toBe('6 منتجات');
      expect(messagesFor('ar').products.count(26)).toBe('26 منتج');
    });
  });

  describe('price list import', () => {
    it('describes each model once, in a category the database knows', async () => {
      const keys = PRICE_LIST.map((row) => `${row.brand.toLowerCase()}|${row.name.toLowerCase()}`);
      expect(new Set(keys).size).toBe(PRICE_LIST.length);
      for (const row of PRICE_LIST) {
        expect(await findProductCategoryByCode(client, row.categoryCode)).not.toBeNull();
        if (row.listPrice !== null) expect(row.listPrice).toBeGreaterThan(0);
      }
    });

    it('adds the price list once and never overwrites a price changed in the app', async () => {
      const first = await importProducts(client, PRICE_LIST);
      expect(first.created).toHaveLength(PRICE_LIST.length);
      expect(first.existing).toEqual([]);

      const catalogue = await listCatalogProducts(client);
      const a1 = catalogue.find((row) => row.brand === 'ROSON' && row.name === 'A1 Pro Dental Unit');
      expect(a1).toMatchObject({ listPrice: 210_000, categoryCode: 'dental_units' });
      const endo = catalogue.find((row) => row.brand === 'Mecco' && row.name === 'Endo Mini');
      expect(endo?.listPrice).toBeNull();

      await updateCatalogProduct(client, a1!.id, {
        categoryId: a1!.categoryId,
        brand: a1!.brand,
        name: a1!.name,
        listPrice: 205_000,
        isActive: true,
      });

      const second = await importProducts(client, PRICE_LIST);
      expect(second.created).toEqual([]);
      expect(second.existing).toHaveLength(PRICE_LIST.length);
      const after = (await listCatalogProducts(client)).find((row) => row.id === a1!.id);
      expect(after?.listPrice).toBe(205_000);
    });

    it('refuses a row whose category does not exist', async () => {
      await expect(
        importProducts(client, [{ categoryCode: 'no_such_category', brand: 'X', name: 'Y', listPrice: 1 }]),
      ).rejects.toThrow(/Unknown product category/);
    });
  });

  describe('quotation lines', () => {
    async function newOpportunity() {
      const lead = await createLead(client, {
        sourceId,
        campaignId: null,
        contactId,
        accountId: null,
        productCategoryId: null,
        note: null,
        ownerUserId: rep.userId,
      });
      const result = await qualifyLeadUseCase(manager, lead.id, {}, client);
      if (!result.ok) throw new Error('setup failed');
      return result.opportunity;
    }

    it('records the model a line sells, keeps typed lines free, and carries both into a revision', async () => {
      const product = await createCatalogProduct(client, {
        categoryId: unitsId,
        brand: 'ROSON',
        name: uniqueToken('Quoted Unit'),
        listPrice: 150_000,
      });
      const opportunity = await newOpportunity();

      const created = await createQuotationUseCase(
        rep,
        opportunity.id,
        {
          items: [
            // The rep may quote below the list price; the line keeps what was quoted.
            { productId: product.id, description: `ROSON ${product.name}`, quantity: 1, unitPrice: 145_000 },
            { productId: null, description: 'Delivery and installation', quantity: 1, unitPrice: 2_000 },
          ],
        },
        client,
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const detail = await getQuotationUseCase(rep, created.quotation.id, client);
      expect(detail?.items.map((item) => [item.productId, item.unitPrice])).toEqual([
        [product.id, 145_000],
        [null, 2_000],
      ]);

      // A later price change does not touch the written quotation.
      await updateCatalogProduct(client, product.id, {
        categoryId: unitsId,
        brand: 'ROSON',
        name: product.name,
        listPrice: 160_000,
        isActive: true,
      });
      expect((await getQuotationUseCase(rep, created.quotation.id, client))?.items[0].unitPrice).toBe(145_000);

      const sent = await transitionQuotationUseCase(rep, created.quotation.id, 'SENT', client);
      expect(sent.ok).toBe(true);
      const revision = await reviseQuotationUseCase(rep, created.quotation.id, client);
      expect(revision.ok).toBe(true);
      if (!revision.ok) return;
      const revised = await getQuotationUseCase(rep, revision.quotation.id, client);
      expect(revised?.items.map((item) => item.productId)).toEqual([product.id, null]);
    });

    it('refuses a line naming a product that does not exist', async () => {
      const opportunity = await newOpportunity();
      const result = await createQuotationUseCase(
        rep,
        opportunity.id,
        { items: [{ productId: randomUUID(), description: 'Ghost', quantity: 1, unitPrice: 1 }] },
        client,
      );
      expect(result).toMatchObject({ ok: false, error: 'VALIDATION', problem: 'UNKNOWN_PRODUCT' });
      expect(messagesFor('ar').quotations.problems.UNKNOWN_PRODUCT).toBeTruthy();
    });

    it('still saves a draft whose model was retired after it was picked', async () => {
      const product = await createCatalogProduct(client, {
        categoryId: lightsId,
        brand: 'Mecco',
        name: uniqueToken('Retired Light'),
        listPrice: 3_000,
      });
      const opportunity = await newOpportunity();
      const created = await createQuotationUseCase(
        rep,
        opportunity.id,
        { items: [{ productId: product.id, description: 'Light', quantity: 2, unitPrice: 3_000 }] },
        client,
      );
      if (!created.ok) throw new Error('setup failed');

      await updateCatalogProduct(client, product.id, { ...product, isActive: false });

      const edited = await updateDraftQuotationUseCase(
        rep,
        created.quotation.id,
        { items: [{ productId: product.id, description: 'Light', quantity: 3, unitPrice: 2_900 }] },
        client,
      );
      expect(edited.ok).toBe(true);
    });

    it('keeps a quoted product from being deleted', async () => {
      const { rows } = await client.query<{ product_id: string }>(
        `SELECT product_id FROM crm_quotation_item WHERE product_id IS NOT NULL LIMIT 1`,
      );
      await expect(client.query(`DELETE FROM crm_product WHERE id = $1`, [rows[0].product_id])).rejects.toMatchObject({
        code: '23503',
      });
    });
  });
});
