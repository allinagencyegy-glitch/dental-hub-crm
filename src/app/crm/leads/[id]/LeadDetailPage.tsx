'use client';

import { useState } from 'react';
import { Avatar, BackLink, Badge, InfoLine } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { markLeadContactedAction, disqualifyLeadAction } from '@/server/crm/leads/actions';
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

  const selectedReason = disqualifyReasons.find((r) => r.id === disqualifyReasonId);
  const requiresNote = selectedReason?.requiresNote ?? false;

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

  const canMutate = userRole !== 'SALES_REP' || lead.ownerUserId === userId;

  return (
    <>
      <BackLink href="/crm/leads" label="Back to lead inbox" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={lead.contactName} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[25px] font-semibold tracking-[-0.035em] text-slate-100">{lead.contactName}</h1>
              <Badge value={lead.status as BadgeValue} dot />
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Lead reference {lead.id.slice(0, 8)}</p>
          </div>
        </div>
        {canMutate && (
          <div>
            <p className="mb-1.5 text-right text-[9px] font-medium text-slate-500">Lead actions</p>
            <div className="flex flex-wrap justify-end gap-2">
              {lead.status === 'NEW' && (
                <button
                  type="button"
                  onClick={handleMarkContacted}
                  disabled={contactedSubmitting}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-teal-500 px-3 text-[11px] font-semibold text-white transition hover:bg-teal-400 disabled:opacity-50"
                >
                  <CrmIcon name="check" className="h-3.5 w-3.5" />
                  Mark contacted
                </button>
              )}
              <button
                type="button"
                onClick={() => setDisqualifyOpen(true)}
                disabled={disqualifySubmitting || lead.status === 'DISQUALIFIED'}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 text-[11px] font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-700 disabled:opacity-50"
              >
                <CrmIcon name="x" className="h-3.5 w-3.5" />
                Disqualify
              </button>
              {(lead.status === 'NEW' || lead.status === 'CONTACTED') && (
                <button
                  type="button"
                  disabled
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-3 text-[11px] font-semibold text-slate-500 cursor-not-allowed"
                  title="Conversion to opportunity coming in next slice"
                >
                  <CrmIcon name="arrow" className="h-3.5 w-3.5" />
                  Convert (soon)
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-xl bg-slate-900/40 border border-slate-800 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Lead overview</h2>
                <p className="mt-1 text-[10px] text-slate-500">Captured {lead.receivedAt.toLocaleDateString()} at {lead.receivedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500">Source</span>
                <Badge value={lead.sourceName as BadgeValue} />
              </div>
            </div>
            <div className="mt-5 grid gap-x-8 border-t border-slate-800 pt-3 sm:grid-cols-2">
              <InfoLine icon="phone" label="Phone" value={lead.contactPhone ?? 'Not provided'} />
              <InfoLine icon="mail" label="Email" value={lead.contactEmail ?? 'Not provided'} />
              <InfoLine icon="sparkles" label="Product interest" value={lead.productCategoryName ?? 'Not specified'} />
              <InfoLine icon="team" label="Assigned owner" value={lead.ownerName} />
              {lead.campaignName && <InfoLine icon="target" label="Campaign" value={lead.campaignName} />}
              {lead.accountName && <InfoLine icon="building" label="Account" value={lead.accountName} />}
            </div>
            {lead.note && (
              <div className="mt-3 rounded-lg bg-slate-800/50 p-4">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500">Inquiry context</p>
                <p className="mt-2 text-[11px] leading-5 text-slate-300">{lead.note}</p>
              </div>
            )}
          </section>

          <section className="rounded-xl bg-slate-900/40 border border-slate-800 p-5">
            <h2 className="text-sm font-semibold text-slate-100">Contact & account resolution</h2>
            <p className="mt-0.5 text-[10px] text-slate-500">Resolved from the original inquiry</p>
            <div className="mt-4 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-3">
              <div className="rounded-lg bg-slate-800/50 p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500">Contact</p>
                <p className="mt-2 text-[11px] font-semibold text-slate-100">{lead.contactName}</p>
                <p className="mt-1 text-[9px] font-medium text-teal-400">Resolved</p>
              </div>
              {lead.accountName ? (
                <div className="rounded-lg bg-slate-800/50 p-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500">Account</p>
                  <p className="mt-2 text-[11px] font-semibold text-slate-100">{lead.accountName}</p>
                  <p className="mt-1 text-[9px] font-medium text-teal-400">Resolved</p>
                </div>
              ) : (
                <div className="rounded-lg bg-slate-800/50 p-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500">Account</p>
                  <p className="mt-2 text-[11px] font-semibold text-slate-100">—</p>
                  <p className="mt-1 text-[9px] font-medium text-slate-500">Not linked</p>
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="rounded-xl bg-slate-900/60 border border-slate-800 p-5">
            <h2 className="text-xs font-semibold text-slate-300">Lead ownership</h2>
            <div className="mt-4 flex items-center gap-3">
              <Avatar name={lead.ownerName} size="md" />
              <div>
                <p className="text-[11px] font-semibold text-slate-100">{lead.ownerName}</p>
                <p className="mt-0.5 text-[9px] text-slate-500">Assigned sales representative</p>
              </div>
            </div>
          </section>

          <section className="rounded-xl bg-slate-900/60 border border-slate-800 p-5">
            <h2 className="text-xs font-semibold text-slate-300">Record readiness</h2>
            <div className="mt-4 space-y-3">
              <p className="flex items-center gap-2 text-[10px] font-medium text-slate-300">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-teal-500/20 text-teal-400">
                  <CrmIcon name="check" className="h-3 w-3" />
                </span>
                Contact details captured
              </p>
              {lead.productCategoryName ? (
                <p className="flex items-center gap-2 text-[10px] font-medium text-slate-300">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-teal-500/20 text-teal-400">
                    <CrmIcon name="check" className="h-3 w-3" />
                  </span>
                  Product interest qualified
                </p>
              ) : (
                <p className="flex items-center gap-2 text-[10px] font-medium text-slate-500">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-700 text-slate-500">
                    <CrmIcon name="x" className="h-3 w-3" />
                  </span>
                  Product interest qualified
                </p>
              )}
              {lead.accountName ? (
                <p className="flex items-center gap-2 text-[10px] font-medium text-slate-300">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-teal-500/20 text-teal-400">
                    <CrmIcon name="check" className="h-3 w-3" />
                  </span>
                  Account resolved
                </p>
              ) : (
                <p className="flex items-center gap-2 text-[10px] font-medium text-slate-500">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-700 text-slate-500">
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
          <div className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-800 p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-100">Disqualify lead</h2>
            <p className="mt-1 text-sm text-slate-400">This action cannot be undone. The lead will be marked as DISQUALIFIED.</p>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 mb-1.5">Reason *</label>
                <select
                  value={disqualifyReasonId}
                  onChange={(e) => setDisqualifyReasonId(e.target.value)}
                  className="w-full h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 text-[11px] text-slate-100 focus:border-teal-400"
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
                  <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 mb-1.5">
                    Note * (required for this reason)
                  </label>
                  <textarea
                    value={disqualifyNote}
                    onChange={(e) => setDisqualifyNote(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-100 placeholder-slate-500 focus:border-teal-400 resize-none"
                    placeholder="Explain why this lead is being disqualified..."
                  />
                </div>
              )}

              {disqualifyError && (
                <p className="text-sm text-red-400" role="alert">{disqualifyError}</p>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDisqualifyOpen(false)}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 text-[11px] font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-700"
                disabled={disqualifySubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDisqualify}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-red-500 px-4 text-[11px] font-semibold text-white transition hover:bg-red-400 disabled:opacity-50"
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