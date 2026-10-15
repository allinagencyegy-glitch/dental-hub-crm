'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Avatar, PageHeader, Toolbar } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import {
  OPPORTUNITY_STAGES,
  STAGE_LABELS,
  type OpportunityStage,
} from '@/server/crm/opportunities/stage';
import { ACTION_TYPE_LABELS, type FollowUpActionType } from '@/server/crm/opportunities/followup-actions';
import type { OpportunityListRow, OpportunityStageFilter } from '@/server/crm/opportunities/repository';

const STAGE_FILTERS: { value: OpportunityStageFilter; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ALL', label: 'All' },
  { value: 'QUALIFIED', label: 'Qualified' },
  { value: 'NEEDS_ANALYSIS', label: 'Needs analysis' },
  { value: 'PROPOSAL', label: 'Proposal' },
  { value: 'NEGOTIATION', label: 'Negotiation' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'WON', label: 'Won' },
  { value: 'LOST', label: 'Lost' },
];

/** Pipeline stages in pipeline order, for the tally strip. */
const PIPELINE_ORDER: OpportunityStage[] = [
  'QUALIFIED',
  'NEEDS_ANALYSIS',
  'PROPOSAL',
  'NEGOTIATION',
];

const STAGE_CHIP: Record<OpportunityStage, string> = {
  QUALIFIED: 'bg-[#f1edff] text-[#6d52be]',
  NEEDS_ANALYSIS: 'bg-[#e9f7ff] text-[#137aa9]',
  PROPOSAL: 'bg-[#e8f4ff] text-[#287bb5]',
  NEGOTIATION: 'bg-[#fff0e5] text-[#b45b1b]',
  ON_HOLD: 'bg-[#edf0f2] text-[#63707a]',
  WON: 'bg-[#e8f8f1] text-[#14815f]',
  LOST: 'bg-[#ffe9ea] text-[#c43f47]',
};

interface OpportunitiesListProps {
  opportunities: OpportunityListRow[];
  total: number;
  page: number;
  limit: number;
  stage: OpportunityStageFilter;
  counts: Record<string, number>;
  owners: { id: string; displayName: string; role: string }[];
  canAssignOwner: boolean;
  currentUserId: string;
  search?: string;
}

export function OpportunitiesList({
  opportunities,
  total,
  page,
  limit,
  stage,
  counts,
  owners,
  canAssignOwner,
  search = '',
}: OpportunitiesListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [searchInput, setSearchInput] = useState(search);

  const totalPages = Math.ceil(total / limit);
  const selectedOwner = searchParams.get('owner') ?? '';

  const pushParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    router.push(`/crm/opportunities?${params.toString()}`);
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

  const handleStageChange = (next: OpportunityStageFilter) => {
    pushParams((params) => {
      if (next === 'OPEN') params.delete('stage');
      else params.set('stage', next);
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

  const openTotal = PIPELINE_ORDER.reduce((sum, stageKey) => sum + (counts[stageKey] ?? 0), 0);

  return (
    <>
      <PageHeader
        eyebrow="Commercial pipeline"
        title="Opportunities"
        description="Every qualified deal, its owner, its stage and the next action that is due."
        actionLabel="Capture lead"
        actionIcon="plus"
        actionHref="/crm/leads/capture"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PIPELINE_ORDER.map((stageKey) => (
          <div
            key={stageKey}
            className="rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#e4e9eb]"
          >
            <p className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#7e8992]">
              {STAGE_LABELS[stageKey]}
            </p>
            <p className="mt-2.5 text-[25px] font-semibold tracking-[-0.045em] text-[#17242c]">
              {counts[stageKey] ?? 0}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1 border-b border-[#dce3e6]">
        {STAGE_FILTERS.map((filter) => {
          const isActive = stage === filter.value;
          return (
            <button
              key={filter.value}
              type="button"
              onClick={() => handleStageChange(filter.value)}
              className={`relative px-4 pb-3 text-[11px] font-semibold transition ${
                isActive ? 'text-[#128d81]' : 'text-[#7b8790] hover:text-[#33414a]'
              }`}
            >
              {filter.label}
              {isActive ? <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#18b6a4]" /> : null}
            </button>
          );
        })}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,.04)] ring-1 ring-[#dfe5e8]">
        <Toolbar
          placeholder="Search by contact, account, owner or reference..."
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
              Clear search
            </button>
          ) : null}
          {canAssignOwner ? (
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-[#7b8790]">Owner</span>
              <select
                value={selectedOwner}
                onChange={(event) => handleOwnerChange(event.target.value)}
                className="h-9 rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] font-medium text-[#3c4a54] outline-none focus:border-[#18b6a4]"
              >
                <option value="">Everyone</option>
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
          <table className="w-full min-w-[920px] text-left">
            <thead className="border-b border-[#e5eaec] bg-[#f8fafb] text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
              <tr>
                <th className="px-4 py-3">Reference</th>
                <th className="px-3 py-3">Contact / Account</th>
                <th className="px-3 py-3">Stage</th>
                <th className="px-3 py-3">Owner</th>
                <th className="px-3 py-3">Next action</th>
                <th className="px-3 py-3">Due</th>
                <th className="px-3 py-3 text-right">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f1]">
              {opportunities.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[#89949c]">
                    {search ? (
                      <span>
                        No opportunities match “{search}”.
                        <button
                          type="button"
                          onClick={handleSearchClear}
                          className="ml-2 font-semibold text-[#118e82] hover:underline"
                        >
                          Clear search
                        </button>
                      </span>
                    ) : stage === 'OPEN' && openTotal === 0 ? (
                      'No open opportunities. Qualify a lead to start commercial work.'
                    ) : (
                      'No opportunities found.'
                    )}
                  </td>
                </tr>
              ) : (
                opportunities.map((opportunity) => (
                  <tr
                    key={opportunity.id}
                    className={`transition hover:bg-[#f9fbfb] ${
                      opportunity.nextAction?.isOverdue ? 'bg-[#fffafb]' : ''
                    }`}
                  >
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/crm/opportunities/${opportunity.id}`}
                        className="text-[10px] font-bold text-[#188c81] hover:underline"
                      >
                        {opportunity.id.slice(0, 8)}
                      </Link>
                      <p className="mt-1 text-[9px] text-[#929da4]">
                        Updated {opportunity.updatedAt.toLocaleDateString()}
                      </p>
                    </td>

                    <td className="px-3 py-3.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={opportunity.contactName} size="sm" />
                        <div className="min-w-0">
                          <Link
                            href={`/crm/opportunities/${opportunity.id}`}
                            className="block truncate text-[11px] font-semibold text-[#202e37] hover:text-[#0e897e]"
                          >
                            {opportunity.contactName}
                          </Link>
                          <p className="mt-0.5 truncate text-[9px] text-[#68757e]">
                            {opportunity.accountName ?? 'No account linked'}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[9px] font-bold tracking-[0.06em] ${
                          STAGE_CHIP[opportunity.stage]
                        }`}
                      >
                        {STAGE_LABELS[opportunity.stage].toUpperCase()}
                      </span>
                    </td>

                    <td className="px-3 py-3.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar name={opportunity.ownerName} size="sm" />
                        <span className="truncate text-[10px] text-[#53616a]">
                          {opportunity.ownerName}
                        </span>
                      </div>
                    </td>

                    <td className="px-3 py-3.5">
                      {opportunity.nextAction ? (
                        <div className="flex items-center gap-1.5">
                          <CrmIcon
                            name={opportunity.nextAction.isOverdue ? 'alert' : 'clock'}
                            className={`h-3.5 w-3.5 shrink-0 ${
                              opportunity.nextAction.isOverdue ? 'text-[#c43f47]' : 'text-[#6a7c85]'
                            }`}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-[10px] font-semibold text-[#35434c]">
                              {ACTION_TYPE_LABELS[
                                opportunity.nextAction.actionType as FollowUpActionType
                              ] ?? opportunity.nextAction.actionType}
                            </p>
                            {opportunity.nextAction.note ? (
                              <p className="mt-0.5 truncate text-[9px] text-[#8a959d]">
                                {opportunity.nextAction.note}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#a07a4a]">
                          <CrmIcon name="alert" className="h-3.5 w-3.5" />
                          No next action
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-3.5">
                      {opportunity.nextAction ? (
                        <div>
                          <p
                            className={`whitespace-nowrap text-[10px] font-semibold ${
                              opportunity.nextAction.isOverdue ? 'text-[#bd454b]' : 'text-[#4e5c66]'
                            }`}
                          >
                            {opportunity.nextAction.dueAt.toLocaleDateString()}
                          </p>
                          <p className="mt-0.5 whitespace-nowrap text-[9px] text-[#929da4]">
                            {opportunity.nextAction.dueAt.toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                      ) : (
                        <span className="text-[10px] text-[#a4aeb5]">—</span>
                      )}
                    </td>

                    <td className="px-3 py-3.5 text-right">
                      <span className="whitespace-nowrap text-[11px] font-semibold text-[#2c3a43]">
                        {opportunity.estimatedValue === null
                          ? '—'
                          : opportunity.estimatedValue.toLocaleString('en-EG', {
                              style: 'currency',
                              currency: 'EGP',
                              maximumFractionDigits: 0,
                            })}
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
                ? 'No opportunities'
                : `Showing ${Math.min((page - 1) * limit + 1, total)}–${Math.min(page * limit, total)} of ${total}`}
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => handlePageChange(page - 1)}
                className="h-7 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] text-[#9aa3aa] transition hover:bg-[#f7f9fa] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => handlePageChange(page + 1)}
                className="h-7 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] font-semibold text-[#53616a] transition hover:bg-[#f7f9fa] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-3 text-[10px] text-[#98a2a9]">
        Closed deals keep their full follow-up history. {OPPORTUNITY_STAGES.length} stages are
        configured; WON and LOST are terminal.
      </p>
    </>
  );
}
