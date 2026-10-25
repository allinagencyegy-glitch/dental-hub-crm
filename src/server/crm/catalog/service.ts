/**
 * Product catalogue use cases: the price list the quotation picker reads and
 * Settings -> Products maintains.
 */
import { db as defaultDb } from '@/server/db/client';
import type { Db } from '@/server/db/types';
import {
  DuplicateProductError,
  createCatalogProduct,
  listCatalogProducts,
  listProductCategories,
  updateCatalogProduct,
  type CatalogProduct,
  type CatalogProductInput,
  type Product,
  type ProductCategory,
} from './repository';

function getDb(db?: Db): Db {
  return db ?? defaultDb();
}

/** Which rule a product write broke. */
export type ProductProblem =
  | 'NAME_REQUIRED'
  | 'NAME_TOO_LONG'
  | 'BRAND_TOO_LONG'
  | 'PRICE_INVALID'
  | 'CATEGORY_UNKNOWN'
  | 'DUPLICATE'
  | 'NOT_FOUND'
  /** The request itself could not be read. */
  | 'UNREADABLE';

export type ProductResult =
  | { ok: true; product: Product }
  | { ok: false; problem: ProductProblem; message: string };

function failure(problem: ProductProblem, message: string): ProductResult {
  return { ok: false, problem, message };
}

const MAX_NAME_LENGTH = 200;
const MAX_BRAND_LENGTH = 60;
/** numeric(14,2) holds up to 12 digits before the point. */
const MAX_PRICE = 999_999_999_999.99;

async function validate(db: Db, input: CatalogProductInput): Promise<ProductResult | null> {
  const name = input.name.trim();
  if (name === '') return failure('NAME_REQUIRED', 'A product needs a name.');
  if (name.length > MAX_NAME_LENGTH) return failure('NAME_TOO_LONG', 'The product name is too long.');
  if ((input.brand?.trim().length ?? 0) > MAX_BRAND_LENGTH) {
    return failure('BRAND_TOO_LONG', 'The brand is too long.');
  }
  if (
    input.listPrice !== null &&
    (!Number.isFinite(input.listPrice) || input.listPrice < 0 || input.listPrice > MAX_PRICE)
  ) {
    return failure('PRICE_INVALID', 'The list price must be zero or more.');
  }
  const categories = await listProductCategories(db);
  if (!categories.some((category) => category.id === input.categoryId && category.isActive)) {
    return failure('CATEGORY_UNKNOWN', 'Choose one of the product categories.');
  }
  return null;
}

/** The catalogue and the categories it is grouped by. */
export async function getCatalogUseCase(
  options: { activeOnly?: boolean } = {},
  db?: Db,
): Promise<{ products: CatalogProduct[]; categories: ProductCategory[] }> {
  const database = getDb(db);
  const [products, categories] = await Promise.all([
    listCatalogProducts(database, options),
    listProductCategories(database),
  ]);
  return { products, categories: categories.filter((category) => category.isActive) };
}

export async function createProductUseCase(
  input: CatalogProductInput,
  db?: Db,
): Promise<ProductResult> {
  const database = getDb(db);
  const invalid = await validate(database, input);
  if (invalid) return invalid;
  try {
    return { ok: true, product: await createCatalogProduct(database, input) };
  } catch (error) {
    if (error instanceof DuplicateProductError) return failure('DUPLICATE', error.message);
    throw error;
  }
}

export async function updateProductUseCase(
  id: string,
  input: CatalogProductInput & { isActive: boolean },
  db?: Db,
): Promise<ProductResult> {
  const database = getDb(db);
  const invalid = await validate(database, input);
  if (invalid) return invalid;
  try {
    const product = await updateCatalogProduct(database, id, input);
    return product ? { ok: true, product } : failure('NOT_FOUND', 'Product not found.');
  } catch (error) {
    if (error instanceof DuplicateProductError) return failure('DUPLICATE', error.message);
    throw error;
  }
}
