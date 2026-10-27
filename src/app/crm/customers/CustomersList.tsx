'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Avatar, PageHeader, Toolbar } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import type { CustomerListRow, CustomerListSummary } from '@/server/crm/customers/repository';
import { catalogLabel } from '@/i18n/format';
import { useFormatters, useMessages } from '@/i18n/I18nProvider';

interface CustomersListProps {
  customers: CustomerListRow[];
  summary: CustomerListSummary;
  page: number;
  limit: number;
  search: string;
  owners: { id: string; displayName: string; role: string }[];
  canAssignOwner: boolean;
}

export function CustomersList({
  customers,
  summary,
  page,
  limit,
  search,
  owners,
  canAssignOwner,
}: CustomersListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const m = useMessages();
  const format = useFormatters();
  const t = m.customers.list;

  const [searchInput, setSearchInput] = useState(search);
  const total = summary.customers;
  const totalPages = Math.ceil(total / limit);
  const selectedOwner = searchParams.get('owner') ?? '';

  const pushParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    router.push(`/crm/customers?${params.toString()}`);
  };

  const handleSearchSubmit = () => {
    pushParams((params) => {
      const trimmed = searchInput.trim();
      if (trimmed) params.set('q', trimmed);
      else params.delete('q');
      params.delete('page');
    });
  };

  const handleSearchClear = () => {
    setSearchInput('');
    pushParams((params) => {
      params.delete('q');
      params.delete('page');
    });
  };

  const handleOwnerChange = (ownerId: string) => {
    pushParams((params) => {
      if (!ownerId) params.delete('owner');
      else params.set('owner', ownerId);
      params.delete('page');
    });
  };

  const handlePageChange = (next: number) => {
    pushParams((params) => {
      params.set('page', String(next));
    });
  };

  const knownValues = summary.purchases - summary.purchasesWithoutValue;
  const cards = [
    { key: 'customers', label: t.customersCard, value: String(summary.customers), hint: null },
    { key: 'purchases', label: t.purchasesCard, value: String(summary.purchases), hint: null },
    {
      key: 'value',
      label: t.valueCard,
      value: format.currency(summary.totalValue),
      hint: summary.purchases > 0 ? t.valueCoverage(knownValues, summary.purchases) : null,
    },
  ];

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.heading} description={t.description} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.key}
            className="rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#e4e9eb]"
          >
            <p className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#7e8992]">{card.label}</p>
            <p className="mt-2.5 text-[22px] font-semibold tracking-[-0.045em] text-[#17242c]">{card.value}</p>
            {card.hint ? <p className="mt-0.5 text-[10px] text-[#89949c]">{card.hint}</p> : null}
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,.04)] ring-1 ring-[#dfe5e8]">
        <Toolbar
          placeholder={t.searchPlaceholder}
          searchValue={searchInput}
          onSearchChange={setSearchInput}
          onSearchSubmit={handleSearchSubmit}
        >
          {search ? (
            <button
              type="button"
              onClick={handleSearchClear}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dce2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
            >
              <CrmIcon name="x" className="h-3.5 w-3.5" />
              {t.clearSearch}
            </button>
          ) : null}
          {canAssignOwner ? (
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-[#7b8790]">{t.owner}</span>
              <select
                value={selectedOwner}
                onChange={(event) => handleOwnerChange(event.target.value)}
                className="h-9 rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] font-medium text-[#3c4a54] outline-none focus:border-[#18b6a4]"
              >
                <option value="">{t.everyone}</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </Toolbar>

        <div className="overflow-x-auto border-x border-b border-[#dfe5e8] bg-white">
          <table className="w-full min-w-[920px] text-start">
            <thead className="border-b border-[#e5eaec] bg-[#f8fafb] text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
              <tr>
                <th className="px-4 py-3 text-start">{t.customer}</th>
                <th className="px-3 py-3 text-start">{t.phone}</th>
                <th className="px-3 py-3 text-start">{t.bought}</th>
                <th className="px-3 py-3 text-start">{t.owner}</th>
                <th className="px-3 py-3 text-start">{t.lastPurchase}</th>
                <th className="px-3 py-3 text-center">{t.purchases}</th>
                <th className="px-3 py-3 text-center">{t.openDeals}</th>
                <th className="px-3 py-3 text-end">{t.value}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f1]">
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[#89949c]">
                    {search ? (
                      <span>
                        {t.noMatch(search)}
                        <button
                          type="button"
                          onClick={handleSearchClear}
                          className="ms-2 font-semibold text-[#118e82] hover:underline"
                        >
                          {t.clearSearch}
                        </button>
                      </span>
                    ) : (
                      t.none
                    )}
                  </td>
                </tr>
              ) : (
                customers.map((customer) => (
                  <tr key={customer.contactId} className="transition hover:bg-[#f9fbfb]">
                    <td className="px-4 py-3.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={customer.name} size="sm" />
                        <div className="min-w-0">
                          <Link
                            href={`/crm/customers/${customer.contactId}`}
                            className="block truncate text-[11px] font-semibold text-[#202e37] hover:text-[#0e897e]"
                          >
                            {customer.name}
                          </Link>
                          <p className="mt-0.5 truncate text-[9px] text-[#68757e]">
                            {customer.accountName ?? t.noAccount}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-3.5">
                      {customer.phone ? (
                        <a href={`tel:${customer.phone}`} className="whitespace-nowrap text-[10px] font-medium text-[#188c81] hover:underline">
                          <bdi dir="ltr">{customer.phone}</bdi>
                        </a>
                      ) : (
                        <span className="text-[10px] text-[#a4aeb5]">—</span>
                      )}
                    </td>

                    <td className="px-3 py-3.5">
                      {customer.categories.length > 0 ? (
                        <div className="flex max-w-[220px] flex-wrap gap-1">
                          {customer.categories.map((category) => (
                            <span
                              key={category.code}
                              className="whitespace-nowrap rounded-full bg-[#eef6f5] px-2 py-0.5 text-[9px] font-semibold text-[#2c6f68]"
                            >
                              {catalogLabel(m.catalog.productCategories, category.code, category.name)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[10px] text-[#a4aeb5]">{t.noCategory}</span>
                      )}
                    </td>

                    <td className="px-3 py-3.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar name={customer.ownerName} size="sm" />
                        <span className="truncate text-[10px] text-[#53616a]">{customer.ownerName}</span>
                      </div>
                    </td>

                    <td className="px-3 py-3.5">
                      <p className="whitespace-nowrap text-[10px] font-semibold text-[#4e5c66]">
                        {format.date(customer.lastPurchaseAt)}
                      </p>
                    </td>

                    <td className="px-3 py-3.5 text-center">
                      <span className="text-[11px] font-semibold text-[#2c3a43]">{customer.purchases}</span>
                    </td>

                    <td className="px-3 py-3.5 text-center">
                      {customer.openDeals > 0 ? (
                        <span className="inline-flex min-w-6 justify-center rounded-full bg-[#e8f4ff] px-2 py-0.5 text-[10px] font-bold text-[#287bb5]">
                          {customer.openDeals}
                        </span>
                      ) : (
                        <span className="text-[10px] text-[#a4aeb5]">—</span>
                      )}
                    </td>

                    <td className="px-3 py-3.5 text-end">
                      {customer.totalValue === null ? (
                        <span className="text-[10px] text-[#a4aeb5]">{t.noValue}</span>
                      ) : (
                        <div>
                          <p className="whitespace-nowrap text-[11px] font-semibold text-[#2c3a43]">
                            {format.currency(customer.totalValue)}
                          </p>
                          {customer.purchasesWithoutValue > 0 ? (
                            <p className="mt-0.5 whitespace-nowrap text-[9px] text-[#929da4]">
                              {t.withoutValue(customer.purchasesWithoutValue)}
                            </p>
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="flex items-center justify-between border-t border-[#edf0f1] px-4 py-3">
            <p className="text-[10px] text-[#89949c]">
              {total === 0
                ? t.empty
                : t.showing(Math.min((page - 1) * limit + 1, total), Math.min(page * limit, total), total)}
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => handlePageChange(page - 1)}
                className="h-7 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] text-[#9aa3aa] transition hover:bg-[#f7f9fa] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.previous}
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => handlePageChange(page + 1)}
                className="h-7 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] font-semibold text-[#53616a] transition hover:bg-[#f7f9fa] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.next}
              </button>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-3 text-[10px] text-[#98a2a9]">{t.note}</p>
    </>
  );
}
