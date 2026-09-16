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
  name: string;
  isActive: boolean;
}

type ProductRow = {
  id: string;
  category_id: string;
  name: string;
  is_active: boolean;
};

function toProduct(row: ProductRow): Product {
  return { id: row.id, categoryId: row.category_id, name: row.name, isActive: row.is_active };
}

const PRODUCT_COLUMNS = 'id, category_id, name, is_active';

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
