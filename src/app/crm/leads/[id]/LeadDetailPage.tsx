'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, BackLink, Badge, InfoLine } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { markLeadContactedAction, disqualifyLeadAction, archiveLeadAction, restoreLeadAction, linkLeadToAccountAction } from '@/server/crm/leads/actions';
import { qualifyLeadAction, createLeadFollowUpAction, completeFollowUpAction } from '@/server/crm/opportunities/actions';
import {
  FOLLOW_UP_ACTION_TYPES,
  isNotReached,
  notReachedAttempts,
  type FollowUpActionType,
  type FollowUpOutcome,
} from '@/server/crm/opportunities/followup-actions';
import { FollowUpResultBadge, FollowUpResultFields } from '@/components/crm/FollowUpResult';
import type { FollowUp } from '@/server/crm/opportunities/followups';
import type { LeadDetail } from '@/server/crm/leads/repository';
import type { BadgeValue } from '@/components/crm/Ui';
import { useFormatters, useMessages } from '@/i18n/I18nProvider';
import { catalogLabel } from '@/i18n/format';
import type { Role } from '@/server/authz/permissions';

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

/** The next try's default: this time tomorrow. Read when a dialog opens. */
function sameTimeTomorrow(): string {
  return toLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000));
}

interface LeadDetailPageProps {
  lead: LeadDetail;
  disqualifyReasons: DisqualifyReason[];
  accounts: { id: string; name: string }[];
  userRole: Role;
  userId: string;
  opportunityId: string | null;
  qualifiedAt: Date | null;
  followUps: FollowUp[];
  /** Server render time, in epoch millis. Stable across client re-renders. */
  now: number;
}

export function LeadDetailPage({ lead, disqualifyReasons, accounts, userRole, userId, opportunityId, qualifiedAt, followUps, now }: LeadDetailPageProps) {
  const router = useRouter();
  const m = useMessages();
  const format = useFormatters();
  const t = m.leads.detail;
  const actionLabel = (type: FollowUpActionType) => m.followUpTypes[type];
  const sourceLabel = catalogLabel(m.catalog.sources, lead.sourceCode, lead.sourceName);
  const productLabel = lead.productCategoryName
    ? catalogLabel(m.catalog.productCategories, lead.productCategoryCode, lead.productCategoryName)
    : null;

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
  const [completionOutcome, setCompletionOutcome] = useState<FollowUpOutcome | null>(null);
  // Nobody answered: the next try can be booked from the same dialog.
  const [nextTry, setNextTry] = useState(false);
  const [nextTryAt, setNextTryAt] = useState('');
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
  const attempts = notReachedAttempts(followUps);

  const handleScheduleFollowUp = async (event: FormEvent) => {
    event.preventDefault();
    if (!followUpDueAt) {
      setFollowUpError(t.chooseDue);
      return;
    }
    const dueAt = new Date(followUpDueAt);
    if (Number.isNaN(dueAt.getTime())) {
      setFollowUpError(t.dueUnreadable);
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
      setFollowUpError(t.scheduleFailed);
    } finally {
      setFollowUpSubmitting(false);
    }
  };

  const openComplete = (followUp: FollowUp) => {
    setCompleting(followUp);
    setCompletionNote('');
    setCompletionOutcome(null);
    setNextTry(false);
    setNextTryAt(sameTimeTomorrow());
    setCompleteError(null);
  };

  const handleCompleteSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!completing) return;
    if (completionOutcome === null) {
      setCompleteError(m.followUp.resultRequired);
      return;
    }
    const nextDue = nextTry ? new Date(nextTryAt) : null;
    if (nextDue !== null && Number.isNaN(nextDue.getTime())) {
      setCompleteError(t.dueUnreadable);
      return;
    }
    setCompletingSubmitting(true);
    setCompleteError(null);
    try {
      const result = await completeFollowUpAction(completing.id, {
        outcome: completionOutcome,
        completionNote: completionNote.trim() || null,
      });
      if (result.ok === false) {
        setCompleteError(result.message);
        return;
      }
      if (nextDue !== null) {
        const next = await createLeadFollowUpAction(lead.id, {
          actionType: completing.actionType,
          note: null,
          dueAt: nextDue.toISOString(),
        });
        if (next.ok === false) {
          setCompleteError(next.message);
          return;
        }
      }
      setCompleting(null);
      router.refresh();
    } catch {
      setCompleteError(t.completeFailed);
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
      setDisqualifyError(t.reasonRequired);
      return;
    }
    if (requiresNote && !disqualifyNote.trim()) {
      setDisqualifyError(t.reasonNoteRequired);
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
      setDisqualifyError(m.common.unexpectedError);
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
      setRestoreError(t.restoreFailed);
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
        setQualifyError(t.valueInvalid);
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
      setQualifyError(m.common.unexpectedError);
    } finally {
      setQualifySubmitting(false);
    }
  };

  const handleLinkAccount = async () => {
    const mode = accountMode;
    if (mode === 'link' && !accountSelectId) {
      setAccountError(t.chooseClinic);
      return;
    }
    if (mode === 'create' && accountNewName.trim() === '') {
      setAccountError(t.enterClinicName);
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
      setAccountError(m.common.unexpectedError);
    } finally {
      setAccountSubmitting(false);
    }
  };

  return (
    <>
      <BackLink href="/crm/leads" label={t.back} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={lead.contactName} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[25px] font-semibold tracking-[-0.035em] text-[#1c2831]">{lead.contactName}</h1>
              <Badge value={lead.status as BadgeValue} label={m.leadStatus[lead.status]} dot />
              {isArchived && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#fff3e0] px-2 py-0.5 text-[10px] font-semibold text-[#c47c00]">
                  <CrmIcon name="archive" className="h-3 w-3" />
                  {m.leads.list.archived}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-[#8a959d]">{t.reference(lead.id.slice(0, 8))}</p>
          </div>
        </div>
        {canMutate && (
          <div>
            <p className="mb-1.5 text-end text-[9px] font-medium text-[#8a959d]">{t.actions}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Link
                href={`/crm/leads/${lead.id}/edit`}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#dce2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
              >
                <CrmIcon name="edit" className="h-3.5 w-3.5" />
                {t.edit}
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
                      {t.markContacted}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDisqualifyOpen(true)}
                    disabled={disqualifySubmitting || lead.status === 'DISQUALIFIED'}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#dce2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa] disabled:opacity-50"
                  >
                    <CrmIcon name="x" className="h-3.5 w-3.5" />
                    {t.disqualify}
                  </button>
                  {(lead.status === 'NEW' || lead.status === 'CONTACTED') && (
                    opportunityId ? (
                      <Link
                        href={`/crm/opportunities/${opportunityId}`}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#18b6a4] px-3 text-[11px] font-semibold text-white transition hover:bg-[#128d81]"
                      >
                        <CrmIcon name="opportunities" className="h-3.5 w-3.5" />
                        {t.viewOpportunity}
                      </Link>
                    ) : !isArchived ? (
                      <button
                        type="button"
                        onClick={() => setQualifyOpen((open) => !open)}
                        disabled={qualifySubmitting}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#18b6a4] px-3 text-[11px] font-semibold text-white transition hover:bg-[#128d81] disabled:opacity-50"
                      >
                        <CrmIcon name="opportunities" className="h-3.5 w-3.5" />
                        {t.qualify}
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
                    {t.archive}
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
                  {t.restore}
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
          <h2 className="text-sm font-semibold text-[#1c2831]">{t.qualifyTitle}</h2>
          <p className="mt-0.5 text-[10px] text-[#8a959d]">
            {t.qualifyDescription(lead.ownerName)}
          </p>
          {qualifyError && (
            <p role="alert" className="mt-3 rounded-lg bg-[#fff0f1] px-3 py-2 text-[11px] font-semibold text-[#b83c43] ring-1 ring-[#f0c5c8]">
              {qualifyError}
            </p>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">
                {t.estimatedValue}
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={qualifyValue}
                onChange={(e) => setQualifyValue(e.target.value)}
                placeholder={t.optional}
                className="mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#3c4a54] outline-none placeholder:text-[#a4aeb5] focus:border-[#18b6a4]"
              />
            </label>
            <label className="block">
              <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">
                {t.salesContext}
              </span>
              <input
                type="text"
                value={qualifyNote}
                onChange={(e) => setQualifyNote(e.target.value)}
                placeholder={t.salesContextPlaceholder}
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
              {qualifySubmitting ? t.qualifying : t.createOpportunity}
            </button>
            <button
              type="button"
              onClick={() => {
                setQualifyOpen(false);
                setQualifyError(null);
              }}
              className="rounded-lg border border-[#dbe2e5] bg-white px-3.5 py-2 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
            >
              {m.common.cancel}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-xl bg-white border border-[#dfe5e8] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#1c2831]">{t.overview}</h2>
                <p className="mt-1 text-[10px] text-[#8a959d]">{t.captured(format.date(lead.receivedAt), format.time(lead.receivedAt))}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">{m.leads.source}</span>
                <Badge value={lead.sourceName as BadgeValue} label={sourceLabel} />
              </div>
            </div>
            <div className="mt-5 grid gap-x-8 border-t border-[#e5eaec] pt-3 sm:grid-cols-2">
              <InfoLine icon="phone" label={m.leads.phone} value={lead.contactPhone ?? m.common.notProvided} />
              <InfoLine icon="mail" label={m.leads.email} value={lead.contactEmail ?? m.common.notProvided} />
              <InfoLine icon="sparkles" label={m.leads.productInterest} value={productLabel ?? m.common.notSpecified} />
              <InfoLine icon="team" label={m.leads.owner} value={lead.ownerName} />
              {lead.campaignName && <InfoLine icon="target" label={m.leads.campaign} value={lead.campaignName} />}
              {lead.accountName && <InfoLine icon="building" label={t.account} value={lead.accountName} />}
            </div>
            {lead.note && (
              <div className="mt-3 rounded-lg bg-[#f7f9fa] p-4">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">{m.leads.inquiryContext}</p>
                <p className="mt-2 text-[11px] leading-5 text-[#394750]">{lead.note}</p>
              </div>
            )}
          </section>

          <section className="rounded-xl bg-white border border-[#dfe5e8] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#1c2831]">{t.nextActions}</h2>
                <p className="mt-0.5 text-[10px] text-[#8a959d]">
                  {t.nextActionsHint}
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
                  {t.scheduleFollowUp}
                </button>
              ) : null}
            </div>

            {followUpOpen && canScheduleFollowUp ? (
              <form onSubmit={handleScheduleFollowUp} className="mt-4 rounded-lg border border-[#dfe5e8] bg-[#fbfcfc] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">
                      {t.action}
                    </span>
                    <select
                      value={followUpType}
                      onChange={(event) => setFollowUpType(event.target.value as FollowUpActionType)}
                      className="mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#1c2831] focus:border-[#18b6a4]"
                    >
                      {FOLLOW_UP_ACTION_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {actionLabel(type)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">
                      {t.due}
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
                    {t.noteOptional}
                  </span>
                  <input
                    type="text"
                    value={followUpNote}
                    onChange={(event) => setFollowUpNote(event.target.value)}
                    placeholder={t.followUpPlaceholder}
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
                    {followUpSubmitting ? t.scheduling : t.schedule}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFollowUpOpen(false);
                      setFollowUpError(null);
                    }}
                    className="rounded-lg border border-[#dbe2e5] bg-white px-3.5 py-2 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
                  >
                    {m.common.cancel}
                  </button>
                </div>
              </form>
            ) : null}

            <div className="mt-4 border-t border-[#e5eaec] pt-4">
              {pendingFollowUps.length === 0 && completedFollowUps.length === 0 ? (
                <p className="text-[10px] text-[#8a959d]">{t.noActions}</p>
              ) : (
                <div className="space-y-2.5">
                  {pendingFollowUps.map((followUp) => {
                    const overdue = followUp.dueAt.getTime() < now;
                    return (
                      <div key={followUp.id} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 text-[11px] font-semibold text-[#35424b]">
                            {actionLabel(followUp.actionType)}
                            {overdue ? (
                              <span className="rounded-full bg-[#ffeaeb] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-[#bd3941]">
                                {t.overdue}
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-[9px] text-[#8b969e]">
                            {t.dueAt(format.date(followUp.dueAt), format.time(followUp.dueAt))}
                            {followUp.note ? ` · ${followUp.note}` : null}
                          </p>
                        </div>
                        {canMutate && !isArchived ? (
                          <button
                            type="button"
                            onClick={() => openComplete(followUp)}
                            className="h-7 shrink-0 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] font-semibold text-[#53616a] transition hover:bg-[#f7f9fa]"
                          >
                            {t.complete}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                  {completedFollowUps.map((followUp) => (
                    <div key={followUp.id} className="flex items-center justify-between gap-3 opacity-70">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[#35424b]">
                          {actionLabel(followUp.actionType)}
                          {followUp.outcome ? (
                            <FollowUpResultBadge outcome={followUp.outcome} attempt={attempts.get(followUp.id)} />
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-[9px] text-[#8b969e]">
                          {followUp.completedAt ? t.doneAt(format.date(followUp.completedAt)) : null}
                          {followUp.note ? ` · ${followUp.note}` : null}
                        </p>
                      </div>
                      <span className="shrink-0 text-[8px] font-bold uppercase tracking-[0.08em] text-[#14815f]">
                        {t.completed}
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
                <h2 className="text-sm font-semibold text-[#1c2831]">{t.clinicTitle}</h2>
                <p className="mt-0.5 text-[10px] text-[#8a959d]">
                  {t.clinicHint}
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
                  {lead.accountName ? t.changeClinic : t.linkClinic}
                </button>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3 border-t border-[#e5eaec] pt-4 sm:grid-cols-3">
              <div className="rounded-lg bg-[#f7f9fa] p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">{t.contact}</p>
                <p className="mt-2 text-[11px] font-semibold text-[#1c2831]">{lead.contactName}</p>
                <p className="mt-1 text-[9px] font-medium text-[#188c81]">{t.resolved}</p>
              </div>
              <div className="rounded-lg bg-[#f7f9fa] p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">{t.clinic}</p>
                <p className="mt-2 text-[11px] font-semibold text-[#1c2831]">
                  {lead.accountName ?? t.noClinic}
                </p>
                <p className="mt-1 text-[9px] font-medium text-[#188c81]">
                  {lead.accountName ? t.linked : t.optional}
                </p>
              </div>
              <div className="rounded-lg bg-[#f7f9fa] p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">{t.commercial}</p>
                <p className="mt-2 text-[11px] font-semibold text-[#1c2831]">
                  {opportunityId ? (
                    <Link href={`/crm/opportunities/${opportunityId}`} className="text-[#188c81] hover:underline">
                      {t.viewOpportunity}
                    </Link>
                  ) : (
                    t.notQualified
                  )}
                </p>
                <p className="mt-1 text-[9px] font-medium text-[#188c81]">
                  {qualifiedAt ? t.qualifiedOn(format.date(qualifiedAt)) : t.leadStage}
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
                    {t.linkExisting}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountMode('create')}
                    className={`rounded-lg px-3 py-1.5 text-[10px] font-semibold transition ${
                      accountMode === 'create' ? 'bg-[#132932] text-white' : 'bg-white text-[#53616b] ring-1 ring-[#dfe5e8]'
                    }`}
                  >
                    {t.createNew}
                  </button>
                </div>

                {accountMode === 'link' ? (
                  <div className="mt-3">
                    <label className="block text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                      {t.clinic}
                    </label>
                    <select
                      value={accountSelectId}
                      onChange={(event) => setAccountSelectId(event.target.value)}
                      className="h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#1c2831] focus:border-[#18b6a4]"
                    >
                      <option value="">{t.chooseClinicOption}</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                    {accounts.length === 0 ? (
                      <p className="mt-1.5 text-[10px] text-[#8a959d]">
                        {t.noClinicsYet}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-3">
                    <label className="block text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                      {t.clinicName}
                    </label>
                    <input
                      type="text"
                      value={accountNewName}
                      onChange={(event) => setAccountNewName(event.target.value)}
                      placeholder={t.clinicNamePlaceholder}
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
                    {accountSubmitting ? t.linking : t.linkClinic}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountOpen(false);
                      setAccountError(null);
                    }}
                    className="rounded-lg border border-[#dbe2e5] bg-white px-3.5 py-2 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
                  >
                    {m.common.cancel}
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-xl bg-white border border-[#dfe5e8] p-5">
            <h2 className="text-sm font-semibold text-[#1c2831]">{t.timeline}</h2>
            <p className="mt-0.5 text-[10px] text-[#8a959d]">{t.timelineHint}</p>
            <div className="mt-4 space-y-3 border-t border-[#e5eaec] pt-4">
              <div className="flex items-start gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#edf6f5] text-[#16877b]">
                  <CrmIcon name="leads" className="h-3 w-3" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold text-[#35424b]">{t.receivedEvent}</p>
                  <p className="mt-0.5 text-[9px] text-[#8b969e]">
                    {format.date(lead.receivedAt)} · {format.time(lead.receivedAt)}
                  </p>
                </div>
              </div>
              {qualifiedAt ? (
                <div className="flex items-start gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#e9f7f1] text-[#14815f]">
                    <CrmIcon name="check" className="h-3 w-3" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold text-[#35424b]">{t.qualifiedEvent}</p>
                    <p className="mt-0.5 text-[9px] text-[#8b969e]">
                      {format.date(qualifiedAt)} · {format.time(qualifiedAt)}
                    </p>
                  </div>
                </div>
              ) : null}
              {opportunityId ? (
                <Link
                  href={`/crm/opportunities/${opportunityId}`}
                  className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[#118e82] hover:text-[#08756b]"
                >
                  {t.openTimeline}
                  <CrmIcon name="arrow" className="h-3 w-3" />
                </Link>
              ) : (
                <p className="text-[10px] text-[#8a959d]">
                  {t.qualifyToStart}
                </p>
              )}
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="rounded-xl bg-white border border-[#dfe5e8] p-5">
            <h2 className="text-xs font-semibold text-[#8a959d]">{t.ownership}</h2>
            <div className="mt-4 flex items-center gap-3">
              <Avatar name={lead.ownerName} size="md" />
              <div>
                <p className="text-[11px] font-semibold text-[#1c2831]">{lead.ownerName}</p>
                <p className="mt-0.5 text-[9px] text-[#8a959d]">{t.ownerRole}</p>
              </div>
            </div>
          </section>

          <section className="rounded-xl bg-white border border-[#dfe5e8] p-5">
            <h2 className="text-xs font-semibold text-[#8a959d]">{t.readiness}</h2>
            <div className="mt-4 space-y-3">
              <p className="flex items-center gap-2 text-[10px] font-medium text-[#53616a]">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-[#def4f0] text-[#188c81]">
                  <CrmIcon name="check" className="h-3 w-3" />
                </span>
                {t.contactCaptured}
              </p>
              {productLabel ? (
                <p className="flex items-center gap-2 text-[10px] font-medium text-[#53616a]">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#def4f0] text-[#188c81]">
                    <CrmIcon name="check" className="h-3 w-3" />
                  </span>
                  {t.productQualified}
                </p>
              ) : (
                <p className="flex items-center gap-2 text-[10px] font-medium text-[#8a959d]">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#e9edef] text-[#9aa3aa]">
                    <CrmIcon name="x" className="h-3 w-3" />
                  </span>
                  {t.productQualified}
                </p>
              )}
              {lead.accountName ? (
                <p className="flex items-center gap-2 text-[10px] font-medium text-[#53616a]">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#def4f0] text-[#188c81]">
                    <CrmIcon name="check" className="h-3 w-3" />
                  </span>
                  {t.accountLinked}
                </p>
              ) : (
                <p className="flex items-center gap-2 text-[10px] font-medium text-[#8a959d]">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#e9edef] text-[#9aa3aa]">
                    <CrmIcon name="x" className="h-3 w-3" />
                  </span>
                  {t.accountLinkedOptional}
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
            <h2 className="text-lg font-semibold text-[#1c2831]">{t.disqualifyTitle}</h2>
            <p className="mt-1 text-sm text-[#53616a]">{t.disqualifyWarning}</p>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">{t.reason} *</label>
                <select
                  value={disqualifyReasonId}
                  onChange={(e) => setDisqualifyReasonId(e.target.value)}
                  className="w-full h-9 rounded-lg border border-[#dce2e5] bg-white px-3 text-[11px] text-[#1c2831] focus:border-[#18b6a4]"
                >
                  <option value="">{t.selectReason}</option>
                  {disqualifyReasons.map((reason) => (
                    <option key={reason.id} value={reason.id}>
                      {catalogLabel(m.catalog.disqualifyReasons, reason.code, reason.label)}
                    </option>
                  ))}
                </select>
              </div>

              {requiresNote && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                    {t.reasonNote} *
                  </label>
                  <textarea
                    value={disqualifyNote}
                    onChange={(e) => setDisqualifyNote(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-[#dce2e5] bg-white px-3 py-2 text-[11px] text-[#1c2831] placeholder-[#94a0a9] focus:border-[#18b6a4] resize-none"
                    placeholder={t.disqualifyPlaceholder}
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
                {m.common.cancel}
              </button>
              <button
                type="button"
                onClick={handleDisqualify}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#c43f47] px-4 text-[11px] font-semibold text-white transition hover:bg-[#a53239] disabled:opacity-50"
                disabled={disqualifySubmitting}
              >
                {disqualifySubmitting ? t.disqualifying : t.disqualifyConfirm}
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
            aria-label={t.completeTitle}
            className="w-full max-w-md rounded-xl border border-[#dfe5e8] bg-white p-5 shadow-xl"
          >
            <h2 className="text-lg font-semibold text-[#1c2831]">{t.completeTitle}</h2>
            <p className="mt-1 text-sm text-[#53616a]">
              {t.completeSubtitle(actionLabel(completing.actionType), format.date(completing.dueAt))}
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

            {canScheduleFollowUp ? (
              <>
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
              </>
            ) : null}

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
                {m.common.cancel}
              </button>
              <button
                type="submit"
                disabled={completingSubmitting || completionOutcome === null}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#132932] px-4 text-[11px] font-semibold text-white transition hover:bg-[#1b3944] disabled:opacity-50"
              >
                {completingSubmitting ? m.common.saving : t.complete}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}