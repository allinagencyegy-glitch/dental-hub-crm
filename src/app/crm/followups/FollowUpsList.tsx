'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Avatar, PageHeader } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import {
  ACTION_TYPE_LABELS,
  type FollowUpActionType,
} from '@/server/crm/opportunities/followup-actions';
import { completeFollowUpAction } from '@/server/crm/opportunities/actions';
import type { FollowUpListRow, FollowUpWindow } from '@/server/crm/opportunities/followups';

const WINDOWS: { value: FollowUpWindow; label: string; countKey: 'overdue' | 'today' | 'upcoming' | 'completed' }[] = [
  { value: 'overdue', label: 'Overdue', countKey: 'overdue' },
  { value: 'today', label: 'Today', countKey: 'today' },
  { value: 'upcoming', label: 'Upcoming', countKey: 'upcoming' },
  { value: 'completed', label: 'Completed', countKey: 'completed' },
];

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

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Completion captures the outcome; the API refuses an empty note.
  const [completing, setCompleting] = useState<FollowUpListRow | null>(null);
  const [completionNote, setCompletionNote] = useState('');

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
    setError(null);
  };

  const handleCompleteSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!completing) return;
    if (!completionNote.trim()) {
      setError('Add a short outcome before completing.');
      return;
    }
    setBusyId(completing.id);
    setError(null);
    try {
      const result = await completeFollowUpAction(completing.id, {
        completionNote: completionNote.trim(),
      });
      if (result.ok === false) {
        setError(result.message);
        return;
      }
      setCompleting(null);
      router.refresh();
    } catch {
      setError('That action could not be completed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Next actions"
        title="Follow-ups"
        description="What you promised, and when it is due. Completed actions stay on the record."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {WINDOWS.map((entry) => {
          const isActive = window === entry.value;
          const isOverdue = entry.value === 'overdue';
          return (
            <button
              key={entry.value}
              type="button"
              onClick={() => handleWindowChange(entry.value)}
              className={`rounded-xl bg-white p-4 text-start shadow-[0_1px_2px_rgba(20,35,45,0.04)] transition ${
                isActive
                  ? 'ring-2 ring-[#18b6a4]'
                  : isOverdue && counts.overdue > 0
                    ? 'ring-1 ring-[#f0c5c8] hover:ring-[#e5aeb2]'
                    : 'ring-1 ring-[#e4e9eb] hover:ring-[#cfd8dc]'
              }`}
            >
              <p className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#7e8992]">
                {entry.label}
              </p>
              <p
                className={`mt-2.5 text-[25px] font-semibold tracking-[-0.045em] ${
                  isOverdue && counts.overdue > 0 ? 'text-[#be3d45]' : 'text-[#17242c]'
                }`}
              >
                {counts[entry.countKey]}
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
              {window === 'overdue'
                ? 'Nothing overdue. Every promised action is on time.'
                : window === 'completed'
                  ? 'No actions completed yet.'
                  : 'No actions scheduled in this window.'}
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
                    {ACTION_TYPE_LABELS[followUp.actionType]}
                    {followUp.isOverdue ? (
                      <span className="ms-2 rounded-full bg-[#ffeaeb] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-[#bd3941]">
                        Overdue
                      </span>
                    ) : null}
                  </p>
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
                      {followUp.parentKind === 'lead' ? 'Lead' : 'Deal'}
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
                    {followUp.dueAt.toLocaleDateString()}
                  </p>
                  <p className="mt-0.5 whitespace-nowrap text-[9px] text-[#929da4]">
                    {followUp.dueAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>

                {followUp.completedAt ? (
                  <span className="w-[92px] text-end text-[9px] font-bold uppercase tracking-[0.08em] text-[#14815f]">
                    Completed
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === followUp.id}
                    onClick={() => openComplete(followUp)}
                    className="h-8 w-[92px] rounded-lg bg-[#132932] text-[10px] font-bold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
                  >
                    {busyId === followUp.id ? 'Saving…' : 'Complete'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[#edf0f1] px-5 py-3">
          <p className="text-[10px] text-[#89949c]">
            {total === 0
              ? 'No actions'
              : `Showing ${Math.min((page - 1) * limit + 1, total)}–${Math.min(page * limit, total)} of ${total}`}
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => pushParams((params) => params.set('page', String(page - 1)))}
              className="h-7 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] text-[#9aa3aa] transition hover:bg-[#f7f9fa] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => pushParams((params) => params.set('page', String(page + 1)))}
              className="h-7 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] font-semibold text-[#53616a] transition hover:bg-[#f7f9fa] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
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
            aria-label="Complete follow-up"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-[0_20px_60px_rgba(15,30,40,0.25)]"
          >
            <h2 className="text-sm font-semibold text-[#202d35]">Complete follow-up</h2>
            <p className="mt-1 text-[10px] text-[#7b8790]">
              {ACTION_TYPE_LABELS[completing.actionType]} ·{' '}
              {completing.accountName ?? completing.contactName} · due{' '}
              {completing.dueAt.toLocaleDateString()}
            </p>

            <label className="mt-4 block">
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9aa3aa]">
                Outcome (required)
              </span>
              <textarea
                value={completionNote}
                onChange={(event) => setCompletionNote(event.target.value)}
                rows={3}
                required
                autoFocus
                placeholder="What actually happened on this action?"
                className="mt-1.5 w-full rounded-lg border border-[#dce2e5] bg-white px-3 py-2 text-[11px] text-[#33414a] outline-none focus:border-[#18b6a4]"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCompleting(null)}
                className="h-8 rounded-lg border border-[#dfe4e7] px-3 text-[10px] font-semibold text-[#53616a] transition hover:bg-[#f7f9fa]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyId === completing.id || completionNote.trim().length === 0}
                className="h-8 rounded-lg bg-[#132932] px-3.5 text-[10px] font-bold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
              >
                {busyId === completing.id ? 'Saving…' : 'Complete'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
