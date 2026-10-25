/**
 * All SQL touching the CRM catalog tables: crm_source, crm_source_campaign,
 * crm_product_category, crm_product and crm_outcome_reason.
 *
 * Explicit, parameterised, no ORM. Every function takes its `Db` explicitly so
 * the same code serves the app pool, a transaction client, seeds and the
 * disposable test database.
 */
import type { Db } from '@/server/db/types';

/** The one place catalog code normalisation is defined. Mirrored by DB CHECKs. */
export function normaliseCode(code: string): string {
  return code.trim().toLowerCase();
}

export class DuplicateCodeError extends Error {
  constructor(code: string) {
    super(`"${code}" already exists.`);
    this.name = 'DuplicateCodeError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export interface Source {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

type SourceRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

function toSource(row: SourceRow): Source {
  return { id: row.id, code: row.code, name: row.name, isActive: row.is_active };
}

const SOURCE_COLUMNS = 'id, code, name, is_active';

export async function listSources(db: Db): Promise<Source[]> {
  const { rows } = await db.query<SourceRow>(
    `SELECT ${SOURCE_COLUMNS} FROM crm_source ORDER BY code ASC`,
  );
  return rows.map(toSource);
}

export async function findSourceByCode(db: Db, code: string): Promise<Source | null> {
  const { rows } = await db.query<SourceRow>(
    `SELECT ${SOURCE_COLUMNS} FROM crm_source WHERE code = $1`,
    [normaliseCode(code)],
  );
  return rows[0] ? toSource(rows[0]) : null;
}

export async function createSource(db: Db, input: { code: string; name: string }): Promise<Source> {
  try {
    const { rows } = await db.query<SourceRow>(
      `INSERT INTO crm_source (code, name) VALUES ($1, $2) RETURNING ${SOURCE_COLUMNS}`,
      [normaliseCode(input.code), input.name.trim()],
    );
    return toSource(rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateCodeError(normaliseCode(input.code));
    throw error;
  }
}

export interface SourceCampaign {
  id: string;
  sourceId: string;
  code: string;
  name: string;
  isActive: boolean;
}

type SourceCampaignRow = {
  id: string;
  source_id: string;
  code: string;
  name: string;
  is_active: boolean;
};

function toSourceCampaign(row: SourceCampaignRow): SourceCampaign {
  return {
    id: row.id,
    sourceId: row.source_id,
    code: row.code,
    name: row.name,
    isActive: row.is_active,
  };
}

const SOURCE_CAMPAIGN_COLUMNS = 'id, source_id, code, name, is_active';

export async function listSourceCampaigns(db: Db, sourceId: string): Promise<SourceCampaign[]> {
  const { rows } = await db.query<SourceCampaignRow>(
    `SELECT ${SOURCE_CAMPAIGN_COLUMNS} FROM crm_source_campaign WHERE source_id = $1 ORDER BY code ASC`,
    [sourceId],
  );
  return rows.map(toSourceCampaign);
}

export async function createSourceCampaign(
  db: Db,
  input: { sourceId: string; code: string; name: string },
): Promise<SourceCampaign> {
  try {
    const { rows } = await db.query<SourceCampaignRow>(
      `INSERT INTO crm_source_campaign (source_id, code, name)
       VALUES ($1, $2, $3) RETURNING ${SOURCE_CAMPAIGN_COLUMNS}`,
      [input.sourceId, normaliseCode(input.code), input.name.trim()],
    );
    return toSourceCampaign(rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateCodeError(normaliseCode(input.code));
    throw error;
  }
}

export interface ProductCategory {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

type ProductCategoryRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

function toProductCategory(row: ProductCategoryRow): ProductCategory {
  return { id: row.id, code: row.code, name: row.name, isActive: row.is_active };
}

const PRODUCT_CATEGORY_COLUMNS = 'id, code, name, is_active';

export async function listProductCategories(db: Db): Promise<ProductCategory[]> {
  const { rows } = await db.query<ProductCategoryRow>(
    `SELECT ${PRODUCT_CATEGORY_COLUMNS} FROM crm_product_category ORDER BY code ASC`,
  );
  return rows.map(toProductCategory);
}

export async function findProductCategoryByCode(
  db: Db,
  code: string,
): Promise<ProductCategory | null> {
  const { rows } = await db.query<ProductCategoryRow>(
    `SELECT ${PRODUCT_CATEGORY_COLUMNS} FROM crm_product_category WHERE code = $1`,
    [normaliseCode(code)],
  );
  return rows[0] ? toProductCategory(rows[0]) : null;
}

export async function createProductCategory(
  db: Db,
  input: { code: string; name: string },
): Promise<ProductCategory> {
  try {
    const { rows } = await db.query<ProductCategoryRow>(
      `INSERT INTO crm_product_category (code, name) VALUES ($1, $2) RETURNING ${PRODUCT_CATEGORY_COLUMNS}`,
      [normaliseCode(input.code), input.name.trim()],
    );
    return toProductCategory(rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateCodeError(normaliseCode(input.code));
    throw error;
  }
}

export interface Product {
  id: string;
  categoryId: string;
  /** The maker, e.g. ROSON. Null for an unbranded item. */
  brand: string | null;
  name: string;
  /** The starting price in EGP. Null = quoted case by case. */
  listPrice: number | null;
  isActive: boolean;
}

type ProductRow = {
  id: string;
  category_id: string;
  brand: string | null;
  name: string;
  list_price: string | null;
  is_active: boolean;
};

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    categoryId: row.category_id,
    brand: row.brand,
    name: row.name,
    listPrice: row.list_price === null ? null : Number(row.list_price),
    isActive: row.is_active,
  };
}

const PRODUCT_COLUMNS = 'id, category_id, brand, name, list_price, is_active';

export async function listProducts(db: Db, categoryId: string): Promise<Product[]> {
  const { rows } = await db.query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM crm_product WHERE category_id = $1 ORDER BY name ASC`,
    [categoryId],
  );
  return rows.map(toProduct);
}

export async function createProduct(
  db: Db,
  input: { categoryId: string; name: string },
): Promise<Product> {
  const { rows } = await db.query<ProductRow>(
    `INSERT INTO crm_product (category_id, name) VALUES ($1, $2) RETURNING ${PRODUCT_COLUMNS}`,
    [input.categoryId, input.name.trim()],
  );
  return toProduct(rows[0]);
}

/** Another product already has this brand and name. */
export class DuplicateProductError extends Error {
  constructor(brand: string | null, name: string) {
    super(`"${brand ? `${brand} ` : ''}${name}" is already in the catalogue.`);
    this.name = 'DuplicateProductError';
  }
}

/** A product as the catalogue page and the quotation picker show it. */
export interface CatalogProduct extends Product {
  categoryCode: string;
  categoryName: string;
}

type CatalogProductRow = ProductRow & { category_code: string; category_name: string };

function toCatalogProduct(row: CatalogProductRow): CatalogProduct {
  return { ...toProduct(row), categoryCode: row.category_code, categoryName: row.category_name };
}

/** Empty brand text is stored as null, so "no brand" has one spelling. */
function brandValue(brand: string | null | undefined): string | null {
  const trimmed = brand?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function priceValue(price: number | null): string | null {
  return price === null ? null : price.toFixed(2);
}

/** The whole catalogue, brand by brand. `activeOnly` hides retired models. */
export async function listCatalogProducts(
  db: Db,
  options: { activeOnly?: boolean } = {},
): Promise<CatalogProduct[]> {
  const { rows } = await db.query<CatalogProductRow>(
    `SELECT p.id, p.category_id, p.brand, p.name, p.list_price, p.is_active,
            c.code AS category_code, c.name AS category_name
       FROM crm_product p
       JOIN crm_product_category c ON c.id = p.category_id
      ${options.activeOnly ? 'WHERE p.is_active' : ''}
      ORDER BY p.brand ASC NULLS LAST, p.name ASC`,
  );
  return rows.map(toCatalogProduct);
}

/** The products among `ids` that exist. Order is not significant. */
export async function findProductsByIds(db: Db, ids: string[]): Promise<Product[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM crm_product WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return rows.map(toProduct);
}

export interface CatalogProductInput {
  categoryId: string;
  brand: string | null;
  name: string;
  listPrice: number | null;
}

export async function createCatalogProduct(db: Db, input: CatalogProductInput): Promise<Product> {
  const brand = brandValue(input.brand);
  try {
    const { rows } = await db.query<ProductRow>(
      `INSERT INTO crm_product (category_id, brand, name, list_price)
       VALUES ($1, $2, $3, $4) RETURNING ${PRODUCT_COLUMNS}`,
      [input.categoryId, brand, input.name.trim(), priceValue(input.listPrice)],
    );
    return toProduct(rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateProductError(brand, input.name.trim());
    throw error;
  }
}

/** Rewrites one product. Null when it does not exist. */
export async function updateCatalogProduct(
  db: Db,
  id: string,
  input: CatalogProductInput & { isActive: boolean },
): Promise<Product | null> {
  const brand = brandValue(input.brand);
  try {
    const { rows } = await db.query<ProductRow>(
      `UPDATE crm_product
          SET category_id = $2, brand = $3, name = $4, list_price = $5, is_active = $6,
              updated_at = now()
        WHERE id = $1
        RETURNING ${PRODUCT_COLUMNS}`,
      [id, input.categoryId, brand, input.name.trim(), priceValue(input.listPrice), input.isActive],
    );
    return rows[0] ? toProduct(rows[0]) : null;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateProductError(brand, input.name.trim());
    throw error;
  }
}

export interface ProductImportRow {
  categoryCode: string;
  brand: string;
  name: string;
  listPrice: number | null;
}

/**
 * Adds every row whose brand and name are not in the catalogue yet. A row
 * that is already there is left exactly as it is, so running an import again
 * never undoes a price someone changed in the app.
 */
export async function importProducts(
  db: Db,
  rows: ProductImportRow[],
): Promise<{ created: string[]; existing: string[] }> {
  const created: string[] = [];
  const existing: string[] = [];
  for (const row of rows) {
    const label = `${row.brand} ${row.name}`;
    const { rowCount } = await db.query(
      `INSERT INTO crm_product (category_id, brand, name, list_price)
       SELECT c.id, $2, $3, $4 FROM crm_product_category c WHERE c.code = $1
       ON CONFLICT (lower(btrim(COALESCE(brand, ''))), lower(btrim(name))) DO NOTHING`,
      [normaliseCode(row.categoryCode), brandValue(row.brand), row.name.trim(), priceValue(row.listPrice)],
    );
    if (rowCount === 1) {
      created.push(label);
      continue;
    }
    const category = await findProductCategoryByCode(db, row.categoryCode);
    if (!category) throw new Error(`Unknown product category "${row.categoryCode}" for ${label}.`);
    existing.push(label);
  }
  return { created, existing };
}

export interface OutcomeReason {
  id: string;
  kind: string;
  code: string;
  label: string;
  requiresNote: boolean;
  isActive: boolean;
}

type OutcomeReasonRow = {
  id: string;
  kind: string;
  code: string;
  label: string;
  requires_note: boolean;
  is_active: boolean;
};

function toOutcomeReason(row: OutcomeReasonRow): OutcomeReason {
  return {
    id: row.id,
    kind: row.kind,
    code: row.code,
    label: row.label,
    requiresNote: row.requires_note,
    isActive: row.is_active,
  };
}

const OUTCOME_REASON_COLUMNS = 'id, kind, code, label, requires_note, is_active';

export async function listOutcomeReasons(db: Db, kind: string): Promise<OutcomeReason[]> {
  const { rows } = await db.query<OutcomeReasonRow>(
    `SELECT ${OUTCOME_REASON_COLUMNS} FROM crm_outcome_reason WHERE kind = $1 ORDER BY code ASC`,
    [normaliseCode(kind)],
  );
  return rows.map(toOutcomeReason);
}

/**
 * Whether recording an outcome with this reason requires a note. The future
 * transactional repositories call this at write time; the flag is read from
 * the reason row, never copied onto the transactional record.
 */
export async function outcomeReasonRequiresNote(db: Db, id: string): Promise<boolean> {
  const { rows } = await db.query<{ requires_note: boolean }>(
    'SELECT requires_note FROM crm_outcome_reason WHERE id = $1 AND is_active = true',
    [id],
  );
  return rows[0]?.requires_note ?? false;
}
