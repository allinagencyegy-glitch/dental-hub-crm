'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Avatar, PageHeader, Toolbar } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import type { QuotationStatus } from '@/server/crm/quotations/status';
import type {
  QuotationIndexCounts,
  QuotationIndexFilter,
  QuotationIndexRow,
} from '@/server/crm/quotations/repository';
import { useFormatters, useMessages } from '@/i18n/I18nProvider';

const STATUS_FILTERS: QuotationIndexFilter[] = ['ALL', 'DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'];

const STATUS_CHIP: Record<QuotationStatus, string> = {
  DRAFT: 'bg-[#edf0f2] text-[#63707a]',
  SENT: 'bg-[#e8f4ff] text-[#287bb5]',
  ACCEPTED: 'bg-[#e8f8f1] text-[#14815f]',
  REJECTED: 'bg-[#ffe9ea] text-[#c43f47]',
  EXPIRED: 'bg-[#f1edff] text-[#6d52be]',
};

interface QuotationsListProps {
  quotations: QuotationIndexRow[];
  total: number;
  counts: QuotationIndexCounts;
  page: number;
  limit: number;
  status: QuotationIndexFilter;
  search: string;
  owners: { id: string; displayName: string; role: string }[];
  canAssignOwner: boolean;
}

export function QuotationsList({
  quotations,
  total,
  counts,
  page,
  limit,
  status,
  search,
  owners,
  canAssignOwner,
}: QuotationsListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const m = useMessages();
  const format = useFormatters();
  const t = m.quotations.list;

  const [searchInput, setSearchInput] = useState(search);
  const totalPages = Math.ceil(total / limit);
  const selectedOwner = searchParams.get('owner') ?? '';

  const pushParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    router.push(`/crm/quotations?${params.toString()}`);
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

  const handleStatusChange = (next: QuotationIndexFilter) => {
    pushParams((params) => {
      if (next === 'ALL') params.delete('status');
      else params.set('status', next);
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

  const closedWithout = {
    count: counts.REJECTED.count + counts.EXPIRED.count,
    value: counts.REJECTED.value + counts.EXPIRED.value,
  };
  const cards = [
    { key: 'sent', label: t.awaitingReply, tally: counts.SENT },
    { key: 'draft', label: t.drafts, tally: counts.DRAFT },
    { key: 'accepted', label: t.accepted, tally: counts.ACCEPTED },
    { key: 'closed', label: t.closedWithout, tally: closedWithout },
  ];

  return (
    <>
      <PageHeader eyebrow={m.opportunities.eyebrow} title={t.heading} description={t.description} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.key}
            className="rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#e4e9eb]"
          >
            <p className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#7e8992]">{card.label}</p>
            <p className="mt-2.5 text-[22px] font-semibold tracking-[-0.045em] text-[#17242c]">
              {format.currency(card.tally.value)}
            </p>
            <p className="mt-0.5 text-[10px] text-[#89949c]">{t.quotationCount(card.tally.count)}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1 border-b border-[#dce3e6]">
        {STATUS_FILTERS.map((filter) => {
          const isActive = status === filter;
          return (
            <button
              key={filter}
              type="button"
              onClick={() => handleStatusChange(filter)}
              className={`relative px-4 pb-3 text-[11px] font-semibold transition ${
                isActive ? 'text-[#128d81]' : 'text-[#7b8790] hover:text-[#33414a]'
              }`}
            >
              {filter === 'ALL' ? t.all : m.quotationStatus[filter]}
              <span className="ms-1.5 text-[10px] font-medium text-[#9aa4ab]">{counts[filter].count}</span>
              {isActive ? <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#18b6a4]" /> : null}
            </button>
          );
        })}
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
          <table className="w-full min-w-[860px] text-start">
            <thead className="border-b border-[#e5eaec] bg-[#f8fafb] text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
              <tr>
                <th className="px-4 py-3 text-start">{t.number}</th>
                <th className="px-3 py-3 text-start">{t.customer}</th>
                <th className="px-3 py-3 text-start">{t.status}</th>
                <th className="px-3 py-3 text-start">{t.owner}</th>
                <th className="px-3 py-3 text-start">{t.validUntil}</th>
                <th className="px-3 py-3 text-start">{t.lastChange}</th>
                <th className="px-3 py-3 text-end">{t.total}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f1]">
              {quotations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[#89949c]">
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
                    ) : counts.ALL.count === 0 ? (
                      t.none
                    ) : (
                      t.noneInTab
                    )}
                  </td>
                </tr>
              ) : (
                quotations.map((quotation) => (
                  <tr key={quotation.id} className="transition hover:bg-[#f9fbfb]">
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/crm/quotations/${quotation.id}`}
                        className="text-[11px] font-bold text-[#188c81] hover:underline"
                      >
                        <bdi dir="ltr">{quotation.quoteNumber}</bdi>
                      </Link>
                      <p className="mt-1 text-[9px] text-[#929da4]">{t.version(quotation.version)}</p>
                    </td>

                    <td className="px-3 py-3.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={quotation.contactName} size="sm" />
                        <div className="min-w-0">
                          <Link
                            href={`/crm/opportunities/${quotation.opportunityId}`}
                            className="block truncate text-[11px] font-semibold text-[#202e37] hover:text-[#0e897e]"
                          >
                            {quotation.contactName}
                          </Link>
                          <p className="mt-0.5 truncate text-[9px] text-[#68757e]">
                            {quotation.accountName ?? t.noAccount}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-3.5">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.06em] ${
                          STATUS_CHIP[quotation.status]
                        }`}
                      >
                        {m.quotationStatus[quotation.status]}
                      </span>
                    </td>

                    <td className="px-3 py-3.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar name={quotation.ownerName} size="sm" />
                        <span className="truncate text-[10px] text-[#53616a]">{quotation.ownerName}</span>
                      </div>
                    </td>

                    <td className="px-3 py-3.5">
                      {quotation.validUntil ? (
                        <div>
                          <p
                            className={`whitespace-nowrap text-[10px] font-semibold ${
                              quotation.pastValidity ? 'text-[#bd454b]' : 'text-[#4e5c66]'
                            }`}
                          >
                            {format.date(quotation.validUntil)}
                          </p>
                          {quotation.pastValidity ? (
                            <p className="mt-0.5 inline-flex items-center gap-1 whitespace-nowrap text-[9px] font-semibold text-[#bd454b]">
                              <CrmIcon name="alert" className="h-3 w-3" />
                              {t.pastValidity}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-[10px] text-[#a4aeb5]">{t.noExpiry}</span>
                      )}
                    </td>

                    <td className="px-3 py-3.5">
                      <p className="whitespace-nowrap text-[10px] text-[#4e5c66]">{format.date(quotation.updatedAt)}</p>
                    </td>

                    <td className="px-3 py-3.5 text-end">
                      <span className="whitespace-nowrap text-[11px] font-semibold text-[#2c3a43]">
                        {format.currency(quotation.totalAmount)}
                      </span>
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

      <p className="mt-3 text-[10px] text-[#98a2a9]">{t.revisionsNote}</p>
    </>
  );
}
