'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Avatar } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { getPipelineBoardAction } from '@/server/crm/dashboard/actions';
import type { PipelineBoard } from '@/server/crm/dashboard/repository';
import { STAGE_LABELS, OPPORTUNITY_STAGES, type OpportunityStage } from '@/server/crm/opportunities/stage';
import { ACTION_TYPE_LABELS, type FollowUpActionType } from '@/server/crm/opportunities/followup-actions';
import { QUOTATION_STATUS_LABELS } from '@/server/crm/quotations/status';
import type { QuotationStatus } from '@/server/crm/quotations/status';

const STAGE_HEADER: Record<OpportunityStage, string> = {
  QUALIFIED: 'bg-[#f1edff] text-[#6d52be]',
  NEEDS_ANALYSIS: 'bg-[#e9f7ff] text-[#137aa9]',
  PROPOSAL: 'bg-[#e8f4ff] text-[#287bb5]',
  NEGOTIATION: 'bg-[#fff0e5] text-[#b45b1b]',
  ON_HOLD: 'bg-[#edf0f2] text-[#63707a]',
  WON: 'bg-[#e8f8f1] text-[#14815f]',
  LOST: 'bg-[#ffe9ea] text-[#c43f47]',
};

const QUOTATION_CHIP: Record<QuotationStatus, string> = {
  DRAFT: 'bg-[#edf0f2] text-[#63707a]',
  SENT: 'bg-[#e8f4ff] text-[#287bb5]',
  ACCEPTED: 'bg-[#e8f8f1] text-[#14815f]',
  REJECTED: 'bg-[#ffe9ea] text-[#c43f47]',
  EXPIRED: 'bg-[#f1edff] text-[#6d52be]',
};

function formatEgp(value: number | null): string {
  if (value === null) return 'Not set';
  return value.toLocaleString('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 0,
  });
}

interface PipelineBoardProps {
  initial: PipelineBoard;
  ownerOptions: { id: string; displayName: string }[];
  sourceOptions: { id: string; name: string }[];
  canFilterOwner: boolean;
  /** Server-rendered timestamp so every overdue flag in this pass agrees. */
  now: number;
}

export function PipelineBoard({
  initial,
  ownerOptions,
  sourceOptions,
  canFilterOwner,
  now,
}: PipelineBoardProps) {
  const [board, setBoard] = useState<PipelineBoard>(initial);
  const [ownerUserId, setOwnerUserId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [stage, setStage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async (next: { ownerUserId?: string; sourceId?: string; stage?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const owner = next.ownerUserId !== undefined ? next.ownerUserId : ownerUserId;
      const source = next.sourceId !== undefined ? next.sourceId : sourceId;
      const nextStage = next.stage !== undefined ? next.stage : stage;
      setBoard(
        await getPipelineBoardAction({
          ownerUserId: owner || null,
          sourceId: source || null,
          stage: nextStage || null,
        }),
      );
    } catch {
      setError('The pipeline could not be refreshed.');
    } finally {
      setBusy(false);
    }
  };

  const openValue = board.totals
    .filter((entry) => entry.stage !== 'WON' && entry.stage !== 'LOST')
    .reduce((sum, entry) => sum + entry.value, 0);
  const openCount = board.totals
    .filter((entry) => entry.stage !== 'WON' && entry.stage !== 'LOST')
    .reduce((sum, entry) => sum + entry.count, 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#18a897]">
            Commercial pipeline
          </p>
          <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[#16232c]">Pipeline</h1>
          <p className="mt-1 text-[12px] text-[#75828c]">
            {openCount} open opportunities worth {formatEgp(openValue)}. Stage changes happen on the
            opportunity itself — open a card to move it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canFilterOwner ? (
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-[#7b8790]">Owner</span>
              <select
                value={ownerUserId}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.value;
                  setOwnerUserId(next);
                  void reload({ ownerUserId: next });
                }}
                className="h-9 rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] font-medium text-[#3c4a54] outline-none focus:border-[#18b6a4]"
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
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-[#7b8790]">Source</span>
            <select
              value={sourceId}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value;
                setSourceId(next);
                void reload({ sourceId: next });
              }}
              className="h-9 rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] font-medium text-[#3c4a54] outline-none focus:border-[#18b6a4]"
            >
              <option value="">All sources</option>
              {sourceOptions.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-[#7b8790]">Stage</span>
            <select
              value={stage}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value;
                setStage(next);
                void reload({ stage: next });
              }}
              className="h-9 rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] font-medium text-[#3c4a54] outline-none focus:border-[#18b6a4]"
            >
              <option value="">All stages</option>
              {OPPORTUNITY_STAGES.map((option) => (
                <option key={option} value={option}>
                  {STAGE_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-[#fff0f1] px-3.5 py-2.5 text-[11px] font-semibold text-[#b83c43] ring-1 ring-[#f0c5c8]">
          {error}
        </p>
      ) : null}

      <div className="mt-5 overflow-x-auto pb-3">
        <div className="flex min-w-[1540px] items-start gap-3">
          {OPPORTUNITY_STAGES.map((stage) => {
            const total = board.totals.find((entry) => entry.stage === stage);
            const cards = board.cards.filter((card) => card.stage === stage);
            return (
              <div
                key={stage}
                className="flex w-[212px] shrink-0 flex-col rounded-xl bg-[#f0f3f4] ring-1 ring-[#dfe5e8]"
              >
                <div className="rounded-t-xl px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[9px] font-bold tracking-[0.08em] ${STAGE_HEADER[stage]}`}
                    >
                      {STAGE_LABELS[stage].toUpperCase()}
                    </span>
                    <span className="text-[10px] font-semibold text-[#63707a]">
                      {total?.count ?? 0}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[10px] font-semibold text-[#53616b]">
                    {formatEgp(total?.value ?? 0)}
                  </p>
                </div>

                <div className="flex min-h-[120px] flex-1 flex-col gap-2 px-2.5 pb-2.5">
                  {cards.length === 0 ? (
                    <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-[#d5dce0] px-3 py-4 text-center">
                      <p className="text-[9px] leading-4 text-[#9aa3aa]">No opportunities here.</p>
                    </div>
                  ) : (
                    cards.map((card) => {
                      const overdue =
                        card.nextAction !== null && card.nextAction.dueAt.getTime() < now;
                      return (
                        <Link
                          key={card.id}
                          href={`/crm/opportunities/${card.id}`}
                          className={`block rounded-lg bg-white p-3 shadow-[0_1px_2px_rgba(20,35,45,0.05)] ring-1 transition hover:shadow-[0_2px_8px_rgba(20,35,45,0.08)] ${
                            overdue ? 'ring-[#f0c5c8]' : 'ring-[#e4e9eb]'
                          }`}
                        >
                          <p className="text-[11px] font-semibold text-[#202e37]">
                            {card.accountName ?? card.contactName}
                          </p>
                          <p className="mt-0.5 truncate text-[9px] text-[#68757e]">
                            {card.accountName ? card.contactName : null}
                          </p>
                          <div className="mt-2 flex items-center gap-1.5">
                            <Avatar name={card.ownerName} size="sm" />
                            <span className="truncate text-[9px] text-[#53616a]">{card.ownerName}</span>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-[#2c3a43]">
                              {formatEgp(card.estimatedValue)}
                            </span>
                            {card.latestQuotation ? (
                              <span
                                className={`rounded-full px-2 py-0.5 text-[8px] font-bold tracking-[0.06em] ${QUOTATION_CHIP[card.latestQuotation.status]}`}
                              >
                                {QUOTATION_STATUS_LABELS[card.latestQuotation.status].toUpperCase()}
                              </span>
                            ) : null}
                          </div>
                          {card.latestQuotation ? (
                            <p className="mt-1 text-[8px] text-[#98a2a9]">
                              {card.latestQuotation.quoteNumber}
                            </p>
                          ) : null}
                          {card.nextAction ? (
                            <div
                              className={`mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 ${
                                overdue ? 'bg-[#fff0f1]' : 'bg-[#f5f8f9]'
                              }`}
                            >
                              <CrmIcon
                                name={overdue ? 'alert' : 'clock'}
                                className={`mt-0.5 h-3 w-3 shrink-0 ${overdue ? 'text-[#c43f47]' : 'text-[#6a7c85]'}`}
                              />
                              <div className="min-w-0">
                                <p
                                  className={`text-[8px] font-bold uppercase tracking-[0.06em] ${
                                    overdue ? 'text-[#bd454b]' : 'text-[#7b8790]'
                                  }`}
                                >
                                  {overdue ? 'Overdue' : 'Next'}:{' '}
                                  {ACTION_TYPE_LABELS[card.nextAction.actionType as FollowUpActionType] ??
                                    card.nextAction.actionType}
                                </p>
                                <p className="mt-0.5 text-[8px] text-[#98a2a9]">
                                  Due {card.nextAction.dueAt.toLocaleDateString()}
                                  {card.nextAction.note ? ` · ${card.nextAction.note}` : null}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <p className="mt-2 flex items-center gap-1.5 text-[8px] font-semibold text-[#a07a4a]">
                              <CrmIcon name="alert" className="h-3 w-3" />
                              No next action
                            </p>
                          )}
                        </Link>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-1 text-[10px] text-[#98a2a9]">
        The board is a live snapshot: stage, owner, value, next action and the latest quotation per
        opportunity. Source and owner narrow every card and every column total; stage filtering
        lives on this board, not on the dashboard.{' '}
        {canFilterOwner ? '' : 'You see only your own book.'}
      </p>
    </>
  );
}
