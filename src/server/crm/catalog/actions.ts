'use server';

import 'server-only';
import { z } from 'zod';
import { assertPermission } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import {
  createProductUseCase,
  getCatalogUseCase,
  updateProductUseCase,
  type ProductResult,
} from './service';
import type { CatalogProduct, ProductCategory } from './repository';

const productSchema = z.object({
  categoryId: z.uuid(),
  brand: z.string().nullable(),
  name: z.string(),
  listPrice: z.number().nullable(),
});

const productUpdateSchema = productSchema.extend({ isActive: z.boolean() });

async function localise(result: ProductResult): Promise<ProductResult> {
  if (result.ok) return result;
  const m = await getMessages();
  return { ...result, message: m.products.problems[result.problem] };
}

/** The active models a quotation line can be picked from. */
export async function listQuotableProductsAction(): Promise<CatalogProduct[]> {
  await assertPermission('quotations:write');
  return (await getCatalogUseCase({ activeOnly: true })).products;
}

/** Every model, retired ones included, for Settings -> Products. */
export async function getCatalogAction(): Promise<{
  products: CatalogProduct[];
  categories: ProductCategory[];
}> {
  await assertPermission('catalog:manage');
  return getCatalogUseCase();
}

export async function createProductAction(input: unknown): Promise<ProductResult> {
  await assertPermission('catalog:manage');
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return localise({ ok: false, problem: 'UNREADABLE', message: '' });
  return localise(await createProductUseCase(parsed.data));
}

export async function updateProductAction(id: unknown, input: unknown): Promise<ProductResult> {
  await assertPermission('catalog:manage');
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return localise({ ok: false, problem: 'NOT_FOUND', message: '' });
  const parsed = productUpdateSchema.safeParse(input);
  if (!parsed.success) return localise({ ok: false, problem: 'UNREADABLE', message: '' });
  return localise(await updateProductUseCase(parsedId.data, parsed.data));
}
