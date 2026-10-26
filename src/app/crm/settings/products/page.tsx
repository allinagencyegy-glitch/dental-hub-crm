import { PageHeader } from '@/components/crm/Ui';
import { requirePermission } from '@/server/auth/dal';
import { getCatalogAction } from '@/server/crm/catalog/actions';
import { getMessages } from '@/i18n/server';
import { ProductCatalog } from './ProductCatalog';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.products.pageTitle) };
}

export default async function ProductsSettingsPage() {
  // Authoritative, server-side. Reps never reach the query below.
  await requirePermission('catalog:manage');
  const [{ products, categories }, m] = await Promise.all([getCatalogAction(), getMessages()]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow={m.products.eyebrow} title={m.products.heading} description={m.products.description} />
      <ProductCatalog products={products} categories={categories} />
    </div>
  );
}
