'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Avatar, BackLink, Badge, InfoLine } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { markLeadContactedAction, disqualifyLeadAction, archiveLeadAction, restoreLeadAction } from '@/server/crm/leads/actions';
import type { LeadDetail } from '@/server/crm/leads/repository';
import type { BadgeValue } from '@/components/crm/Ui';

interface DisqualifyReason {
  id: string;
  code: string;
  label: string;
  requiresNote: boolean;
}

interface LeadDetailPageProps {
  lead: LeadDetail;
  disqualifyReasons: DisqualifyReason[];
  userRole: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP';
  userId: string;
}

export function LeadDetailPage({ lead, disqualifyReasons, userRole, userId }: LeadDetailPageProps) {
  const [disqualifyOpen, setDisqualifyOpen] = useState(false);
  const [disqualifyReasonId, setDisqualifyReasonId] = useState('');
  const [disqualifyNote, setDisqualifyNote] = useState('');
  const [disqualifySubmitting, setDisqualifySubmitting] = useState(false);
  const [disqualifyError, setDisqualifyError] = useState<string | null>(null);
  const [contactedSubmitting, setContactedSubmitting] = useState(false);
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);
  const [restoreSubmitting, setRestoreSubmitting] = useState(false);

  const selectedReason = disqualifyReasons.find((r) => r.id === disqualifyReasonId);
  const requiresNote = selectedReason?.requiresNote ?? false;
  const isArchived = lead.archivedAt !== null;

  const canMutate = userRole !== 'SALES_REP' || lead.ownerUserId === userId;

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
    try {
      const result = await restoreLeadAction(lead.id);
      if (result.ok) {
        window.location.reload();
      }
    } catch {
      // Error handling could be improved with toast notifications
    } finally {
      setRestoreSubmitting(false);
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
            <p className="mb-1.5 text-right text-[9px] font-medium text-[#8a959d]">Lead actions</p>
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
                    <button
                      type="button"
                      disabled
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#dce2e5] bg-[#f7f9fa] px-3 text-[11px] font-semibold text-[#9aa3aa] cursor-not-allowed"
                      title="Conversion to opportunity coming in next slice"
                    >
                      <CrmIcon name="arrow" className="h-3.5 w-3.5" />
                      Convert (soon)
                    </button>
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
          </div>
        )}
      </div>

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
            <h2 className="text-sm font-semibold text-[#1c2831]">Contact & account resolution</h2>
            <p className="mt-0.5 text-[10px] text-[#8a959d]">Resolved from the original inquiry</p>
            <div className="mt-4 grid gap-3 border-t border-[#e5eaec] pt-4 sm:grid-cols-3">
              <div className="rounded-lg bg-[#f7f9fa] p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">Contact</p>
                <p className="mt-2 text-[11px] font-semibold text-[#1c2831]">{lead.contactName}</p>
                <p className="mt-1 text-[9px] font-medium text-[#188c81]">Resolved</p>
              </div>
              {lead.accountName ? (
                <div className="rounded-lg bg-[#f7f9fa] p-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">Account</p>
                  <p className="mt-2 text-[11px] font-semibold text-[#1c2831]">{lead.accountName}</p>
                  <p className="mt-1 text-[9px] font-medium text-[#188c81]">Resolved</p>
                </div>
              ) : (
                <div className="rounded-lg bg-[#f7f9fa] p-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a959d]">Account</p>
                  <p className="mt-2 text-[11px] font-semibold text-[#1c2831]">—</p>
                  <p className="mt-1 text-[9px] font-medium text-[#8a959d]">Not linked</p>
                </div>
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
                  Account resolved
                </p>
              ) : (
                <p className="flex items-center gap-2 text-[10px] font-medium text-[#8a959d]">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#e9edef] text-[#9aa3aa]">
                    <CrmIcon name="x" className="h-3 w-3" />
                  </span>
                  Account resolved
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
            <p className="mt-1 text-sm text-[#53616a]">This action cannot be undone. The lead will be marked as DISQUALIFIED.</p>

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
    </>
  );
}