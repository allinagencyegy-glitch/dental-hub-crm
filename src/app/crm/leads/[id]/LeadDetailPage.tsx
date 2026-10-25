'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, BackLink, Badge, InfoLine } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { markLeadContactedAction, disqualifyLeadAction, archiveLeadAction, restoreLeadAction, linkLeadToAccountAction } from '@/server/crm/leads/actions';
import { qualifyLeadAction, createLeadFollowUpAction, completeFollowUpAction } from '@/server/crm/opportunities/actions';
import {
  ACTION_TYPE_LABELS,
  FOLLOW_UP_ACTION_TYPES,
  type FollowUpActionType,
} from '@/server/crm/opportunities/followup-actions';
import type { FollowUp } from '@/server/crm/opportunities/followups';
import type { LeadDetail } from '@/server/crm/leads/repository';
import type { BadgeValue } from '@/components/crm/Ui';

interface DisqualifyReason {
  id: string;
  code: string;
  label: string;
  requiresNote: boolean;
}

/** datetime-local wants "YYYY-MM-DDTHH:mm" in the browser's own timezone. */
function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

interface LeadDetailPageProps {
  lead: LeadDetail;
  disqualifyReasons: DisqualifyReason[];
  accounts: { id: string; name: string }[];
  userRole: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP';
  userId: string;
  opportunityId: string | null;
  qualifiedAt: Date | null;
  followUps: FollowUp[];
  /** Server render time, in epoch millis. Stable across client re-renders. */
  now: number;
}

export function LeadDetailPage({ lead, disqualifyReasons, accounts, userRole, userId, opportunityId, qualifiedAt, followUps, now }: LeadDetailPageProps) {
  const router = useRouter();

  const [disqualifyOpen, setDisqualifyOpen] = useState(false);
  const [disqualifyReasonId, setDisqualifyReasonId] = useState('');
  const [disqualifyNote, setDisqualifyNote] = useState('');
  const [disqualifySubmitting, setDisqualifySubmitting] = useState(false);
  const [disqualifyError, setDisqualifyError] = useState<string | null>(null);
  const [contactedSubmitting, setContactedSubmitting] = useState(false);
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);
  const [restoreSubmitting, setRestoreSubmitting] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Qualification. estimatedValue is sent as a string and parsed here so the
  // server action receives the number type the domain expects.
  const [qualifyOpen, setQualifyOpen] = useState(false);
  const [qualifyValue, setQualifyValue] = useState('');
  const [qualifyNote, setQualifyNote] = useState('');
  const [qualifySubmitting, setQualifySubmitting] = useState(false);
  const [qualifyError, setQualifyError] = useState<string | null>(null);

  // Account / clinic workflow.
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountMode, setAccountMode] = useState<'link' | 'create'>('link');
  const [accountSelectId, setAccountSelectId] = useState('');
  const [accountNewName, setAccountNewName] = useState('');
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  const selectedReason = disqualifyReasons.find((r) => r.id === disqualifyReasonId);
  const requiresNote = selectedReason?.requiresNote ?? false;
  const isArchived = lead.archivedAt !== null;

  // Lead-level next actions: a promise made before the lead is qualified.
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpType, setFollowUpType] = useState<FollowUpActionType>('CALL');
  const [followUpNote, setFollowUpNote] = useState('');
  const [followUpDueAt, setFollowUpDueAt] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
  );
  const [followUpSubmitting, setFollowUpSubmitting] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);

  const [completing, setCompleting] = useState<FollowUp | null>(null);
  const [completionNote, setCompletionNote] = useState('');
  const [completingSubmitting, setCompletingSubmitting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const canMutate = userRole !== 'SALES_REP' || lead.ownerUserId === userId;
  // A disqualified lead is dead, so it can never become commercial work.
  const canQualify =
    !isArchived && opportunityId === null && lead.status !== 'DISQUALIFIED';
  const canScheduleFollowUp = canMutate && !isArchived && lead.status !== 'DISQUALIFIED';

  const pendingFollowUps = followUps
    .filter((followUp) => followUp.completedAt === null)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const completedFollowUps = followUps
    .filter((followUp) => followUp.completedAt !== null)
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));

  const handleScheduleFollowUp = async (event: FormEvent) => {
    event.preventDefault();
    if (!followUpDueAt) {
      setFollowUpError('Choose when this action is due.');
      return;
    }
    const dueAt = new Date(followUpDueAt);
    if (Number.isNaN(dueAt.getTime())) {
      setFollowUpError('That due date could not be read.');
      return;
    }
    setFollowUpSubmitting(true);
    setFollowUpError(null);
    try {
      const result = await createLeadFollowUpAction(lead.id, {
        actionType: followUpType,
        note: followUpNote.trim() || null,
        dueAt: dueAt.toISOString(),
      });
      if (result.ok === false) {
        setFollowUpError(result.message);
        return;
      }
      setFollowUpOpen(false);
      setFollowUpNote('');
      setFollowUpType('CALL');
      router.refresh();
    } catch {
      setFollowUpError('That action could not be scheduled.');
    } finally {
      setFollowUpSubmitting(false);
    }
  };

  const openComplete = (followUp: FollowUp) => {
    setCompleting(followUp);
    setCompletionNote('');
    setCompleteError(null);
  };

  const handleCompleteSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!completing) return;
    if (!completionNote.trim()) {
      setCompleteError('Add a short outcome before completing.');
      return;
    }
    setCompletingSubmitting(true);
    setCompleteError(null);
    try {
      const result = await completeFollowUpAction(completing.id, {
        completionNote: completionNote.trim(),
      });
      if (result.ok === false) {
        setCompleteError(result.message);
        return;
      }
      setCompleting(null);
      router.refresh();
    } catch {
      setCompleteError('That action could not be completed.');
    } finally {
      setCompletingSubmitting(false);
    }
  };

  const handleMarkContacted = async () => {
    setContactedSubmitting(true);
    try {
      const result = await markLeadContactedAction(lead.id);
      if (result.ok) {
        window.location.reload();
      }
    } catch {
      // Error handling could be improved with toast notifications
    } finally {
      setContactedSubmitting(false);
    }
  };

  const handleDisqualify = async () => {
    if (!disqualifyReasonId) {
      setDisqualifyError('Please select a reason');
      return;
    }
    if (requiresNote && !disqualifyNote.trim()) {
      setDisqualifyError('This reason requires a note');
      return;
    }

    setDisqualifySubmitting(true);
    setDisqualifyError(null);
    try {
      const result = await disqualifyLeadAction(lead.id, {
        reasonId: disqualifyReasonId,
        note: disqualifyNote.trim() || null,
      });
      if (result.ok) {
        window.location.reload();
      } else {
        setDisqualifyError(result.message);
      }
    } catch {
      setDisqualifyError('An unexpected error occurred');
    } finally {
      setDisqualifySubmitting(false);
    }
  };

  const handleArchive = async () => {
    setArchiveSubmitting(true);
    try {
      const result = await archiveLeadAction(lead.id);
      if (result.ok) {
        window.location.reload();
      }
    } catch {
      // Error handling could be improved with toast notifications
    } finally {
      setArchiveSubmitting(false);
    }
  };

  const handleRestore = async () => {
    setRestoreSubmitting(true);
    setRestoreError(null);
    try {
      const result = await restoreLeadAction(lead.id);
      if (result.ok) {
        window.location.reload();
      } else {
        setRestoreError(result.message);
      }
    } catch {
      setRestoreError('That lead could not be restored.');
    } finally {
      setRestoreSubmitting(false);
    }
  };

  const handleQualify = async () => {
    const trimmed = qualifyValue.trim();
    let estimatedValue: number | null = null;
    if (trimmed !== '') {
      const parsed = Number(trimmed);
      if (Number.isNaN(parsed) || parsed < 0) {
        setQualifyError('Estimated value must be zero or more');
        return;
      }
      estimatedValue = parsed;
    }

    setQualifySubmitting(true);
    setQualifyError(null);
    try {
      const result = await qualifyLeadAction(lead.id, {
        estimatedValue,
        notes: qualifyNote.trim() || null,
      });
      if (result.ok) {
        // Send the salesperson straight into the new deal: the whole point of
        // qualifying is to start working it.
        router.push(`/crm/opportunities/${result.opportunity.id}`);
        router.refresh();
      } else {
        setQualifyError(result.message);
      }
    } catch {
      setQualifyError('An unexpected error occurred');
    } finally {
      setQualifySubmitting(false);
    }
  };

  const handleLinkAccount = async () => {
    const mode = accountMode;
    if (mode === 'link' && !accountSelectId) {
      setAccountError('Choose a clinic to link.');
      return;
    }
    if (mode === 'create' && accountNewName.trim() === '') {
      setAccountError('Enter a clinic name.');
      return;
    }

    setAccountSubmitting(true);
    setAccountError(null);
    try {
      const result = await linkLeadToAccountAction(lead.id, {
        accountId: mode === 'link' ? accountSelectId : null,
        newAccountName: mode === 'create' ? accountNewName.trim() : null,
      });
      if (result.ok) {
        setAccountOpen(false);
        setAccountSelectId('');
        setAccountNewName('');
        router.refresh();
      } else {
        setAccountError(result.message);
      }
    } catch {
      setAccountError('An unexpected error occurred');
    } finally {
      setAccountSubmitting(false);
    }
  };

  return (
    <>
      <BackLink href="/crm/leads" label="Back to lead inbox" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={lead.contactName} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[25px] font-semibold tracking-[-0.035em] text-[#1c2831]">{lead.contactName}</h1>
              <Badge value={lead.status as BadgeValue} dot />
              {isArchived && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#fff3e0] px-2 py-0.5 text-[10px] font-semibold text-[#c47c00]">
                  <CrmIcon name="archive" className="h-3 w-3" />
                  Archived
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-[#8a959d]">Lead reference {lead.id.slice(0, 8)}</p>
          </div>
        </div>
        {canMutate && (
          <div>
            <p className="mb-1.5 text-end text-[9px] font-medium text-[#8a959d]">Lead actions</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Link
                href={`/crm/leads/${lead.id}/edit`}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#dce2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
              >
                <CrmIcon name="edit" className="h-3.5 w-3.5" />
                Edit
              </Link>
              {!isArchived && (
                <>
                  {lead.status === 'NEW' && (
                    <button
                      type="button"
                      onClick={handleMarkContacted}
                      disabled={contactedSubmitting}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#18b6a4] px-3 text-[11px] font-semibold text-white transition hover:bg-[#128d81] disabled:opacity-50"
                    >
                      <CrmIcon name="check" className="h-3.5 w-3.5" />
                      Mark contacted
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDisqualifyOpen(true)}
                    disabled={disqualifySubmitting || lead.status === 'DISQUALIFIED'}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#dce2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa] disabled:opacity-50"
                  >
                    <CrmIcon name="x" className="h-3.5 w-3.5" />
                    Disqualify
                  </button>
                  {(lead.status === 'NEW' || lead.status === 'CONTACTED') && (
                    opportunityId ? (
                      <Link
                        href={`/crm/opportunities/${opportunityId}`}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#18b6a4] px-3 text-[11px] font-semibold text-white transition hover:bg-[#128d81]"
                      >
                        <CrmIcon name="opportunities" className="h-3.5 w-3.5" />
                        View opportunity
                      </Link>
                    ) : !isArchived ? (
                      <button
                        type="button"
                        onClick={() => setQualifyOpen((open) => !open)}
                        disabled={qualifySubmitting}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#18b6a4] px-3 text-[11px] font-semibold text-white transition hover:bg-[#128d81] disabled:opacity-50"
                      >
                        <CrmIcon name="opportunities" className="h-3.5 w-3.5" />
                        Qualify
                      </button>
                    ) : null
                  )}
                  <button
                    type="button"
                    onClick={handleArchive}
                    disabled={archiveSubmitting}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#f4c7ca] bg-[#fff8f0] px-3 text-[11px] font-semibold text-[#c47c00] transition hover:bg-[#ffe9d9] disabled:opacity-50"
                  >
                    <CrmIcon name="archive" className="h-3.5 w-3.5" />
                    Archive
                  </button>
                </>
              )}
              {isArchived && (
                <button
                  type="button"
                  onClick={handleRestore}
                  disabled={restoreSubmitting}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#18b6a4] px-3 text-[11px] font-semibold text-white transition hover:bg-[#128d81] disabled:opacity-50"
                >
                  <CrmIcon name="unarchive" className="h-3.5 w-3.5" />
                  Restore
                </button>
              )}
            </div>
            {restoreError ? (
              <p role="alert" className="mt-2 text-[11px] font-semibold text-[#b83c43]">
                {restoreError}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {qualifyOpen && canQualify && (
        <div className="mt-4 rounded-xl border border-[#dfe5e8] bg-white p-5">
          <h2 className="text-sm font-semibold text-[#1c2831]">Qualify this lead</h2>
          <p className="mt-0.5 text-[10px] text-[#8a959d]">
            Creates a commercial opportunity owned by {lead.ownerName}, starting at stage
            Qualified. A lead can only be qualified once.
          </p>
          {qualifyError && (
            <p role="alert" className="mt-3 rounded-lg bg-[#fff0f1] px-3 py-2 text-[11px] font-semibold text-[#b83c43] ring-1 ring-[#f0c5c8]">
              {qualifyError}
            </p>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">
                Estimated value (EGP)
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={qualifyValue}
                onChange={(e) => setQualifyValue(e.target.value)}
                placeholder="Optional"
                className="mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#3c4a54] outline-none placeholder:text-[#a4aeb5] focus:border-[#18b6a4]"
              />
            </label>
            <label className="block">
              <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">
                Sales context
              </span>
              <input
                type="text"
                value={qualifyNote}
                onChange={(e) => setQualifyNote(e.target.value)}
                placeholder="Why is this worth pursuing?"
                className="mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#3c4a54] outline-none placeholder:text-[#a4aeb5] focus:border-[#18b6a4]"
              />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleQualify}
              disabled={qualifySubmitting}
              className="rounded-lg bg-[#132932] px-3.5 py-2 text-[10px] font-bold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
            >
              {qualifySubmitting ? 'Qualifying…' : 'Create opportunity'}
            </button>
            <button
              type="button"
              onClick={() => {
                setQualifyOpen(false);
                setQualifyError(null);
              }}
              className="rounded-lg border border-[#dbe2e5] bg-white px-3.5 py-2 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-xl bg-white border border-[#dfe5e8] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#1c2831]">Lead overview</h2>
                <p className="mt-1 text-[10px] text-[#8a959d]">Captured {lead.receivedAt.toLocaleDateString()} at {lead.receivedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">Source</span>
                <Badge value={lead.sourceName as BadgeValue} />
              </div>
            </div>
            <div className="mt-5 grid gap-x-8 border-t border-[#e5eaec] pt-3 sm:grid-cols-2">
              <InfoLine icon="phone" label="Phone" value={lead.contactPhone ?? 'Not provided'} />
              <InfoLine icon="mail" label="Email" value={lead.contactEmail ?? 'Not provided'} />
              <InfoLine icon="sparkles" label="Product interest" value={lead.productCategoryName ?? 'Not specified'} />
              <InfoLine icon="team" label="Assigned owner" value={lead.ownerName} />
              {lead.campaignName && <InfoLine icon="target" label="Campaign" value={lead.campaignName} />}
              {lead.accountName && <InfoLine icon="building" label="Account" value={lead.accountName} />}
            </div>
            {lead.note && (
              <div className="mt-3 rounded-lg bg-[#f7f9fa] p-4">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">Inquiry context</p>
                <p className="mt-2 text-[11px] leading-5 text-[#394750]">{lead.note}</p>
              </div>
            )}
          </section>

          <section className="rounded-xl bg-white border border-[#dfe5e8] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#1c2831]">Next actions</h2>
                <p className="mt-0.5 text-[10px] text-[#8a959d]">
                  What was promised on this lead, before it becomes a deal. Anything outstanding
                  here moves to the opportunity when the lead is qualified.
                </p>
              </div>
              {canScheduleFollowUp ? (
                <button
                  type="button"
                  onClick={() => {
                    setFollowUpOpen((open) => !open);
                    setFollowUpError(null);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dce2e5] bg-white px-3 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
                >
                  <CrmIcon name={followUpOpen ? 'x' : 'plus'} className="h-3.5 w-3.5" />
                  Schedule follow-up
                </button>
              ) : null}
            </div>

            {followUpOpen && canScheduleFollowUp ? (
              <form onSubmit={handleScheduleFollowUp} className="mt-4 rounded-lg border border-[#dfe5e8] bg-[#fbfcfc] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">
                      Action
                    </span>
                    <select
                      value={followUpType}
                      onChange={(event) => setFollowUpType(event.target.value as FollowUpActionType)}
                      className="mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#1c2831] focus:border-[#18b6a4]"
                    >
                      {FOLLOW_UP_ACTION_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {ACTION_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">
                      Due
                    </span>
                    <input
                      type="datetime-local"
                      value={followUpDueAt}
                      onChange={(event) => setFollowUpDueAt(event.target.value)}
                      className="mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#1c2831] focus:border-[#18b6a4]"
                    />
                  </label>
                </div>
                <label className="mt-3 block">
                  <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">
                    Note (optional)
                  </span>
                  <input
                    type="text"
                    value={followUpNote}
                    onChange={(event) => setFollowUpNote(event.target.value)}
                    placeholder="What will this action cover?"
                    className="mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#1c2831] placeholder:text-[#a4aeb5] focus:border-[#18b6a4]"
                  />
                </label>
                {followUpError ? (
                  <p role="alert" className="mt-2 text-[11px] font-semibold text-[#b83c43]">
                    {followUpError}
                  </p>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <button
                    type="submit"
                    disabled={followUpSubmitting}
                    className="rounded-lg bg-[#132932] px-3.5 py-2 text-[10px] font-bold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
                  >
                    {followUpSubmitting ? 'Scheduling…' : 'Schedule'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFollowUpOpen(false);
                      setFollowUpError(null);
                    }}
                    className="rounded-lg border border-[#dbe2e5] bg-white px-3.5 py-2 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}

            <div className="mt-4 border-t border-[#e5eaec] pt-4">
              {pendingFollowUps.length === 0 && completedFollowUps.length === 0 ? (
                <p className="text-[10px] text-[#8a959d]">No actions recorded on this lead yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {pendingFollowUps.map((followUp) => {
                    const overdue = followUp.dueAt.getTime() < now;
                    return (
                      <div key={followUp.id} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 text-[11px] font-semibold text-[#35424b]">
                            {ACTION_TYPE_LABELS[followUp.actionType]}
                            {overdue ? (
                              <span className="rounded-full bg-[#ffeaeb] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-[#bd3941]">
                                Overdue
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-[9px] text-[#8b969e]">
                            Due {followUp.dueAt.toLocaleDateString()}{' '}
                            {followUp.dueAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {followUp.note ? ` · ${followUp.note}` : null}
                          </p>
                        </div>
                        {canMutate && !isArchived ? (
                          <button
                            type="button"
                            onClick={() => openComplete(followUp)}
                            className="h-7 shrink-0 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] font-semibold text-[#53616a] transition hover:bg-[#f7f9fa]"
                          >
                            Complete
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                  {completedFollowUps.map((followUp) => (
                    <div key={followUp.id} className="flex items-center justify-between gap-3 opacity-70">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-[#35424b]">
                          {ACTION_TYPE_LABELS[followUp.actionType]}
                        </p>
                        <p className="mt-0.5 text-[9px] text-[#8b969e]">
                          Done {followUp.completedAt?.toLocaleDateString()}
                          {followUp.note ? ` · ${followUp.note}` : null}
                        </p>
                      </div>
                      <span className="shrink-0 text-[8px] font-bold uppercase tracking-[0.08em] text-[#14815f]">
                        Completed
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl bg-white border border-[#dfe5e8] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#1c2831]">Clinic / account</h2>
                <p className="mt-0.5 text-[10px] text-[#8a959d]">
                  The clinic this doctor works with. The contact may belong to several clinics;
                  this is the one the inquiry is tracked against.
                </p>
              </div>
              {canMutate && !isArchived ? (
                <button
                  type="button"
                  onClick={() => {
                    setAccountOpen((open) => !open);
                    setAccountError(null);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dce2e5] bg-white px-3 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
                >
                  <CrmIcon name={accountOpen ? 'x' : 'plus'} className="h-3.5 w-3.5" />
                  {lead.accountName ? 'Change clinic' : 'Link clinic'}
                </button>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3 border-t border-[#e5eaec] pt-4 sm:grid-cols-3">
              <div className="rounded-lg bg-[#f7f9fa] p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">Contact</p>
                <p className="mt-2 text-[11px] font-semibold text-[#1c2831]">{lead.contactName}</p>
                <p className="mt-1 text-[9px] font-medium text-[#188c81]">Resolved</p>
              </div>
              <div className="rounded-lg bg-[#f7f9fa] p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">Clinic</p>
                <p className="mt-2 text-[11px] font-semibold text-[#1c2831]">
                  {lead.accountName ?? 'No clinic linked'}
                </p>
                <p className="mt-1 text-[9px] font-medium text-[#188c81]">
                  {lead.accountName ? 'Linked' : 'Optional'}
                </p>
              </div>
              <div className="rounded-lg bg-[#f7f9fa] p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">Commercial</p>
                <p className="mt-2 text-[11px] font-semibold text-[#1c2831]">
                  {opportunityId ? (
                    <Link href={`/crm/opportunities/${opportunityId}`} className="text-[#188c81] hover:underline">
                      View opportunity
                    </Link>
                  ) : (
                    'Not qualified yet'
                  )}
                </p>
                <p className="mt-1 text-[9px] font-medium text-[#188c81]">
                  {qualifiedAt ? `Qualified ${qualifiedAt.toLocaleDateString()}` : 'Lead stage'}
                </p>
              </div>
            </div>

            {accountOpen && canMutate && !isArchived ? (
              <div className="mt-4 rounded-lg border border-[#dfe5e8] bg-[#fbfcfc] p-4">
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAccountMode('link')}
                    className={`rounded-lg px-3 py-1.5 text-[10px] font-semibold transition ${
                      accountMode === 'link' ? 'bg-[#132932] text-white' : 'bg-white text-[#53616b] ring-1 ring-[#dfe5e8]'
                    }`}
                  >
                    Link existing clinic
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountMode('create')}
                    className={`rounded-lg px-3 py-1.5 text-[10px] font-semibold transition ${
                      accountMode === 'create' ? 'bg-[#132932] text-white' : 'bg-white text-[#53616b] ring-1 ring-[#dfe5e8]'
                    }`}
                  >
                    Create new clinic
                  </button>
                </div>

                {accountMode === 'link' ? (
                  <div className="mt-3">
                    <label className="block text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                      Clinic
                    </label>
                    <select
                      value={accountSelectId}
                      onChange={(event) => setAccountSelectId(event.target.value)}
                      className="h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#1c2831] focus:border-[#18b6a4]"
                    >
                      <option value="">Choose a clinic…</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                    {accounts.length === 0 ? (
                      <p className="mt-1.5 text-[10px] text-[#8a959d]">
                        No clinics exist yet. Create the first one.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-3">
                    <label className="block text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                      Clinic name
                    </label>
                    <input
                      type="text"
                      value={accountNewName}
                      onChange={(event) => setAccountNewName(event.target.value)}
                      placeholder="e.g. Smile Dental Clinic"
                      className="h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#1c2831] focus:border-[#18b6a4]"
                    />
                  </div>
                )}

                {accountError ? (
                  <p role="alert" className="mt-2 text-[11px] font-semibold text-[#b83c43]">
                    {accountError}
                  </p>
                ) : null}

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={handleLinkAccount}
                    disabled={accountSubmitting}
                    className="rounded-lg bg-[#132932] px-3.5 py-2 text-[10px] font-bold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
                  >
                    {accountSubmitting ? 'Linking…' : 'Link clinic'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountOpen(false);
                      setAccountError(null);
                    }}
                    className="rounded-lg border border-[#dbe2e5] bg-white px-3.5 py-2 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-xl bg-white border border-[#dfe5e8] p-5">
            <h2 className="text-sm font-semibold text-[#1c2831]">Commercial timeline</h2>
            <p className="mt-0.5 text-[10px] text-[#8a959d]">What has happened to this inquiry so far</p>
            <div className="mt-4 space-y-3 border-t border-[#e5eaec] pt-4">
              <div className="flex items-start gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#edf6f5] text-[#16877b]">
                  <CrmIcon name="leads" className="h-3 w-3" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold text-[#35424b]">Lead received</p>
                  <p className="mt-0.5 text-[9px] text-[#8b969e]">
                    {lead.receivedAt.toLocaleDateString()} ·{' '}
                    {lead.receivedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
              {qualifiedAt ? (
                <div className="flex items-start gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#e9f7f1] text-[#14815f]">
                    <CrmIcon name="check" className="h-3 w-3" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold text-[#35424b]">Qualified into an opportunity</p>
                    <p className="mt-0.5 text-[9px] text-[#8b969e]">
                      {qualifiedAt.toLocaleDateString()} ·{' '}
                      {qualifiedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ) : null}
              {opportunityId ? (
                <Link
                  href={`/crm/opportunities/${opportunityId}`}
                  className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[#118e82] hover:text-[#08756b]"
                >
                  Open full activity timeline
                  <CrmIcon name="arrow" className="h-3 w-3" />
                </Link>
              ) : (
                <p className="text-[10px] text-[#8a959d]">
                  Qualify this lead to start the commercial timeline.
                </p>
              )}
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="rounded-xl bg-white border border-[#dfe5e8] p-5">
            <h2 className="text-xs font-semibold text-[#8a959d]">Lead ownership</h2>
            <div className="mt-4 flex items-center gap-3">
              <Avatar name={lead.ownerName} size="md" />
              <div>
                <p className="text-[11px] font-semibold text-[#1c2831]">{lead.ownerName}</p>
                <p className="mt-0.5 text-[9px] text-[#8a959d]">Assigned sales representative</p>
              </div>
            </div>
          </section>

          <section className="rounded-xl bg-white border border-[#dfe5e8] p-5">
            <h2 className="text-xs font-semibold text-[#8a959d]">Record readiness</h2>
            <div className="mt-4 space-y-3">
              <p className="flex items-center gap-2 text-[10px] font-medium text-[#53616a]">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-[#def4f0] text-[#188c81]">
                  <CrmIcon name="check" className="h-3 w-3" />
                </span>
                Contact details captured
              </p>
              {lead.productCategoryName ? (
                <p className="flex items-center gap-2 text-[10px] font-medium text-[#53616a]">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#def4f0] text-[#188c81]">
                    <CrmIcon name="check" className="h-3 w-3" />
                  </span>
                  Product interest qualified
                </p>
              ) : (
                <p className="flex items-center gap-2 text-[10px] font-medium text-[#8a959d]">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#e9edef] text-[#9aa3aa]">
                    <CrmIcon name="x" className="h-3 w-3" />
                  </span>
                  Product interest qualified
                </p>
              )}
              {lead.accountName ? (
                <p className="flex items-center gap-2 text-[10px] font-medium text-[#53616a]">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#def4f0] text-[#188c81]">
                    <CrmIcon name="check" className="h-3 w-3" />
                  </span>
                  Account linked
                </p>
              ) : (
                <p className="flex items-center gap-2 text-[10px] font-medium text-[#8a959d]">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#e9edef] text-[#9aa3aa]">
                    <CrmIcon name="x" className="h-3 w-3" />
                  </span>
                  Account linked (optional)
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>

      {/* Disqualify Dialog */}
      {disqualifyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white border border-[#dfe5e8] p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-[#1c2831]">Disqualify lead</h2>
            <p className="mt-1 text-sm text-[#53616a]">This action cannot be undone. The lead will be marked as disqualified.</p>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">Reason *</label>
                <select
                  value={disqualifyReasonId}
                  onChange={(e) => setDisqualifyReasonId(e.target.value)}
                  className="w-full h-9 rounded-lg border border-[#dce2e5] bg-white px-3 text-[11px] text-[#1c2831] focus:border-[#18b6a4]"
                >
                  <option value="">Select reason</option>
                  {disqualifyReasons.map((reason) => (
                    <option key={reason.id} value={reason.id}>
                      {reason.label}
                    </option>
                  ))}
                </select>
              </div>

              {requiresNote && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                    Note * (required for this reason)
                  </label>
                  <textarea
                    value={disqualifyNote}
                    onChange={(e) => setDisqualifyNote(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-[#dce2e5] bg-white px-3 py-2 text-[11px] text-[#1c2831] placeholder-[#94a0a9] focus:border-[#18b6a4] resize-none"
                    placeholder="Explain why this lead is being disqualified..."
                  />
                </div>
              )}

              {disqualifyError && (
                <p className="text-sm text-[#c43f47]" role="alert">{disqualifyError}</p>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDisqualifyOpen(false)}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#dce2e5] bg-white px-4 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
                disabled={disqualifySubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDisqualify}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#c43f47] px-4 text-[11px] font-semibold text-white transition hover:bg-[#a53239] disabled:opacity-50"
                disabled={disqualifySubmitting}
              >
                {disqualifySubmitting ? 'Disqualifying...' : 'Disqualify lead'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete follow-up: the outcome is the point, so it is required. */}
      {completing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleCompleteSubmit}
            role="dialog"
            aria-modal="true"
            aria-label="Complete follow-up"
            className="w-full max-w-md rounded-xl border border-[#dfe5e8] bg-white p-5 shadow-xl"
          >
            <h2 className="text-lg font-semibold text-[#1c2831]">Complete follow-up</h2>
            <p className="mt-1 text-sm text-[#53616a]">
              {ACTION_TYPE_LABELS[completing.actionType]} · due{' '}
              {completing.dueAt.toLocaleDateString()}
            </p>

            <div className="mt-4">
              <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                Outcome *
              </label>
              <textarea
                value={completionNote}
                onChange={(event) => setCompletionNote(event.target.value)}
                rows={3}
                autoFocus
                className="w-full rounded-lg border border-[#dce2e5] bg-white px-3 py-2 text-[11px] text-[#1c2831] placeholder-[#94a0a9] focus:border-[#18b6a4] resize-none"
                placeholder="What actually happened on this action?"
              />
            </div>

            {completeError ? (
              <p role="alert" className="mt-2 text-sm text-[#c43f47]">
                {completeError}
              </p>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setCompleting(null)}
                disabled={completingSubmitting}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#dce2e5] bg-white px-4 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={completingSubmitting || completionNote.trim().length === 0}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#132932] px-4 text-[11px] font-semibold text-white transition hover:bg-[#1b3944] disabled:opacity-50"
              >
                {completingSubmitting ? 'Saving…' : 'Complete'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}