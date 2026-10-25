'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Avatar, Badge, PageHeader, Toolbar } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import type { Lead, LeadStatus } from '@/server/crm/leads/repository';
import type { BadgeValue } from '@/components/crm/Ui';
import { useFormatters, useMessages } from '@/i18n/I18nProvider';
import { catalogLabel } from '@/i18n/format';

interface LeadsListProps {
  leads: Lead[];
  total: number;
  page: number;
  limit: number;
  status?: LeadStatus;
  archiveFilter?: 'active' | 'archived' | 'all';
  search?: string;
}

const STATUS_FILTERS: (LeadStatus | 'ALL')[] = ['ALL', 'NEW', 'CONTACTED', 'DISQUALIFIED'];

const ARCHIVE_FILTERS: ('active' | 'archived' | 'all')[] = ['active', 'archived', 'all'];

export function LeadsList({ leads, total, page, limit, status, archiveFilter = 'active', search = '' }: LeadsListProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const m = useMessages();
  const format = useFormatters();
  const t = m.leads.list;
  const statusLabel = (value: LeadStatus | 'ALL') => (value === 'ALL' ? t.all : m.leadStatus[value]);
  const archiveLabel = { active: t.active, archived: t.archived, all: t.all };

  const [searchInput, setSearchInput] = useState(search);

  const handleSearchSubmit = () => {
    const params = new URLSearchParams(searchParams.toString());
    const trimmed = searchInput.trim();
    if (trimmed) params.set('q', trimmed);
    else params.delete('q');
    params.delete('page');
    router.push(`/crm/leads?${params.toString()}`);
  };

  const handleSearchClear = () => {
    setSearchInput('');
    const params = new URLSearchParams(searchParams.toString());
    params.delete('q');
    params.delete('page');
    router.push(`/crm/leads?${params.toString()}`);
  };

  const handleStatusChange = (newStatus: LeadStatus | 'ALL') => {
    const params = new URLSearchParams(searchParams.toString());
    if (newStatus === 'ALL') {
      params.delete('status');
    } else {
      params.set('status', newStatus);
    }
    params.delete('page');
    router.push(`/crm/leads?${params.toString()}`);
  };

  const handleArchiveChange = (newArchive: 'active' | 'archived' | 'all') => {
    const params = new URLSearchParams(searchParams.toString());
    if (newArchive === 'active') {
      params.delete('archive');
    } else {
      params.set('archive', newArchive);
    }
    params.delete('page');
    router.push(`/crm/leads?${params.toString()}`);
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(newPage));
    router.push(`/crm/leads?${params.toString()}`);
  };

  const totalPages = Math.ceil(total / limit);

  const getStatusCount = (filterStatus: LeadStatus | 'ALL') => {
    if (filterStatus === 'ALL') return total;
    return leads.filter((lead) => lead.status === filterStatus).length;
  };

  const getArchiveCount = (filterArchive: 'active' | 'archived' | 'all') => {
    if (filterArchive === 'all') return total;
    return leads.filter((lead) => (filterArchive === 'active') === (lead.archivedAt === null)).length;
  };

  return (
    <>
      <PageHeader
        eyebrow={m.leads.eyebrow}
        title={t.heading}
        description={t.description}
        actionLabel={t.capture}
        actionIcon="plus"
        actionHref="/crm/leads/capture"
      />
      <div className="flex items-center gap-1 border-b border-[#dce3e6]">
        {ARCHIVE_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => handleArchiveChange(filter)}
            className={`relative px-4 pb-3 text-[11px] font-semibold transition ${
              archiveFilter === filter
                ? 'text-[#128d81]'
                : 'text-[#7b8790] hover:text-[#33414a]'
            }`}
          >
            {archiveLabel[filter]}
            <span
              className={`ms-2 rounded-full px-1.5 py-0.5 text-[9px] ${
                archiveFilter === filter
                  ? 'bg-[#def4f0] text-[#0c8176]'
                  : 'bg-[#e9edef] text-[#78858e]'
              }`}
            >
              {getArchiveCount(filter)}
            </span>
            {archiveFilter === filter && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#18b6a4]" />
            )}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 border-b border-[#dce3e6] mt-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => handleStatusChange(filter)}
            className={`relative px-4 pb-3 text-[11px] font-semibold transition ${
              status === filter || (filter === 'ALL' && !status)
                ? 'text-[#128d81]'
                : 'text-[#7b8790] hover:text-[#33414a]'
            }`}
          >
            {statusLabel(filter)}
            <span
              className={`ms-2 rounded-full px-1.5 py-0.5 text-[9px] ${
                status === filter || (filter === 'ALL' && !status)
                  ? 'bg-[#def4f0] text-[#0c8176]'
                  : 'bg-[#e9edef] text-[#78858e]'
              }`}
            >
              {getStatusCount(filter)}
            </span>
            {(status === filter || (filter === 'ALL' && !status)) && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#18b6a4]" />
            )}
          </button>
        ))}
      </div>
      <div className="mt-4 overflow-hidden rounded-xl shadow-[0_1px_2px_rgba(20,35,45,.04)] ring-1 ring-[#dfe5e8] bg-white">
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
          <Link
            href="/crm/leads/capture"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dce2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:border-[#18b6a4] hover:bg-[#f7f9fa]"
          >
            <CrmIcon name="plus" className="h-3.5 w-3.5" />
            {t.capture}
          </Link>
        </Toolbar>
        <div className="overflow-hidden border-x border-b border-[#dfe5e8] bg-white">
          <table className="w-full table-fixed text-start">
            <colgroup>
              <col className="w-[12%]" />
              <col className="w-[22%]" />
              <col className="w-[13%]" />
              <col className="w-[18%]" />
              <col className="w-[13%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead className="border-b border-[#e5eaec] bg-[#f8fafb] text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
              <tr>
                <th className="px-4 py-3">{t.reference}</th>
                <th className="px-3 py-3">{t.contactAccount}</th>
                <th className="px-3 py-3">{m.leads.source}</th>
                <th className="px-3 py-3">{m.leads.productInterest}</th>
                <th className="px-3 py-3">{m.leads.owner}</th>
                <th className="px-3 py-3">{t.status}</th>
                <th className="px-2 py-3 text-center">{t.received}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f1]">
              {leads.length === 0 ? (
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
                    ) : (
                      t.none
                    )}
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="transition hover:bg-[#f9fbfb]">
                    <td className="px-4 py-3.5">
                      <Link href={`/crm/leads/${lead.id}`} className="text-[10px] font-bold text-[#188c81] hover:underline">
                        {lead.id.slice(0, 8)}
                      </Link>
                      <p className="mt-1 text-[9px] leading-3 text-[#929da4]">{format.date(lead.receivedAt)}</p>
                      <p className="text-[9px] leading-3 text-[#929da4]">{format.time(lead.receivedAt)}</p>
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={lead.contactName || lead.contactId} size="sm" />
                        <div className="min-w-0">
                          <Link href={`/crm/leads/${lead.id}`} className="block truncate text-[11px] font-semibold text-[#202e37] hover:text-[#0e897e]">
                            {lead.contactName || t.contactFallback(lead.contactId.slice(0, 8))}
                          </Link>
                          {lead.accountName && (
                            <p className="mt-0.5 truncate text-[9px] text-[#68757e]">{t.accountLine(lead.accountName)}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="text-[10px] text-[#4e5c66]">{catalogLabel(m.catalog.sources, lead.sourceCode, lead.sourceName)}</span>
                    </td>
                    <td className="px-3 py-3.5 text-[10px] font-medium leading-4 text-[#394750]">
                      {lead.productCategoryName
                        ? catalogLabel(m.catalog.productCategories, lead.productCategoryCode, lead.productCategoryName)
                        : lead.productCategoryId
                          ? lead.productCategoryId.slice(0, 8)
                          : '—'}
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar name={lead.ownerName || lead.ownerUserId} size="sm" />
                        <span className="truncate text-[10px] text-[#53616a]">{lead.ownerName || lead.ownerUserId.slice(0, 8)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <Badge value={lead.status as BadgeValue} label={m.leadStatus[lead.status]} dot />
                    </td>
                    <td className="px-2 py-3.5 text-center text-[9px] text-[#89949c]">
                      {format.dateTime(lead.receivedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-[#edf0f1] px-4 py-3">
            <p className="text-[10px] text-[#89949c]">
              {t.showing(Math.min((page - 1) * limit + 1, total), Math.min(page * limit, total), total)}
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => handlePageChange(page - 1)}
                className="h-7 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] text-[#9aa3aa] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f7f9fa]"
              >
                {t.previous}
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => handlePageChange(page + 1)}
                className="h-7 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] font-semibold text-[#53616a] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f7f9fa]"
              >
                {t.next}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}