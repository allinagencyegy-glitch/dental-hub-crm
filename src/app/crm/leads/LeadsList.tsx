'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Avatar, Badge, PageHeader, Toolbar } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import type { Lead, LeadStatus } from '@/server/crm/leads/repository';
import type { BadgeValue } from '@/components/crm/Ui';

interface LeadsListProps {
  leads: Lead[];
  total: number;
  page: number;
  limit: number;
  status?: LeadStatus;
}

const STATUS_FILTERS: { value: LeadStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'NEW', label: 'New' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'DISQUALIFIED', label: 'Disqualified' },
];

export function LeadsList({ leads, total, page, limit, status }: LeadsListProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

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

  return (
    <>
      <PageHeader
        eyebrow="Lead management"
        title="Lead inbox"
        description="Qualify incoming interest and keep every first response on track."
        actionLabel="Capture lead"
        actionIcon="plus"
      />
      <div className="flex items-center gap-1 border-b border-slate-700">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => handleStatusChange(filter.value)}
            className={`relative px-4 pb-3 text-[11px] font-semibold transition ${
              status === filter.value || (filter.value === 'ALL' && !status)
                ? 'text-teal-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {filter.label}
            <span
              className={`ml-2 rounded-full px-1.5 py-0.5 text-[9px] ${
                status === filter.value || (filter.value === 'ALL' && !status)
                  ? 'bg-teal-500/20 text-teal-300'
                  : 'bg-slate-800 text-slate-500'
              }`}
            >
              {getStatusCount(filter.value)}
            </span>
            {(status === filter.value || (filter.value === 'ALL' && !status)) && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-teal-400" />
            )}
          </button>
        ))}
      </div>
      <div className="mt-4 overflow-hidden rounded-xl shadow-[0_1px_2px_rgba(20,35,45,.04)] bg-slate-900/40 border border-slate-800">
        <Toolbar placeholder="Search by contact, account, source or reference...">
          <Link
            href="/crm/leads/capture"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 text-[11px] font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-700"
          >
            <CrmIcon name="plus" className="h-3.5 w-3.5" />
            Capture lead
          </Link>
        </Toolbar>
        <div className="overflow-hidden border-x border-b border-slate-800 bg-slate-950">
          <table className="w-full table-fixed text-left">
            <colgroup>
              <col className="w-[12%]" />
              <col className="w-[22%]" />
              <col className="w-[13%]" />
              <col className="w-[18%]" />
              <col className="w-[13%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead className="border-b border-slate-800 bg-slate-900/50 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Reference</th>
                <th className="px-3 py-3">Contact / Account</th>
                <th className="px-3 py-3">Source</th>
                <th className="px-3 py-3">Product interest</th>
                <th className="px-3 py-3">Owner</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-2 py-3 text-center">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    No leads found.
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="transition hover:bg-slate-900/50">
                    <td className="px-4 py-3.5">
                      <Link href={`/crm/leads/${lead.id}`} className="text-[10px] font-bold text-teal-400 hover:underline">
                        {lead.id.slice(0, 8)}
                      </Link>
                      <p className="mt-1 text-[9px] leading-3 text-slate-500">{lead.receivedAt.toLocaleDateString()}</p>
                      <p className="text-[9px] leading-3 text-slate-500">{lead.receivedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={lead.contactId} size="sm" />
                        <div className="min-w-0">
                          <Link href={`/crm/leads/${lead.id}`} className="block truncate text-[11px] font-semibold text-slate-100 hover:text-teal-400">
                            Contact: {lead.contactId.slice(0, 8)}
                          </Link>
                          {lead.accountId && (
                            <p className="mt-0.5 truncate text-[9px] text-slate-400">Account: {lead.accountId.slice(0, 8)}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="text-[10px] text-slate-300">{lead.sourceName}</span>
                    </td>
                    <td className="px-3 py-3.5 text-[10px] font-medium leading-4 text-slate-300">
                      {lead.productCategoryId ? lead.productCategoryId.slice(0, 8) : '—'}
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar name={lead.ownerUserId} size="sm" />
                        <span className="truncate text-[10px] text-slate-400">{lead.ownerUserId.slice(0, 8)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <Badge value={lead.status as BadgeValue} dot />
                    </td>
                    <td className="px-2 py-3.5 text-center text-[9px] text-slate-500">
                      {lead.receivedAt.toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3">
            <p className="text-[10px] text-slate-500">
              Showing {Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} of {total} leads
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => handlePageChange(page - 1)}
                className="h-7 rounded-md border border-slate-700 px-2.5 text-[9px] text-slate-400 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => handlePageChange(page + 1)}
                className="h-7 rounded-md border border-slate-700 px-2.5 text-[9px] font-semibold text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}