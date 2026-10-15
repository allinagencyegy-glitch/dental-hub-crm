'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { Avatar, BackLink, Badge, SectionTitle } from '@/components/crm/Ui';
import { CrmIcon, type CrmIconName } from '@/components/crm/CrmIcon';
import {
  changeOpportunityStageAction,
  completeFollowUpAction,
  createFollowUpAction,
  reassignOpportunityOwnerAction,
  rescheduleFollowUpAction,
  updateOpportunityAction,
} from '@/server/crm/opportunities/actions';
import {
  STAGE_LABELS,
  isTerminalStage,
  type OpportunityStage,
} from '@/server/crm/opportunities/stage';
import {
  ACTION_TYPE_LABELS,
  FOLLOW_UP_ACTION_TYPES,
  type FollowUpActionType,
} from '@/server/crm/opportunities/followup-actions';
import type { OpportunityDetail as OpportunityDetailData } from '@/server/crm/opportunities/repository';
import type { OpportunityActivityEntry } from '@/server/crm/opportunities/repository';
import type { StageHistoryEntry } from '@/server/crm/opportunities/repository';
import type { FollowUp } from '@/server/crm/opportunities/followups';
import type { QuotationListItem } from '@/server/crm/quotations/repository';

type Role = 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP';

interface OpportunityDetailProps {
  opportunity: OpportunityDetailData;
  followUps: FollowUp[];
  lostReasons: { id: string; code: string; label: string; requiresNote: boolean }[];
  owners: { id: string; displayName: string; role: string }[];
  canAssignOwner: boolean;
  userRole: Role;
  userId: string;
  allowedStages: readonly OpportunityStage[];
  stageHistory: StageHistoryEntry[];
  activity: OpportunityActivityEntry[];
  quotations: QuotationListItem[];
  canCreateQuotation: boolean;
  /** Server-rendered timestamp used for every overdue calculation. */
  now: number;
}

const QUOTATION_STATUS_CHIP: Record<QuotationListItem['status'], string> = {
  DRAFT: 'bg-[#edf0f2] text-[#63707a]',
  SENT: 'bg-[#e8f4ff] text-[#287bb5]',
  ACCEPTED: 'bg-[#e8f8f1] text-[#14815f]',
  REJECTED: 'bg-[#ffe9ea] text-[#c43f47]',
  EXPIRED: 'bg-[#f1edff] text-[#6d52be]',
};

const ACTIVITY_ICON: Record<string, CrmIconName> = {
  STAGE_CHANGE: 'activity',
  FOLLOW_UP_CREATED: 'clock',
  FOLLOW_UP_COMPLETED: 'check',
  FOLLOW_UP_RESCHEDULED: 'clock',
  NOTE_ADDED: 'edit',
  OWNER_CHANGED: 'team',
  QUOTATION_CREATED: 'quotation',
  QUOTATION_REVISED: 'quotation',
  QUOTATION_SENT: 'mail',
  QUOTATION_ACCEPTED: 'check',
  QUOTATION_REJECTED: 'x',
  QUOTATION_EXPIRED: 'clock',
};

const STAGE_CHIP: Record<OpportunityStage, string> = {
  QUALIFIED: 'bg-[#f1edff] text-[#6d52be]',
  NEEDS_ANALYSIS: 'bg-[#e9f7ff] text-[#137aa9]',
  PROPOSAL: 'bg-[#e8f4ff] text-[#287bb5]',
  NEGOTIATION: 'bg-[#fff0e5] text-[#b45b1b]',
  ON_HOLD: 'bg-[#edf0f2] text-[#63707a]',
  WON: 'bg-[#e8f8f1] text-[#14815f]',
  LOST: 'bg-[#ffe9ea] text-[#c43f47]',
};

function formatEgp(value: number | null): string {
  if (value === null) return 'Not set';
  return value.toLocaleString('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 0,
  });
}

/** datetime-local wants "YYYY-MM-DDTHH:mm" in the browser's own timezone. */
function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function OpportunityDetail({
  opportunity,
  followUps,
  lostReasons,
  owners,
  canAssignOwner,
  allowedStages,
  stageHistory,
  activity,
  quotations,
  canCreateQuotation,
  now,
}: OpportunityDetailProps) {
  const router = useRouter();

  const latestQuotation = quotations.length > 0 ? quotations[quotations.length - 1] : null;

  // "Now" arrives from the server render. It is the same value for the whole
  // pass, so every overdue flag derived from it agrees and stays stable across
  // client re-renders.
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Losing needs a reason, and the seeded 'other' reason requires a note.
  const [losing, setLosing] = useState(false);
  const [lostReasonId, setLostReasonId] = useState('');
  const [lostNote, setLostNote] = useState('');

  const [showSchedule, setShowSchedule] = useState(false);
  const [actionType, setActionType] = useState<FollowUpActionType>('CALL');
  const [actionNote, setActionNote] = useState('');
  const [actionDueAt, setActionDueAt] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
  );

  // Inline reschedule of a pending follow-up from the timeline.
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleDueAt, setRescheduleDueAt] = useState('');

  const [editing, setEditing] = useState(false);
  const [estimatedValue, setEstimatedValue] = useState(
    opportunity.estimatedValue === null ? '' : String(opportunity.estimatedValue),
  );
  const [notes, setNotes] = useState(opportunity.notes ?? '');

  const pending = useMemo(
    () =>
      followUps
        .filter((followUp) => followUp.completedAt === null)
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime()),
    [followUps],
  );
  const completed = useMemo(
    () =>
      followUps
        .filter((followUp) => followUp.completedAt !== null)
        .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)),
    [followUps],
  );

  const followUpById = useMemo(() => {
    const map = new Map<string, FollowUp>();
    for (const followUp of followUps) map.set(followUp.id, followUp);
    return map;
  }, [followUps]);

  // The unified timeline: the durable activity feed (0007) plus the lead's own
  // arrival as the synthetic opening event. Newest first.
  const timeline = useMemo(() => {
    const events: { key: string; at: Date; icon: string; title: string; detail?: string; followUp?: FollowUp }[] = [];
    for (const entry of activity) {
      const followUpId = typeof entry.metadata?.followUpId === 'string' ? entry.metadata.followUpId : undefined;
      events.push({
        key: entry.id,
        at: entry.createdAt,
        icon: ACTIVITY_ICON[entry.activityType],
        title: entry.description,
        detail: entry.actorName ? `by ${entry.actorName}` : undefined,
        followUp: followUpId ? followUpById.get(followUpId) : undefined,
      });
    }
    events.push({
      key: 'lead-created',
      at: opportunity.leadReceivedAt,
      icon: 'leads',
      title: `Lead received from ${opportunity.leadSourceName}`,
      detail: opportunity.contactName,
    });
    return events.sort((a, b) => b.at.getTime() - a.at.getTime());
  }, [activity, followUpById, opportunity.leadReceivedAt, opportunity.leadSourceName, opportunity.contactName]);

  const nextAction = pending[0] ?? null;
  const isOverdue = nextAction !== null && nextAction.dueAt.getTime() < now;
  const isClosed = isTerminalStage(opportunity.stage);
  const needsLostNote = losing && lostReasons.find((r) => r.id === lostReasonId)?.requiresNote === true;

  const run = async (action: () => Promise<{ ok: boolean; message?: string } | null>, success: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result && result.ok === false) {
        setError(result.message ?? 'That action could not be completed.');
        return;
      }
      setNotice(success);
      router.refresh();
    } catch {
      setError('That action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const handleStageChange = (toStage: OpportunityStage) => {
    if (toStage === 'LOST') {
      setLosing(true);
      return;
    }
    void run(
      () => changeOpportunityStageAction(opportunity.id, { toStage }),
      `Stage moved to ${STAGE_LABELS[toStage]}.`,
    );
  };

  const handleConfirmLost = (event: FormEvent) => {
    event.preventDefault();
    if (!lostReasonId) {
      setError('Select a reason for losing this opportunity.');
      return;
    }
    if (needsLostNote && !lostNote.trim()) {
      setError('This reason requires a short note.');
      return;
    }
    void run(
      () =>
        changeOpportunityStageAction(opportunity.id, {
          toStage: 'LOST',
          lostReasonId,
          lostNote: lostNote.trim() || null,
        }),
      'Opportunity marked as lost. Its activity history is preserved.',
    ).then(() => setLosing(false));
  };

  const handleComplete = (followUpId: string) => {
    void run(
      () => completeFollowUpAction(followUpId),
      'Action completed. The next action is now due to be scheduled.',
    );
  };

  const handleReschedule = (followUp: FollowUp) => {
    if (!rescheduleDueAt) {
      setError('Choose a new due date and time.');
      return;
    }
    const dueAt = new Date(rescheduleDueAt);
    if (Number.isNaN(dueAt.getTime())) {
      setError('That due date could not be read.');
      return;
    }
    void run(
      () => rescheduleFollowUpAction(followUp.id, dueAt.toISOString()),
      'Action rescheduled.',
    ).then(() => setReschedulingId(null));
  };

  const handleSchedule = (event: FormEvent) => {
    event.preventDefault();
    if (!actionDueAt) {
      setError('Choose when this action is due.');
      return;
    }
    const dueAt = new Date(actionDueAt);
    if (Number.isNaN(dueAt.getTime())) {
      setError('That due date could not be read.');
      return;
    }
    void run(
      () =>
        createFollowUpAction(opportunity.id, {
          actionType,
          note: actionNote.trim() || null,
          dueAt: dueAt.toISOString(),
        }),
      'Next action scheduled.',
    ).then(() => {
      setActionNote('');
      setShowSchedule(false);
    });
  };

  const handleSaveDetails = (event: FormEvent) => {
    event.preventDefault();
    const parsed = estimatedValue.trim() === '' ? null : Number(estimatedValue);
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) {
      setError('Estimated value must be zero or more.');
      return;
    }
    void run(
      () => updateOpportunityAction(opportunity.id, { estimatedValue: parsed, notes }),
      'Opportunity details saved.',
    ).then(() => setEditing(false));
  };

  const handleReassign = (ownerUserId: string) => {
    if (!ownerUserId || ownerUserId === opportunity.ownerUserId) return;
    void run(
      () => reassignOpportunityOwnerAction(opportunity.id, ownerUserId),
      'Opportunity reassigned.',
    );
  };

  return (
    <>
      <BackLink href="/crm/opportunities" label="Back to opportunities" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[25px] font-semibold tracking-[-0.035em] text-[#16232c]">
              {opportunity.accountName ?? opportunity.contactName}
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[9px] font-bold tracking-[0.08em] ${
                STAGE_CHIP[opportunity.stage]
              }`}
            >
              {STAGE_LABELS[opportunity.stage].toUpperCase()}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[#596872]">
            {opportunity.productCategoryName ?? 'No product category set'}
          </p>
          <p className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-[#9aa3aa]">
            Opportunity {opportunity.id.slice(0, 8)} · from {opportunity.leadSourceName}
          </p>
        </div>

        <Link
          href={`/crm/leads/${opportunity.leadId}`}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dbe2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
        >
          <CrmIcon name="leads" className="h-3.5 w-3.5" />
          View source lead
        </Link>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-[#fff0f1] px-3.5 py-2.5 text-[11px] font-semibold text-[#b83c43] ring-1 ring-[#f0c5c8]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-lg bg-[#e9f7f4] px-3.5 py-2.5 text-[11px] font-semibold text-[#0c8176] ring-1 ring-[#bce6df]">
          {notice}
        </p>
      ) : null}

      {isClosed ? (
        <div
          className={`mt-5 rounded-xl p-4 ring-1 ${
            opportunity.stage === 'WON'
              ? 'bg-[#e9f7f1] ring-[#bfe5d5]'
              : 'bg-[#fff4f4] ring-[#f0c5c8]'
          }`}
        >
          <p className="text-[11px] font-semibold text-[#35434c]">
            This opportunity is {STAGE_LABELS[opportunity.stage].toLowerCase()}.
            {opportunity.wonAt ? ` Closed on ${opportunity.wonAt.toLocaleDateString()}.` : null}
            {opportunity.lostAt ? ` Closed on ${opportunity.lostAt.toLocaleDateString()}.` : null}
            {opportunity.lostReasonLabel ? ` Reason: ${opportunity.lostReasonLabel}.` : null}
          </p>
          <p className="mt-1 text-[10px] text-[#6c7a83]">
            {completed.length} action{completed.length === 1 ? '' : 's'} completed and kept on
            record. A closed deal is terminal — start a new lead for a fresh commercial attempt.
          </p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          {/* Next action, always the most prominent thing on the page. */}
          <section
            className={`rounded-xl p-5 ring-1 ${
              isOverdue
                ? 'bg-[#fff0f1] ring-[#f0c5c8]'
                : nextAction
                  ? 'bg-white ring-[#dfe5e8]'
                  : 'bg-[#fffaf1] ring-[#f0dcbc]'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CrmIcon
                  name={isOverdue ? 'alert' : 'clock'}
                  className={`h-4 w-4 ${isOverdue ? 'text-[#bd3d45]' : 'text-[#5f7b78]'}`}
                />
                <h2 className="text-xs font-semibold text-[#2b3841]">
                  {isOverdue ? 'Overdue next action' : 'Next action'}
                </h2>
              </div>
              {!isClosed ? (
                <button
                  type="button"
                  onClick={() => setShowSchedule((open) => !open)}
                  className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[#128c80] transition hover:text-[#0b7268]"
                >
                  <CrmIcon name="plus" className="h-3 w-3" />
                  {nextAction ? 'Add another action' : 'Set next action'}
                </button>
              ) : null}
            </div>

            {nextAction ? (
              <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-[#3f2b2d]">
                    {ACTION_TYPE_LABELS[nextAction.actionType]}
                  </p>
                  {nextAction.note ? (
                    <p className="mt-1.5 max-w-[420px] text-[10px] leading-4 text-[#836467]">
                      {nextAction.note}
                    </p>
                  ) : null}
                  <p
                    className={`mt-1.5 text-[9px] font-semibold ${
                      isOverdue ? 'text-[#bd454b]' : 'text-[#829098]'
                    }`}
                  >
                    Due {nextAction.dueAt.toLocaleDateString()} at{' '}
                    {nextAction.dueAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleComplete(nextAction.id)}
                  className="rounded-lg bg-[#16232c] px-3.5 py-2 text-[10px] font-bold text-white transition hover:bg-[#22323c] disabled:opacity-60"
                >
                  Complete action
                </button>
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-[#8a6b48]">
                No next action scheduled. An open opportunity without a due action is work nobody
                will pick up.
              </p>
            )}

            {showSchedule && !isClosed ? (
              <form onSubmit={handleSchedule} className="mt-4 space-y-3 border-t border-[#e7ebed] pt-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                      Action type
                    </span>
                    <select
                      value={actionType}
                      onChange={(event) => setActionType(event.target.value as FollowUpActionType)}
                      className="mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] font-medium text-[#3c4a54] outline-none focus:border-[#18b6a4]"
                    >
                      {FOLLOW_UP_ACTION_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {ACTION_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                      Due
                    </span>
                    <input
                      type="datetime-local"
                      value={actionDueAt}
                      onChange={(event) => setActionDueAt(event.target.value)}
                      className="mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#3c4a54] outline-none focus:border-[#18b6a4]"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                    Note
                  </span>
                  <textarea
                    value={actionNote}
                    onChange={(event) => setActionNote(event.target.value)}
                    rows={2}
                    placeholder="What needs to happen, and what does done look like?"
                    className="mt-1.5 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 py-2 text-[11px] text-[#3c4a54] outline-none placeholder:text-[#a4aeb5] focus:border-[#18b6a4]"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-[#132932] px-3.5 py-2 text-[10px] font-bold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
                  >
                    Schedule action
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSchedule(false)}
                    className="rounded-lg border border-[#dbe2e5] bg-white px-3.5 py-2 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
          </section>

          {/* Stage movement. Only legal transitions are offered. */}
          <section className="rounded-xl bg-white p-5 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
            <h2 className="text-sm font-semibold text-[#202d35]">Stage</h2>
            <p className="mt-0.5 text-[10px] text-[#8c969d]">
              {isClosed
                ? 'A closed deal is terminal. Its history stays on the record.'
                : 'Only legal moves are offered. Marking as won or lost closes the deal.'}
            </p>

            {isClosed ? (
              <p className="mt-4 text-[11px] text-[#6c7a83]">
                Closed as {STAGE_LABELS[opportunity.stage].toLowerCase()}.
              </p>
            ) : losing ? (
              <form onSubmit={handleConfirmLost} className="mt-4 space-y-3">
                <label className="block">
                  <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                    Why was it lost?
                  </span>
                  <select
                    value={lostReasonId}
                    onChange={(event) => setLostReasonId(event.target.value)}
                    className="mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] font-medium text-[#3c4a54] outline-none focus:border-[#18b6a4]"
                  >
                    <option value="">Select a reason…</option>
                    {lostReasons.map((reason) => (
                      <option key={reason.id} value={reason.id}>
                        {reason.label}
                      </option>
                    ))}
                  </select>
                </label>
                {needsLostNote ? (
                  <label className="block">
                    <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                      Note (required)
                    </span>
                    <textarea
                      value={lostNote}
                      onChange={(event) => setLostNote(event.target.value)}
                      rows={2}
                      className="mt-1.5 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 py-2 text-[11px] text-[#3c4a54] outline-none focus:border-[#18b6a4]"
                    />
                  </label>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-[#b83c43] px-3.5 py-2 text-[10px] font-bold text-white transition hover:bg-[#a5343b] disabled:opacity-60"
                  >
                    Confirm lost
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLosing(false);
                      setLostReasonId('');
                      setLostNote('');
                    }}
                    className="rounded-lg border border-[#dbe2e5] bg-white px-3.5 py-2 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {allowedStages.length === 0 ? (
                  <p className="text-[11px] text-[#6c7a83]">No further stage changes are possible.</p>
                ) : (
                  allowedStages.map((stage) => (
                    <button
                      key={stage}
                      type="button"
                      disabled={busy}
                      onClick={() => handleStageChange(stage)}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold transition disabled:opacity-60 ${
                        stage === 'WON'
                          ? 'bg-[#14815f] text-white hover:bg-[#0f6d50]'
                          : stage === 'LOST'
                            ? 'border border-[#f0c5c8] bg-white text-[#b83c43] hover:bg-[#fff5f5]'
                            : stage === 'ON_HOLD'
                              ? 'border border-[#dbe2e5] bg-white text-[#53616b] hover:bg-[#f7f9fa]'
                              : 'bg-[#132932] text-white hover:bg-[#1b3944]'
                      }`}
                    >
                      {stage === 'WON' ? <CrmIcon name="check" className="h-3.5 w-3.5" /> : null}
                      {stage === 'ON_HOLD' ? <CrmIcon name="pause" className="h-3.5 w-3.5" /> : null}
                      {stage === 'LOST' ? <CrmIcon name="x" className="h-3.5 w-3.5" /> : null}
                      {stage === 'WON'
                        ? 'Mark as won'
                        : stage === 'LOST'
                          ? 'Mark as lost'
                          : `Move to ${STAGE_LABELS[stage]}`}
                    </button>
                  ))
                )}
              </div>
            )}
          </section>

          {/* Quotation workspace: the commercial document history of this deal. */}
          <section className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
            <SectionTitle
              title="Quotations"
              subtitle={
                quotations.length === 0
                  ? 'No quotation created yet'
                  : `${quotations.length} quotation${quotations.length === 1 ? '' : 's'} on record`
              }
            />
            <div className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                {canCreateQuotation ? (
                  <Link
                    href={`/crm/quotations/new?opportunity=${opportunity.id}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#132932] px-3 text-[11px] font-semibold text-white transition hover:bg-[#1b3944]"
                  >
                    <CrmIcon name="plus" className="h-3.5 w-3.5" />
                    New quotation
                  </Link>
                ) : null}
                {latestQuotation ? (
                  <Link
                    href={`/crm/quotations/${latestQuotation.id}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#dbe2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
                  >
                    <CrmIcon name="quotation" className="h-3.5 w-3.5" />
                    Open latest
                  </Link>
                ) : null}
              </div>

              {quotations.length === 0 ? (
                <p className="mt-4 text-[11px] leading-5 text-[#8b969e]">
                  {isClosed
                    ? 'This deal is closed, so no new quotation can be created.'
                    : 'Create a quotation to price the equipment for this customer. Quotations stay on the record forever — sent, accepted and rejected alike.'}
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-[#edf0f1]">
                  {quotations.map((quotation) => (
                    <li key={quotation.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3">
                      <Link
                        href={`/crm/quotations/${quotation.id}`}
                        className="text-[11px] font-bold text-[#188c81] hover:underline"
                      >
                        {quotation.quoteNumber}
                      </Link>
                      {quotation.version > 1 ? (
                        <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-[#9aa3aa]">
                          v{quotation.version}
                        </span>
                      ) : null}
                      <span
                        className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-bold tracking-[0.06em] ${QUOTATION_STATUS_CHIP[quotation.status]}`}
                      >
                        {quotation.status}
                      </span>
                      {quotation.previousQuoteNumber ? (
                        <span className="text-[9px] text-[#9aa3aa]">
                          revises {quotation.previousQuoteNumber}
                        </span>
                      ) : null}
                      <span className="ml-auto whitespace-nowrap text-[11px] font-semibold text-[#2c3a43]">
                        {quotation.totalAmount.toLocaleString('en-EG', {
                          style: 'currency',
                          currency: 'EGP',
                          maximumFractionDigits: 0,
                        })}
                      </span>
                      <span className="text-[9px] text-[#929da4]">
                        {quotation.sentAt
                          ? `sent ${quotation.sentAt.toLocaleDateString()}`
                          : `updated ${quotation.updatedAt.toLocaleDateString()}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Commercial details. */}
          <section className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
            <SectionTitle title="Opportunity details" subtitle="Ownership and commercial fields" />
            <div className="px-5 py-4">
              {editing ? (
                <form onSubmit={handleSaveDetails} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                        Estimated value (EGP)
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={estimatedValue}
                        onChange={(event) => setEstimatedValue(event.target.value)}
                        className="mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#3c4a54] outline-none focus:border-[#18b6a4]"
                      />
                    </label>
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                        Owner
                      </span>
                      <p className="mt-1.5 flex h-9 items-center text-[11px] font-medium text-[#3c4a54]">
                        {opportunity.ownerName}
                      </p>
                    </div>
                  </div>
                  <label className="block">
                    <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                      Notes
                    </span>
                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      rows={3}
                      className="mt-1.5 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 py-2 text-[11px] leading-5 text-[#3c4a54] outline-none focus:border-[#18b6a4]"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-lg bg-[#132932] px-3.5 py-2 text-[10px] font-bold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
                    >
                      Save details
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(false);
                        setEstimatedValue(
                          opportunity.estimatedValue === null ? '' : String(opportunity.estimatedValue),
                        );
                        setNotes(opportunity.notes ?? '');
                      }}
                      className="rounded-lg border border-[#dbe2e5] bg-white px-3.5 py-2 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="grid gap-x-8 sm:grid-cols-2">
                    <DetailLine label="Estimated value" value={formatEgp(opportunity.estimatedValue)} />
                    <DetailLine label="Primary contact" value={opportunity.contactName} />
                    <DetailLine
                      label="Account"
                      value={opportunity.accountName ?? 'No account linked'}
                    />
                    <DetailLine
                      label="Product interest"
                      value={opportunity.productCategoryName ?? 'Not set'}
                    />
                    <DetailLine label="Owner" value={opportunity.ownerName} />
                    <DetailLine label="Source lead status" value={opportunity.leadStatus} />
                  </div>
                  {opportunity.notes ? (
                    <div className="mt-3 rounded-lg bg-[#f6f8f9] p-4">
                      <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">
                        Sales context
                      </p>
                      <p className="mt-2 whitespace-pre-line text-[11px] leading-5 text-[#46545d]">
                        {opportunity.notes}
                      </p>
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-[#edf0f1] pt-4">
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#dbe2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
                    >
                      <CrmIcon name="edit" className="h-3.5 w-3.5" />
                      Edit details
                    </button>
                    {canAssignOwner ? (
                      <label className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-[#7b8790]">Reassign to</span>
                        <select
                          value=""
                          onChange={(event) => handleReassign(event.target.value)}
                          className="h-9 rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] font-medium text-[#3c4a54] outline-none focus:border-[#18b6a4]"
                        >
                          <option value="">Choose an owner…</option>
                          {owners
                            .filter((owner) => owner.id !== opportunity.ownerUserId)
                            .map((owner) => (
                              <option key={owner.id} value={owner.id}>
                                {owner.displayName}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Unified activity timeline: lead arrival + every durable interaction. */}
          <section className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
            <SectionTitle
              title="Activity timeline"
              subtitle={
                timeline.length > 0
                  ? `Last interaction ${timeline[0].at.toLocaleDateString()} · ${completed.length} completed · ${pending.length} pending`
                  : 'No interactions recorded yet'
              }
            />
            {timeline.length === 0 ? (
              <p className="px-5 py-8 text-center text-[11px] text-[#89949c]">
                No activity recorded yet.
              </p>
            ) : (
              <div className="divide-y divide-[#edf0f1]">
                {timeline.map((event) => {
                  const followUp = event.followUp;
                  const pendingFollowUp =
                    followUp !== undefined && followUp.completedAt === null;
                  const overdueFollowUp =
                    pendingFollowUp && followUp.dueAt.getTime() < now;
                  return (
                    <div key={event.key} className="flex gap-3.5 px-5 py-4">
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                          overdueFollowUp
                            ? 'bg-[#fff0f1] text-[#c43f47]'
                            : event.icon === 'check'
                              ? 'bg-[#e9f7f1] text-[#14815f]'
                              : 'bg-[#edf6f5] text-[#16877b]'
                        }`}
                      >
                        <CrmIcon name={event.icon as CrmIconName} className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap justify-between gap-2">
                          <p className="text-[11px] font-semibold text-[#35424b]">
                            {event.title}
                            {pendingFollowUp ? (
                              overdueFollowUp ? (
                                <span className="ml-2 text-[9px] font-bold uppercase tracking-[0.08em] text-[#bd454b]">
                                  Overdue
                                </span>
                              ) : (
                                <span className="ml-2 text-[9px] font-bold uppercase tracking-[0.08em] text-[#16877b]">
                                  Pending
                                </span>
                              )
                            ) : null}
                          </p>
                          <span className="whitespace-nowrap text-[9px] text-[#929ca3]">
                            {event.at.toLocaleDateString()} ·{' '}
                            {event.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {followUp ? (
                          <p className="mt-1 text-[10px] leading-4 text-[#74818a]">
                            {ACTION_TYPE_LABELS[followUp.actionType]}
                            {pendingFollowUp
                              ? ` · due ${followUp.dueAt.toLocaleDateString()} at ${followUp.dueAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                              : followUp.completedAt
                                ? ` · done ${followUp.completedAt.toLocaleDateString()}`
                                : null}
                            {followUp.note ? ` · ${followUp.note}` : null}
                          </p>
                        ) : event.detail ? (
                          <p className="mt-1 text-[10px] leading-4 text-[#74818a]">{event.detail}</p>
                        ) : null}
                      </div>
                      {pendingFollowUp ? (
                        reschedulingId === followUp.id ? (
                          <div className="flex shrink-0 items-center gap-1.5 self-center">
                            <input
                              type="datetime-local"
                              aria-label="New due date"
                              value={rescheduleDueAt}
                              onChange={(event) => setRescheduleDueAt(event.target.value)}
                              className="h-7 rounded-md border border-[#dfe4e7] bg-white px-2 text-[9px] text-[#3c4a54] outline-none focus:border-[#18b6a4]"
                            />
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleReschedule(followUp)}
                              className="h-7 shrink-0 rounded-md bg-[#132932] px-2.5 text-[9px] font-bold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setReschedulingId(null)}
                              className="h-7 shrink-0 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] font-semibold text-[#53616a] transition hover:bg-[#f7f9fa]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex shrink-0 items-center gap-1.5 self-center">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setReschedulingId(followUp.id);
                                setRescheduleDueAt(toLocalInputValue(followUp.dueAt));
                              }}
                              className="h-7 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] font-semibold text-[#53616a] transition hover:bg-[#f7f9fa] disabled:opacity-60"
                            >
                              Reschedule
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleComplete(followUp.id)}
                              className="h-7 shrink-0 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] font-semibold text-[#53616a] transition hover:bg-[#f7f9fa] disabled:opacity-60"
                            >
                              Complete
                            </button>
                          </div>
                        )
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="rounded-xl bg-white p-5 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
            <h2 className="text-xs font-semibold text-[#2b3841]">Primary contact</h2>
            <div className="mt-4 flex items-center gap-3">
              <Avatar name={opportunity.contactName} size="md" />
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold text-[#35424b]">
                  {opportunity.contactName}
                </p>
                {opportunity.contactEmail ? (
                  <p className="truncate text-[9px] text-[#909aa1]">{opportunity.contactEmail}</p>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-xl bg-white p-5 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold text-[#2b3841]">Open work</h2>
              <Link href="/crm/followups" className="text-[9px] font-bold text-[#128c80]">
                All follow-ups
              </Link>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg bg-[#f6f8f9] px-2 py-3">
                <p className="text-[19px] font-semibold tracking-[-0.04em] text-[#17242d]">
                  {pending.length}
                </p>
                <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#8b969e]">
                  Pending
                </p>
              </div>
              <div
                className={`rounded-lg px-2 py-3 ${
                  pending.some((action) => action.dueAt.getTime() < now)
                    ? 'bg-[#fff0f1]'
                    : 'bg-[#f6f8f9]'
                }`}
              >
                <p
                  className={`text-[19px] font-semibold tracking-[-0.04em] ${
                    pending.some((action) => action.dueAt.getTime() < now)
                      ? 'text-[#be3d45]'
                      : 'text-[#17242d]'
                  }`}
                >
                  {pending.filter((action) => action.dueAt.getTime() < now).length}
                </p>
                <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#8b969e]">
                  Overdue
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-xl bg-white p-5 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold text-[#2b3841]">Commercial document</h2>
              <Badge value="QUOTATION" />
            </div>
            {latestQuotation ? (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/crm/quotations/${latestQuotation.id}`}
                    className="text-[13px] font-bold text-[#188c81] hover:underline"
                  >
                    {latestQuotation.quoteNumber}
                  </Link>
                  <span
                    className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-bold tracking-[0.06em] ${QUOTATION_STATUS_CHIP[latestQuotation.status]}`}
                  >
                    {latestQuotation.status}
                  </span>
                </div>
                <p className="mt-2 text-[19px] font-semibold tracking-[-0.04em] text-[#17242d]">
                  {latestQuotation.totalAmount.toLocaleString('en-EG', {
                    style: 'currency',
                    currency: 'EGP',
                    maximumFractionDigits: 0,
                  })}
                </p>
                <p className="mt-1 text-[9px] text-[#8b969e]">
                  {latestQuotation.sentAt
                    ? `Sent ${latestQuotation.sentAt.toLocaleDateString()}`
                    : `Updated ${latestQuotation.updatedAt.toLocaleDateString()}`}
                  {latestQuotation.version > 1 ? ` · version ${latestQuotation.version}` : null}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Link
                    href={`/crm/quotations/${latestQuotation.id}`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dbe2e5] bg-white px-2.5 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
                  >
                    <CrmIcon name="quotation" className="h-3 w-3" />
                    Open quotation
                  </Link>
                  <Link
                    href={`/crm/quotations/${latestQuotation.id}/print`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dbe2e5] bg-white px-2.5 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
                  >
                    <CrmIcon name="external" className="h-3 w-3" />
                    Print view
                  </Link>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-[10px] leading-4 text-[#8b969e]">
                {canCreateQuotation
                  ? 'No quotation yet. Create one to price this deal.'
                  : 'No quotation on record for this deal.'}
              </p>
            )}
          </section>

          <section className="rounded-xl bg-white p-5 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
            <h2 className="text-xs font-semibold text-[#2b3841]">Stage history</h2>
            <p className="mt-0.5 text-[9px] text-[#8b969e]">
              Append-only record of how this deal progressed
            </p>
            {stageHistory.length === 0 ? (
              <p className="mt-3 text-[10px] text-[#8b969e]">No stage changes recorded yet.</p>
            ) : (
              <ol className="mt-4 space-y-3">
                {stageHistory.map((entry) => (
                  <li key={entry.id} className="relative pl-4">
                    <span
                      aria-hidden
                      className="absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full bg-[#18b6a4]"
                    />
                    <p className="text-[10px] font-semibold text-[#33414a]">
                      {entry.fromStage ? `${STAGE_LABELS[entry.fromStage]} → ` : ''}
                      {STAGE_LABELS[entry.toStage]}
                    </p>
                    <p className="mt-0.5 text-[9px] text-[#8b969e]">
                      {entry.changedByName ?? 'System'} ·{' '}
                      {entry.changedAt.toLocaleDateString()}{' '}
                      {entry.changedAt.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                    {entry.note && (
                      <p className="mt-1 text-[9px] leading-4 text-[#6b7681]">{entry.note}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[#edf0f1] py-2.5 last:border-b-0">
      <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#9aa3aa]">{label}</p>
      <p className="mt-0.5 text-[11px] font-medium text-[#33414a]">{value}</p>
    </div>
  );
}
