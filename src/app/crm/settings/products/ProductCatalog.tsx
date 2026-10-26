'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { createProductAction, updateProductAction } from '@/server/crm/catalog/actions';
import type { CatalogProduct, ProductCategory } from '@/server/crm/catalog/repository';
import { useFormatters, useMessages } from '@/i18n/I18nProvider';
import { catalogLabel } from '@/i18n/format';

const LABEL_CLASS = 'block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d]';
const FIELD_CLASS =
  'h-9 w-full rounded-lg border border-[#dfe4e7] bg-white px-3 text-[12px] text-[#17242c] outline-none transition placeholder:text-[#94a0a9] focus:border-[#18b6a4]';
const PRIMARY_BUTTON =
  'inline-flex h-9 items-center rounded-lg bg-[#132932] px-4 text-[11px] font-semibold text-white transition hover:bg-[#1b3944] disabled:opacity-60';
const SECONDARY_BUTTON =
  'inline-flex h-8 items-center rounded-lg border border-[#dbe2e5] bg-white px-3 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa] disabled:opacity-60';

interface Draft {
  brand: string;
  name: string;
  categoryId: string;
  listPrice: string;
}

/** The form's price text as the action expects it: empty = no list price. */
function parsePrice(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, '');
  return trimmed === '' ? null : Number(trimmed);
}

function draftOf(product: CatalogProduct): Draft {
  return {
    brand: product.brand ?? '',
    name: product.name,
    categoryId: product.categoryId,
    listPrice: product.listPrice === null ? '' : String(product.listPrice),
  };
}

function ProductFields({
  idPrefix,
  draft,
  categories,
  onChange,
}: {
  idPrefix: string;
  draft: Draft;
  categories: ProductCategory[];
  onChange: (patch: Partial<Draft>) => void;
}) {
  const m = useMessages();
  const t = m.products;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-brand`} className={LABEL_CLASS}>
          {t.brand}
        </label>
        <input
          id={`${idPrefix}-brand`}
          value={draft.brand}
          maxLength={60}
          dir="auto"
          placeholder={t.brandPlaceholder}
          onChange={(event) => onChange({ brand: event.target.value })}
          className={FIELD_CLASS}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-name`} className={LABEL_CLASS}>
          {t.name}
        </label>
        <input
          id={`${idPrefix}-name`}
          value={draft.name}
          required
          maxLength={200}
          dir="auto"
          placeholder={t.namePlaceholder}
          onChange={(event) => onChange({ name: event.target.value })}
          className={FIELD_CLASS}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-category`} className={LABEL_CLASS}>
          {t.category}
        </label>
        <select
          id={`${idPrefix}-category`}
          value={draft.categoryId}
          onChange={(event) => onChange({ categoryId: event.target.value })}
          className={FIELD_CLASS}
        >
          <option value="" disabled>
            —
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {catalogLabel(m.catalog.productCategories, category.code, category.name)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-price`} className={LABEL_CLASS}>
          {t.listPrice}
        </label>
        <input
          id={`${idPrefix}-price`}
          value={draft.listPrice}
          inputMode="decimal"
          dir="ltr"
          placeholder={t.listPricePlaceholder}
          onChange={(event) => onChange({ listPrice: event.target.value })}
          className={FIELD_CLASS}
        />
      </div>
    </div>
  );
}

function ProductRow({ product, categories }: { product: CatalogProduct; categories: ProductCategory[] }) {
  const router = useRouter();
  const m = useMessages();
  const f = useFormatters();
  const t = m.products;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(product));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: { isActive?: boolean } = {}) => {
    const source = patch.isActive === undefined ? draft : draftOf(product);
    setBusy(true);
    setError(null);
    try {
      const result = await updateProductAction(product.id, {
        categoryId: source.categoryId,
        brand: source.brand,
        name: source.name,
        listPrice: parsePrice(source.listPrice),
        isActive: patch.isActive ?? product.isActive,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError(m.common.unexpectedError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="px-5 py-3.5">
      {editing ? (
        <div className="space-y-3">
          <ProductFields
            idPrefix={`product-${product.id}`}
            draft={draft}
            categories={categories}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} disabled={busy} className={PRIMARY_BUTTON}>
              {busy ? t.saving : t.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(draftOf(product));
                setEditing(false);
                setError(null);
              }}
              disabled={busy}
              className={SECONDARY_BUTTON}
            >
              {t.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-[#1c2831]">
              <span dir="auto" className="truncate">
                {product.name}
              </span>
              {product.isActive ? null : (
                <span className="rounded-full bg-[#edf0f2] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#63707a]">
                  {t.retired}
                </span>
              )}
            </p>
            <p className="mt-0.5 text-[10px] text-[#8a959d]">
              {catalogLabel(m.catalog.productCategories, product.categoryCode, product.categoryName)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <span
              className={`min-w-[110px] text-[12px] sm:text-end ${product.listPrice === null ? 'text-[#94a0a9]' : 'font-semibold text-[#1c2831]'}`}
            >
              {product.listPrice === null ? t.noPrice : f.currency(product.listPrice)}
            </span>
            <button
              type="button"
              onClick={() => {
                setDraft(draftOf(product));
                setEditing(true);
              }}
              disabled={busy}
              className={SECONDARY_BUTTON}
            >
              {t.edit}
            </button>
            <button
              type="button"
              onClick={() => void save({ isActive: !product.isActive })}
              disabled={busy}
              className={SECONDARY_BUTTON}
            >
              {product.isActive ? t.retire : t.restore}
            </button>
          </div>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[11px] font-semibold text-[#c43f47]">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function AddProductForm({ categories }: { categories: ProductCategory[] }) {
  const router = useRouter();
  const m = useMessages();
  const t = m.products;
  const empty: Draft = { brand: '', name: '', categoryId: '', listPrice: '' };
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createProductAction({
        categoryId: draft.categoryId,
        brand: draft.brand,
        name: draft.name,
        listPrice: parsePrice(draft.listPrice),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNotice(t.created(m.quotations.productLabel(result.product.brand, result.product.name)));
      // The brand stays filled: models are usually entered brand by brand.
      setDraft({ ...empty, brand: draft.brand, categoryId: draft.categoryId });
      router.refresh();
    } catch {
      setError(m.common.unexpectedError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="rounded-xl border border-[#dfe5e8] bg-white p-5">
      <h2 className="text-sm font-semibold text-[#1c2831]">{t.addTitle}</h2>
      <div className="mt-4">
        <ProductFields
          idPrefix="new-product"
          draft={draft}
          categories={categories}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-[#f4c7ca] bg-[#ffe9ea] px-3 py-2 text-sm text-[#c43f47]">
          {error}
        </p>
      ) : null}
      {notice ? <p className="mt-4 rounded-lg bg-[#e8f8f1] px-3 py-2 text-sm text-[#14815f]">{notice}</p> : null}
      <button type="submit" disabled={busy} className={`mt-4 ${PRIMARY_BUTTON}`}>
        {busy ? t.adding : t.add}
      </button>
    </form>
  );
}

export function ProductCatalog({
  products,
  categories,
}: {
  products: CatalogProduct[];
  categories: ProductCategory[];
}) {
  const m = useMessages();
  const t = m.products;

  // Brand by brand, in the order the server sorted them (unbranded last).
  const groups: { brand: string | null; products: CatalogProduct[] }[] = [];
  for (const product of products) {
    const last = groups[groups.length - 1];
    if (last && last.brand === product.brand) last.products.push(product);
    else groups.push({ brand: product.brand, products: [product] });
  }

  return (
    <div className="space-y-6">
      <AddProductForm categories={categories} />

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#d5dde1] bg-white px-5 py-8 text-center text-[12px] text-[#75828c]">
          {t.empty}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.brand ?? ''} className="overflow-hidden rounded-xl border border-[#dfe5e8] bg-white">
            <header className="flex items-center justify-between gap-3 border-b border-[#e7ebed] bg-[#f8fafb] px-5 py-3">
              <h2 dir="auto" className="text-[13px] font-semibold text-[#1c2831]">
                {group.brand ?? t.noBrand}
              </h2>
              <span className="text-[10px] font-semibold text-[#8a959d]">{t.count(group.products.length)}</span>
            </header>
            <ul className="divide-y divide-[#edf0f2]">
              {group.products.map((product) => (
                <ProductRow key={product.id} product={product} categories={categories} />
              ))}
            </ul>
          </section>
        ))
      )}
      <p className="text-[10px] text-[#8a959d]">{t.retiredHint}</p>
    </div>
  );
}
