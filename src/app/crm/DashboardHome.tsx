'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CrmIcon, type CrmIconName } from '@/components/crm/CrmIcon';
import {
  getDashboardAction,
} from '@/server/crm/dashboard/actions';
import {
  DASHBOARD_RANGE_LABELS,
  type DashboardRange,
} from '@/server/crm/dashboard/dates';
import type { DashboardPayload } from '@/server/crm/dashboard/service';
import { STAGE_LABELS, OPPORTUNITY_STAGES } from '@/server/crm/opportunities/stage';

type Role = 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP';

function formatEgp(value: number): string {
  return value.toLocaleString('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 0,
  });
}

function formatCount(value: number): string {
  return value.toLocaleString('en-EG');
}

const RANGE_OPTIONS: DashboardRange[] = ['last7', 'last30', 'thisMonth', 'custom'];

const FUNNEL_LABELS: Record<string, string> = {
  leads: 'Leads received',
  qualified: 'Qualified',
  won: 'Won',
};

const QUOTATION_FUNNEL_LABELS: Record<string, string> = {
  quoted: 'Quotation sent',
  accepted: 'Quotation accepted',
};

const STATUS_LABELS: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  DISQUALIFIED: 'Disqualified',
};

interface DashboardHomeProps {
  initial: DashboardPayload;
  ownerOptions: { id: string; displayName: string }[];
  sourceOptions: { id: string; name: string }[];
  userRole: Role;
  initialRange: DashboardRange;
  initialOwner: string;
  initialSource: string;
}

export function DashboardHome({
  initial,
  ownerOptions,
  sourceOptions,
  userRole,
  initialRange,
  initialOwner,
  initialSource,
}: DashboardHomeProps) {
  const [payload, setPayload] = useState<DashboardPayload>(initial);
  const [range, setRange] = useState<DashboardRange>(initialRange);
  const [ownerUserId, setOwnerUserId] = useState(initialOwner);
  const [sourceId, setSourceId] = useState(initialSource);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canFilterOwner = userRole === 'ADMIN' || userRole === 'SALES_MANAGER';

  const reload = async (next: {
    range: DashboardRange;
    ownerUserId: string;
    sourceId: string;
    startDate?: string;
    endDate?: string;
  }) => {
    setBusy(true);
    setError(null);
    try {
      const result = await getDashboardAction({
        range: next.range,
        ownerUserId: next.ownerUserId || null,
        sourceId: next.sourceId || null,
        startDate: next.startDate || null,
        endDate: next.endDate || null,
      });
      setPayload(result);
    } catch {
      setError('The dashboard could not be refreshed.');
    } finally {
      setBusy(false);
    }
  };

  const selectRange = (next: DashboardRange) => {
    setRange(next);
    void reload({ range: next, ownerUserId, sourceId, startDate, endDate });
  };

  const { overview } = payload;
  const rangeLabel =
    range === 'custom' && startDate && endDate
      ? `${startDate} → ${endDate}`
      : DASHBOARD_RANGE_LABELS[range];

  const funnelTotal = payload.funnel[0]?.count ?? 0;
  const percent = (count: number) => (funnelTotal === 0 ? 0 : Math.round((count / funnelTotal) * 100));

  const totalStageValue = payload.stageDistribution.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#18a897]">
            Sales management
          </p>
          <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[#16232c]">
            {userRole === 'SALES_REP' ? 'My sales dashboard' : 'Sales dashboard'}
          </h1>
          <p className="mt-1 text-[12px] text-[#75828c]">
            Period metrics cover {rangeLabel}; everything marked “right now” is a live snapshot.
          </p>
        </div>
        <Link
          href="/crm/pipeline"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#132932] px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1b3944]"
        >
          <CrmIcon name="pipeline" className="h-4 w-4" />
          Open pipeline
        </Link>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-[#fff0f1] px-3.5 py-2.5 text-[11px] font-semibold text-[#b83c43] ring-1 ring-[#f0c5c8]">
          {error}
        </p>
      ) : null}

      {/* Filters */}
      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl bg-white p-3.5 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
        <div className="flex flex-wrap items-center gap-1">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              disabled={busy}
              onClick={() => selectRange(option)}
              className={`h-8 rounded-lg px-3 text-[10px] font-semibold transition disabled:opacity-60 ${
                range === option
                  ? 'bg-[#132932] text-white'
                  : 'text-[#53616b] hover:bg-[#f0f3f4]'
              }`}
            >
              {DASHBOARD_RANGE_LABELS[option]}
            </button>
          ))}
        </div>
        {range === 'custom' ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              aria-label="From date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="h-8 rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[10px] text-[#3c4a54] outline-none focus:border-[#18b6a4]"
            />
            <span className="text-[10px] text-[#8b969e]">→</span>
            <input
              type="date"
              aria-label="To date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="h-8 rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[10px] text-[#3c4a54] outline-none focus:border-[#18b6a4]"
            />
            <button
              type="button"
              disabled={busy || !startDate || !endDate}
              onClick={() => {
                if (startDate && endDate && startDate <= endDate) {
                  void reload({ range: 'custom', ownerUserId, sourceId, startDate, endDate });
                } else {
                  setError('Pick a from date on or before the to date.');
                }
              }}
              className="h-8 rounded-lg bg-[#132932] px-3 text-[10px] font-semibold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
            >
              Apply
            </button>
          </div>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canFilterOwner ? (
            <label className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-[#7b8790]">Owner</span>
              <select
                value={ownerUserId}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.value;
                  setOwnerUserId(next);
                  void reload({ range, ownerUserId: next, sourceId, startDate, endDate });
                }}
                className="h-8 rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[10px] font-medium text-[#3c4a54] outline-none focus:border-[#18b6a4]"
              >
                <option value="">Everyone</option>
                {ownerOptions.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-[#7b8790]">Source</span>
            <select
              value={sourceId}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value;
                setSourceId(next);
                void reload({ range, ownerUserId, sourceId: next, startDate, endDate });
              }}
              className="h-8 rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[10px] font-medium text-[#3c4a54] outline-none focus:border-[#18b6a4]"
            >
              <option value="">All sources</option>
              {sourceOptions.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* KPI cards */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label={`New leads · ${rangeLabel}`}
          value={formatCount(overview.newLeads)}
          helper="Lead received in the period"
          icon="leads"
          tone="teal"
        />
        <KpiCard
          label="Open opportunities"
          value={formatCount(overview.openOpportunities)}
          helper="Right now · open stages only"
          icon="opportunities"
          tone="blue"
        />
        <KpiCard
          label="Pipeline value"
          value={formatEgp(overview.pipelineValue)}
          helper="Right now · open stages only"
          icon="money"
          tone="violet"
        />
        <KpiCard
          label="Overdue follow-ups"
          value={formatCount(overview.overdueFollowUps)}
          helper="Right now · action needed"
          icon="alert"
          tone="red"
          warning={overview.overdueFollowUps > 0}
        />
        <KpiCard
          label={`Won deals · ${rangeLabel}`}
          value={formatCount(overview.wonCount)}
          helper={`Won value ${formatEgp(overview.wonValue)}`}
          icon="check"
          tone="teal"
        />
        <KpiCard
          label={`Lost deals · ${rangeLabel}`}
          value={formatCount(overview.lostCount)}
          helper={`Lost value ${formatEgp(overview.lostValue)}`}
          icon="x"
          tone="red"
        />
        <KpiCard
          label={`Quotations sent · ${rangeLabel}`}
          value={formatCount(overview.quotationsSent)}
          helper={`${formatCount(overview.quotationsAccepted)} accepted`}
          icon="quotation"
          tone="blue"
        />
        <KpiCard
          label="Due today"
          value={formatCount(overview.dueTodayFollowUps)}
          helper="Right now · follow-ups due today"
          icon="clock"
          tone="amber"
        />
      </div>

      {/* Pipeline snapshot + funnel */}
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <section className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
          <div className="flex items-center justify-between border-b border-[#e7ebed] px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold tracking-[-0.015em] text-[#1c2831]">
                Pipeline by stage
              </h2>
              <p className="mt-0.5 text-[10px] text-[#8a959d]">
                Right now · {formatCount(overview.openOpportunities)} open ·{' '}
                {formatEgp(overview.pipelineValue)} total
              </p>
            </div>
            <Link href="/crm/pipeline" className="text-[10px] font-bold text-[#118e82] hover:text-[#08756b]">
              Board
            </Link>
          </div>
          <div className="space-y-2.5 px-5 py-4">
            {OPPORTUNITY_STAGES.map((stage) => {
              const entry = payload.stageDistribution.find((row) => row.stage === stage);
              const count = entry?.count ?? 0;
              const value = entry?.value ?? 0;
              const share = totalStageValue === 0 ? 0 : (value / totalStageValue) * 100;
              return (
                <div key={stage} className="flex items-center gap-3">
                  <span className="w-[110px] shrink-0 truncate text-[10px] font-semibold text-[#53616b]">
                    {STAGE_LABELS[stage]}
                  </span>
                  <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#eef1f3]">
                    <div
                      className={`h-full rounded-full ${
                        stage === 'WON'
                          ? 'bg-[#14815f]'
                          : stage === 'LOST'
                            ? 'bg-[#c43f47]'
                            : stage === 'ON_HOLD'
                              ? 'bg-[#a4aeb5]'
                              : 'bg-[#18b6a4]'
                      }`}
                      style={{ width: `${count === 0 && value === 0 ? 0 : Math.max(share, 2)}%` }}
                    />
                  </div>
                  <span className="w-[90px] shrink-0 text-right text-[10px] font-semibold text-[#35434c]">
                    {count} · {formatEgp(value)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
          <div className="border-b border-[#e7ebed] px-5 py-4">
            <h2 className="text-sm font-semibold tracking-[-0.015em] text-[#1c2831]">
              Conversion funnel
            </h2>
            <p className="mt-0.5 text-[10px] text-[#8a959d]">
              Of the {formatCount(funnelTotal)} leads received in {rangeLabel}, how many reached
              each step
            </p>
          </div>
          <div className="space-y-2.5 px-5 py-4">
            {payload.funnel.map((step) => {
              const share = percent(step.count);
              return (
                <div key={step.key} className="flex items-center gap-3">
                  <span className="w-[110px] shrink-0 truncate text-[10px] font-semibold text-[#53616b]">
                    {FUNNEL_LABELS[step.key]}
                  </span>
                  <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#eef1f3]">
                    <div
                      className="h-full rounded-full bg-[#137aa9]"
                      style={{ width: `${step.count === 0 ? 0 : Math.max(share, 2)}%` }}
                    />
                  </div>
                  <span className="w-[80px] shrink-0 text-right text-[10px] font-semibold text-[#35434c]">
                    {formatCount(step.count)} · {share}%
                  </span>
                </div>
              );
            })}
            <p className="pt-2 text-[9px] leading-4 text-[#98a2a9]">
              Every step is a subset of the one above it, so a share can only fall: Won means a
              Won-stage opportunity, Qualified means an opportunity exists, and step one is the same
              number as the New leads KPI. Contacted is not a milestone — lead status is a label a
              rep can rewrite, not a commercial outcome.
            </p>
          </div>
        </section>
      </div>

      {/* Team performance */}
      <section className="mt-5 overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
        <div className="border-b border-[#e7ebed] px-5 py-4">
          <h2 className="text-sm font-semibold tracking-[-0.015em] text-[#1c2831]">
            {userRole === 'SALES_REP' ? 'My performance' : 'Team performance'}
          </h2>
          <p className="mt-0.5 text-[10px] text-[#8a959d]">
            Period columns cover {rangeLabel}; active leads, open opportunities, pipeline value and
            overdue are current snapshots
          </p>
        </div>
        {payload.repPerformance.length === 0 ? (
          <p className="px-5 py-8 text-center text-[11px] text-[#89949c]">
            No sales team members with activity yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead className="border-b border-[#e5eaec] bg-[#f8fafb] text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                <tr>
                  <th className="px-5 py-3">Sales person</th>
                  <th className="px-3 py-3 text-right">Active leads</th>
                  <th className="px-3 py-3 text-right">New leads</th>
                  <th className="px-3 py-3 text-right">Open opps</th>
                  <th className="px-3 py-3 text-right">Pipeline</th>
                  <th className="px-3 py-3 text-right">Overdue</th>
                  <th className="px-3 py-3 text-right">Completed</th>
                  <th className="px-3 py-3 text-right">Quotes sent</th>
                  <th className="px-3 py-3 text-right">Wins</th>
                  <th className="px-3 py-3 text-right">Won value</th>
                  <th className="px-3 py-3 text-right">Losses</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf0f1]">
                {payload.repPerformance.map((row) => (
                  <tr key={row.userId}>
                    <td className="px-5 py-3">
                      <p className="text-[11px] font-semibold text-[#33414a]">{row.displayName}</p>
                      <p className="text-[9px] text-[#98a2a9]">{row.role === 'SALES_MANAGER' ? 'Sales Manager' : 'Sales Rep'}</p>
                    </td>
                    <Cell value={formatCount(row.activeLeads)} />
                    <Cell value={formatCount(row.newLeads)} />
                    <Cell value={formatCount(row.openOpportunities)} />
                    <Cell value={formatEgp(row.pipelineValue)} />
                    <Cell value={formatCount(row.overdueFollowUps)} warning={row.overdueFollowUps > 0} />
                    <Cell value={formatCount(row.completedFollowUps)} />
                    <Cell value={formatCount(row.quotationsSent)} />
                    <Cell value={formatCount(row.wins)} />
                    <Cell value={formatEgp(row.wonValue)} />
                    <Cell value={formatCount(row.losses)} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Outcomes: lost reasons, sources, quotation outcomes, quotation conversion */}
      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <section className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
          <div className="border-b border-[#e7ebed] px-5 py-4">
            <h2 className="text-sm font-semibold tracking-[-0.015em] text-[#1c2831]">Lost reasons</h2>
            <p className="mt-0.5 text-[10px] text-[#8a959d]">Deals lost in {rangeLabel}</p>
          </div>
          {payload.lostReasons.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] text-[#89949c]">
              No deals were lost in this period.
            </p>
          ) : (
            <div className="space-y-2.5 px-5 py-4">
              {payload.lostReasons.map((reason) => (
                <div key={reason.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-semibold text-[#35434c]">{reason.label}</p>
                    <p className="text-[9px] text-[#98a2a9]">{formatEgp(reason.lostValue)}</p>
                  </div>
                  <span className="rounded-full bg-[#ffe9ea] px-2 py-0.5 text-[9px] font-bold text-[#c43f47]">
                    {formatCount(reason.count)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
          <div className="border-b border-[#e7ebed] px-5 py-4">
            <h2 className="text-sm font-semibold tracking-[-0.015em] text-[#1c2831]">Lead sources</h2>
            <p className="mt-0.5 text-[10px] text-[#8a959d]">Leads received in {rangeLabel}</p>
          </div>
          {payload.sources.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] text-[#89949c]">
              No leads were received in this period.
            </p>
          ) : (
            <div className="space-y-2.5 px-5 py-4">
              {payload.sources.map((source) => (
                <div key={source.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-semibold text-[#35434c]">{source.name}</p>
                    <p className="text-[9px] text-[#98a2a9]">
                      {source.wins} won · {formatEgp(source.wonValue)}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#e8f4ff] px-2 py-0.5 text-[9px] font-bold text-[#287bb5]">
                    {formatCount(source.leads)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
          <div className="border-b border-[#e7ebed] px-5 py-4">
            <h2 className="text-sm font-semibold tracking-[-0.015em] text-[#1c2831]">Quotation outcomes</h2>
            <p className="mt-0.5 text-[10px] text-[#8a959d]">Decisions recorded in {rangeLabel}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 px-5 py-4 text-center">
            <OutcomeTile label="Sent" value={payload.quotationOutcomes.sent} tone="bg-[#e8f4ff] text-[#287bb5]" />
            <OutcomeTile label="Accepted" value={payload.quotationOutcomes.accepted} tone="bg-[#e8f8f1] text-[#14815f]" />
            <OutcomeTile label="Rejected" value={payload.quotationOutcomes.rejected} tone="bg-[#ffe9ea] text-[#c43f47]" />
          </div>
          <p className="px-5 pb-4 text-[9px] leading-4 text-[#98a2a9]">
            Counted by sent / accepted / rejected timestamps. Statuses shown live on the pipeline
            board.
          </p>
        </section>

        <section className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
          <div className="border-b border-[#e7ebed] px-5 py-4">
            <h2 className="text-sm font-semibold tracking-[-0.015em] text-[#1c2831]">
              Quotation conversion
            </h2>
            <p className="mt-0.5 text-[10px] text-[#8a959d]">
              Of the {formatCount(funnelTotal)} leads received in {rangeLabel}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 px-5 py-4 text-center">
            {payload.quotationFunnel.map((step) => (
              <OutcomeTile
                key={step.key}
                label={QUOTATION_FUNNEL_LABELS[step.key]}
                value={step.count}
                tone={
                  step.key === 'accepted'
                    ? 'bg-[#e8f8f1] text-[#14815f]'
                    : 'bg-[#e8f4ff] text-[#287bb5]'
                }
              />
            ))}
          </div>
          <p className="px-5 pb-4 text-[9px] leading-4 text-[#98a2a9]">
            {percent(payload.quotationFunnel[0]?.count ?? 0)}% quoted ·{' '}
            {percent(payload.quotationFunnel[1]?.count ?? 0)}% accepted. Deliberately outside the
            funnel: a deal can be won without a quotation ever being sent.
          </p>
        </section>
      </div>

      {/* Lead status snapshot */}
      <section className="mt-5 overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
        <div className="border-b border-[#e7ebed] px-5 py-4">
          <h2 className="text-sm font-semibold tracking-[-0.015em] text-[#1c2831]">Lead status</h2>
          <p className="mt-0.5 text-[10px] text-[#8a959d]">Right now · non-archived leads</p>
        </div>
        <div className="grid grid-cols-3 gap-2 px-5 py-4">
          {overview.leadsByStatus.map((entry) => (
            <OutcomeTile
              key={entry.status}
              label={STATUS_LABELS[entry.status]}
              value={entry.count}
              tone={
                entry.status === 'NEW'
                  ? 'bg-[#e9f7ff] text-[#137aa9]'
                  : entry.status === 'CONTACTED'
                    ? 'bg-[#fff4d9] text-[#9a6a00]'
                    : 'bg-[#ffe9ea] text-[#c43f47]'
              }
            />
          ))}
        </div>
      </section>

      <p className="mt-4 text-[9px] text-[#98a2a9]">
        Snapshot metrics never change with the selected period. Period fields: new leads →
        lead.created_at · won/lost → won_at / lost_at · quotation outcomes → status timestamps ·
        completed follow-ups → completed_at. Rep totals are scoped to what you are allowed to see.
      </p>
    </>
  );
}

function KpiCard({
  label,
  value,
  helper,
  icon,
  tone,
  warning = false,
}: {
  label: string;
  value: string;
  helper: string;
  icon: CrmIconName;
  tone: 'teal' | 'blue' | 'violet' | 'amber' | 'red';
  warning?: boolean;
}) {
  const tones = {
    teal: 'bg-[#e6f7f4] text-[#0a897c]',
    blue: 'bg-[#eaf4fd] text-[#2a79ad]',
    violet: 'bg-[#f1edff] text-[#7057b8]',
    amber: 'bg-[#fff3dd] text-[#a16800]',
    red: 'bg-[#ffe9ea] text-[#c43f47]',
  };
  return (
    <div
      className={`rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ${
        warning ? 'ring-[#f4c7ca]' : 'ring-[#e4e9eb]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#7e8992]">{label}</p>
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${tones[tone]}`}>
          <CrmIcon name={icon} className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className={`mt-2.5 text-[22px] font-semibold tracking-[-0.04em] ${warning ? 'text-[#be3d45]' : 'text-[#17242c]'}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[9px] text-[#87929a]">{helper}</p>
    </div>
  );
}

function Cell({ value, warning = false }: { value: string; warning?: boolean }) {
  return (
    <td className={`px-3 py-3 text-right text-[10px] font-semibold ${warning ? 'text-[#bd454b]' : 'text-[#35434c]'}`}>
      {value}
    </td>
  );
}

function OutcomeTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-lg px-2 py-3 ${tone}`}>
      <p className="text-[17px] font-semibold tracking-[-0.03em]">{formatCount(value)}</p>
      <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.08em] opacity-80">{label}</p>
    </div>
  );
}
