'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Avatar, PageHeader } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import {
  isNotReached,
  type FollowUpActionType,
  type FollowUpOutcome,
} from '@/server/crm/opportunities/followup-actions';
import {
  completeFollowUpAction,
  createFollowUpAction,
  createLeadFollowUpAction,
} from '@/server/crm/opportunities/actions';
import { FollowUpResultBadge, FollowUpResultFields } from '@/components/crm/FollowUpResult';
import type { FollowUpListRow, FollowUpWindow } from '@/server/crm/opportunities/followups';
import { useFormatters, useMessages } from '@/i18n/I18nProvider';

const WINDOWS: FollowUpWindow[] = ['overdue', 'today', 'upcoming', 'completed'];

/** datetime-local wants "YYYY-MM-DDTHH:mm" in the browser's own timezone. */
function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** The next try's default: this time tomorrow. Read when a dialog opens. */
function sameTimeTomorrow(): string {
  return toLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000));
}

const ACTION_ICON: Record<FollowUpActionType, 'phone' | 'message' | 'meeting' | 'quotation' | 'activity' | 'clock'> = {
  CALL: 'phone',
  WHATSAPP: 'message',
  MEETING: 'meeting',
  SEND_QUOTATION: 'quotation',
  FOLLOW_UP: 'activity',
  OTHER: 'clock',
};

interface FollowUpsListProps {
  followUps: FollowUpListRow[];
  total: number;
  page: number;
  limit: number;
  window: FollowUpWindow;
  counts: { overdue: number; today: number; upcoming: number; completed: number };
}

export function FollowUpsList({ followUps, total, page, limit, window, counts }: FollowUpsListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const m = useMessages();
  const format = useFormatters();
  const t = m.followUps;

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Completion records the result; nobody answering books the next try.
  const [completing, setCompleting] = useState<FollowUpListRow | null>(null);
  const [completionNote, setCompletionNote] = useState('');
  const [completionOutcome, setCompletionOutcome] = useState<FollowUpOutcome | null>(null);
  const [nextTry, setNextTry] = useState(false);
  const [nextTryAt, setNextTryAt] = useState('');

  const totalPages = Math.ceil(total / limit);

  const pushParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    router.push(`/crm/followups?${params.toString()}`);
  };

  const handleWindowChange = (next: FollowUpWindow) => {
    pushParams((params) => {
      if (next === 'upcoming') params.delete('window');
      else params.set('window', next);
      params.delete('page');
    });
  };

  const openComplete = (row: FollowUpListRow) => {
    setCompleting(row);
    setCompletionNote('');
    setCompletionOutcome(null);
    setNextTry(false);
    setNextTryAt(sameTimeTomorrow());
    setError(null);
  };

  const handleCompleteSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!completing) return;
    if (completionOutcome === null) {
      setError(m.followUp.resultRequired);
      return;
    }
    const nextDue = nextTry ? new Date(nextTryAt) : null;
    if (nextDue !== null && Number.isNaN(nextDue.getTime())) {
      setError(m.followUp.dueUnreadable);
      return;
    }
    setBusyId(completing.id);
    setError(null);
    try {
      const result = await completeFollowUpAction(completing.id, {
        outcome: completionOutcome,
        completionNote: completionNote.trim() || null,
      });
      if (result.ok === false) {
        setError(result.message);
        return;
      }
      if (nextDue !== null) {
        const input = { actionType: completing.actionType, note: null, dueAt: nextDue.toISOString() };
        const next =
          completing.parentKind === 'lead' && completing.leadId
            ? await createLeadFollowUpAction(completing.leadId, input)
            : completing.opportunityId
              ? await createFollowUpAction(completing.opportunityId, input)
              : null;
        if (next && next.ok === false) {
          setError(next.message);
          return;
        }
      }
      setCompleting(null);
      router.refresh();
    } catch {
      setError(m.followUp.actionFailed);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.heading}
        description={t.description}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {WINDOWS.map((entry) => {
          const isActive = window === entry;
          const isOverdue = entry === 'overdue';
          return (
            <button
              key={entry}
              type="button"
              onClick={() => handleWindowChange(entry)}
              className={`rounded-xl bg-white p-4 text-start shadow-[0_1px_2px_rgba(20,35,45,0.04)] transition ${
                isActive
                  ? 'ring-2 ring-[#18b6a4]'
                  : isOverdue && counts.overdue > 0
                    ? 'ring-1 ring-[#f0c5c8] hover:ring-[#e5aeb2]'
                    : 'ring-1 ring-[#e4e9eb] hover:ring-[#cfd8dc]'
              }`}
            >
              <p className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#7e8992]">
                {t.windows[entry]}
              </p>
              <p
                className={`mt-2.5 text-[25px] font-semibold tracking-[-0.045em] ${
                  isOverdue && counts.overdue > 0 ? 'text-[#be3d45]' : 'text-[#17242c]'
                }`}
              >
                {counts[entry]}
              </p>
            </button>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-[#fff0f1] px-3.5 py-2.5 text-[11px] font-semibold text-[#b83c43] ring-1 ring-[#f0c5c8]">
          {error}
        </p>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,.04)] ring-1 ring-[#dfe5e8]">
        <div className="divide-y divide-[#edf0f1]">
          {followUps.length === 0 ? (
            <p className="px-5 py-12 text-center text-[11px] text-[#89949c]">
              {window === 'overdue' ? t.emptyOverdue : window === 'completed' ? t.emptyCompleted : t.emptyWindow}
            </p>
          ) : (
            followUps.map((followUp) => (
              <div
                key={followUp.id}
                className={`flex flex-wrap items-center gap-3.5 px-5 py-4 transition hover:bg-[#f9fbfb] ${
                  followUp.isOverdue ? 'bg-[#fffafb]' : ''
                }`}
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                    followUp.isOverdue
                      ? 'bg-[#fff0f1] text-[#c43f47]'
                      : followUp.completedAt
                        ? 'bg-[#e9f7f1] text-[#14815f]'
                        : 'bg-[#edf6f5] text-[#16877b]'
                  }`}
                >
                  <CrmIcon
                    name={followUp.completedAt ? 'check' : ACTION_ICON[followUp.actionType]}
                    className="h-4 w-4"
                  />
                </span>

                <div className="min-w-[190px] flex-1">
                  <p className="text-[11px] font-semibold text-[#202e37]">
                    {m.followUpTypes[followUp.actionType]}
                    {followUp.isOverdue ? (
                      <span className="ms-2 rounded-full bg-[#ffeaeb] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-[#bd3941]">
                        {m.followUp.overdue}
                      </span>
                    ) : null}
                  </p>
                  {followUp.outcome ? (
                    <p className="mt-1">
                      <FollowUpResultBadge outcome={followUp.outcome} />
                    </p>
                  ) : null}
                  {followUp.note ? (
                    <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#74818a]">
                      {followUp.note}
                    </p>
                  ) : null}
                </div>

                <div className="min-w-[150px]">
                  <Link
                    href={
                      followUp.parentKind === 'lead'
                        ? `/crm/leads/${followUp.leadId}`
                        : `/crm/opportunities/${followUp.opportunityId}`
                    }
                    className="block truncate text-[10px] font-semibold text-[#188c81] hover:underline"
                  >
                    {followUp.accountName ?? followUp.contactName}
                  </Link>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[9px] text-[#8b969e]">
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.06em] ${
                        followUp.parentKind === 'lead'
                          ? 'bg-[#eef0ff] text-[#5b63b8]'
                          : 'bg-[#e8f4ff] text-[#287bb5]'
                      }`}
                    >
                      {followUp.parentKind === 'lead' ? t.lead : t.deal}
                    </span>
                    <Avatar name={followUp.ownerName} size="sm" />
                    {followUp.ownerName}
                  </p>
                </div>

                <div className="min-w-[110px] text-end">
                  <p
                    className={`whitespace-nowrap text-[10px] font-semibold ${
                      followUp.isOverdue ? 'text-[#bd454b]' : 'text-[#4e5c66]'
                    }`}
                  >
                    {format.date(followUp.dueAt)}
                  </p>
                  <p className="mt-0.5 whitespace-nowrap text-[9px] text-[#929da4]">
                    {format.time(followUp.dueAt)}
                  </p>
                </div>

                {followUp.completedAt ? (
                  <span className="w-[92px] text-end text-[9px] font-bold uppercase tracking-[0.08em] text-[#14815f]">
                    {m.followUp.completed}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === followUp.id}
                    onClick={() => openComplete(followUp)}
                    className="h-8 w-[92px] rounded-lg bg-[#132932] text-[10px] font-bold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
                  >
                    {busyId === followUp.id ? m.followUp.saving : m.followUp.complete}
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[#edf0f1] px-5 py-3">
          <p className="text-[10px] text-[#89949c]">
            {total === 0
              ? t.noActions
              : t.showing(Math.min((page - 1) * limit + 1, total), Math.min(page * limit, total), total)}
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => pushParams((params) => params.set('page', String(page - 1)))}
              className="h-7 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] text-[#9aa3aa] transition hover:bg-[#f7f9fa] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.previous}
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => pushParams((params) => params.set('page', String(page + 1)))}
              className="h-7 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] font-semibold text-[#53616a] transition hover:bg-[#f7f9fa] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.next}
            </button>
          </div>
        </div>
      </div>

      {completing ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#0e1c24]/40 px-4">
          <form
            onSubmit={handleCompleteSubmit}
            role="dialog"
            aria-modal="true"
            aria-label={m.followUp.completeTitle}
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-[0_20px_60px_rgba(15,30,40,0.25)]"
          >
            <h2 className="text-sm font-semibold text-[#202d35]">{m.followUp.completeTitle}</h2>
            <p className="mt-1 text-[10px] text-[#7b8790]">
              {t.completeSubtitle(
                m.followUpTypes[completing.actionType],
                completing.accountName ?? completing.contactName,
                format.date(completing.dueAt),
              )}
            </p>

            <FollowUpResultFields
              outcome={completionOutcome}
              onOutcomeChange={(outcome) => {
                setCompletionOutcome(outcome);
                if (isNotReached(outcome)) setNextTry(true);
              }}
              note={completionNote}
              onNoteChange={setCompletionNote}
            />

            <label className="mt-3 flex items-center gap-2 text-[10px] font-semibold text-[#53616a]">
              <input
                type="checkbox"
                checked={nextTry}
                onChange={(event) => setNextTry(event.target.checked)}
                className="h-3.5 w-3.5 accent-[#18b6a4]"
              />
              {m.followUp.scheduleNextTry}
            </label>
            {nextTry ? (
              <label className="mt-2 block rounded-lg bg-[#f6f8f9] p-3">
                <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#9aa3aa]">
                  {m.followUp.nextTryAt}
                </span>
                <input
                  type="datetime-local"
                  value={nextTryAt}
                  onChange={(event) => setNextTryAt(event.target.value)}
                  className="mt-1 h-8 w-full rounded-md border border-[#dce2e5] bg-white px-2 text-[10px] text-[#3c4a54] outline-none focus:border-[#18b6a4]"
                />
              </label>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCompleting(null)}
                className="h-8 rounded-lg border border-[#dfe4e7] px-3 text-[10px] font-semibold text-[#53616a] transition hover:bg-[#f7f9fa]"
              >
                {m.common.cancel}
              </button>
              <button
                type="submit"
                disabled={busyId === completing.id || completionOutcome === null}
                className="h-8 rounded-lg bg-[#132932] px-3.5 text-[10px] font-bold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
              >
                {busyId === completing.id ? m.followUp.saving : m.followUp.complete}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
