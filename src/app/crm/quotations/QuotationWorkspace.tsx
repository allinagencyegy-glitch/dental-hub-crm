'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BackLink } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import {
  acceptQuotationAction,
  createQuotationAction,
  expireQuotationAction,
  rejectQuotationAction,
  reviseQuotationAction,
  sendQuotationAction,
  updateDraftQuotationAction,
} from '@/server/crm/quotations/actions';
import { QUOTATION_STATUS_LABELS, isRevisionAllowed } from '@/server/crm/quotations/status';
import type { QuotationDetail, QuotationRevisionSnapshot } from '@/server/crm/quotations/repository';
import type { OpportunityDetail as OpportunityDetailData } from '@/server/crm/opportunities/repository';

type EditableItem = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

const STATUS_CHIP: Record<QuotationDetail['status'], string> = {
  DRAFT: 'bg-[#edf0f2] text-[#63707a]',
  SENT: 'bg-[#e8f4ff] text-[#287bb5]',
  ACCEPTED: 'bg-[#e8f8f1] text-[#14815f]',
  REJECTED: 'bg-[#ffe9ea] text-[#c43f47]',
  EXPIRED: 'bg-[#f1edff] text-[#6d52be]',
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatEgp(value: number): string {
  return value.toLocaleString('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 2,
  });
}

function toItemString(value: number): string {
  return String(value);
}

let itemKeyCounter = 0;
function nextItemKey(): string {
  itemKeyCounter += 1;
  return `item-${itemKeyCounter}`;
}

interface QuotationWorkspaceProps {
  /** null = create mode. */
  quotation: QuotationDetail | null;
  /** Present in create mode: the opportunity this quotation belongs to. */
  opportunity: Pick<
    OpportunityDetailData,
    'id' | 'contactName' | 'contactPhone' | 'contactPhoneIsWhatsApp' | 'accountName' | 'ownerName' | 'stage'
  > | null;
  snapshots: QuotationRevisionSnapshot[];
}

export function QuotationWorkspace({ quotation, opportunity, snapshots }: QuotationWorkspaceProps) {
  const router = useRouter();

  const initialItems: EditableItem[] = quotation
    ? quotation.items.map((item) => ({
        key: item.id,
        description: item.description,
        quantity: toItemString(item.quantity),
        unitPrice: toItemString(item.unitPrice),
      }))
    : [{ key: nextItemKey(), description: '', quantity: '1', unitPrice: '' }];

  const [items, setItems] = useState<EditableItem[]>(initialItems);
  const [discountAmount, setDiscountAmount] = useState(
    quotation ? toItemString(quotation.discountAmount) : '0',
  );
  const [taxAmount, setTaxAmount] = useState(quotation ? toItemString(quotation.taxAmount) : '0');
  const [notes, setNotes] = useState(quotation?.notes ?? '');
  const [termsConditions, setTermsConditions] = useState(quotation?.termsConditions ?? '');
  const [validUntil, setValidUntil] = useState(() =>
    quotation?.validUntil ? new Date(quotation.validUntil).toISOString().slice(0, 10) : '',
  );

  const [editing, setEditing] = useState(quotation === null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const totals = useMemo(() => {
    let subtotal = 0;
    for (const item of items) {
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);
      if (Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
        subtotal += round2(round2(quantity) * round2(unitPrice));
      }
    }
    subtotal = round2(subtotal);
    const discount = Number(discountAmount);
    const tax = Number(taxAmount);
    const total = round2(subtotal - (Number.isFinite(discount) ? discount : 0) + (Number.isFinite(tax) ? tax : 0));
    return { subtotal, total };
  }, [items, discountAmount, taxAmount]);

  const opportunityId = quotation?.opportunityId ?? opportunity?.id ?? '';

  const setItem = (key: string, patch: Partial<EditableItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const addItem = () => {
    setItems((current) => [...current, { key: nextItemKey(), description: '', quantity: '1', unitPrice: '' }]);
  };

  const removeItem = (key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
  };

  const run = async (
    action: () => Promise<{ ok: boolean; message?: string; quotation?: QuotationDetail } | null>,
    success: string,
    then?: () => void,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!result || result.ok === false) {
        setError(result?.message ?? 'That action could not be completed.');
        return;
      }
      setNotice(success);
      if (then) then();
      else router.refresh();
    } catch {
      setError('That action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const collectPayload = () => {
    const payloadItems = items.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
    }));
    for (const item of payloadItems) {
      if (!item.description) {
        setError('Every line item needs a description.');
        return null;
      }
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        setError('Every line item needs a quantity greater than zero.');
        return null;
      }
      if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
        setError('Unit prices cannot be negative.');
        return null;
      }
    }
    const discount = Number(discountAmount);
    const tax = Number(taxAmount);
    if (!Number.isFinite(discount) || discount < 0) {
      setError('Discount cannot be negative.');
      return null;
    }
    if (!Number.isFinite(tax) || tax < 0) {
      setError('Tax cannot be negative.');
      return null;
    }
    if (discount > totals.subtotal) {
      setError('Discount cannot exceed the subtotal.');
      return null;
    }
    return {
      items: payloadItems,
      discountAmount: discount,
      taxAmount: tax,
      notes: notes.trim() || null,
      termsConditions: termsConditions.trim() || null,
      validUntil: validUntil || null,
    };
  };

  const handleSave = async () => {
    const payload = collectPayload();
    if (!payload) return;
    setBusy(true);
    setError(null);
    try {
      if (quotation === null) {
        const result = await createQuotationAction(opportunityId, payload);
        if (!result || !result.ok) {
          setError(result?.message ?? 'The quotation could not be created.');
          return;
        }
        setNotice('Quotation created.');
        router.push(`/crm/quotations/${result.quotation.id}`);
        return;
      }
      const result = await updateDraftQuotationAction(quotation.id, {
        ...payload,
        changeReason: 'Draft edited',
      });
      if (!result || !result.ok) {
        setError(result?.message ?? 'The draft could not be saved.');
        return;
      }
      setNotice('Draft saved.');
      setEditing(false);
      router.refresh();
    } catch {
      setError('That action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSend = () => {
    if (!quotation) return;
    void run(() => sendQuotationAction(quotation.id), 'Quotation sent to the customer.');
  };

  const handleAccept = () => {
    if (!quotation) return;
    void run(() => acceptQuotationAction(quotation.id), 'Quotation accepted. The deal is on record.');
  };

  const handleReject = () => {
    if (!quotation) return;
    void run(() => rejectQuotationAction(quotation.id), 'Quotation rejected.');
  };

  const handleExpire = () => {
    if (!quotation) return;
    void run(() => expireQuotationAction(quotation.id), 'Quotation marked as expired.');
  };

  const handleRevise = async () => {
    if (!quotation) return;
    setBusy(true);
    setError(null);
    try {
      const result = await reviseQuotationAction(quotation.id);
      if (!result || !result.ok) {
        setError(result?.message ?? 'The revision could not be created.');
        return;
      }
      router.push(`/crm/quotations/${result.quotation.id}`);
    } catch {
      setError('That action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const heading = quotation
    ? quotation.quoteNumber
    : `New quotation for ${opportunity?.accountName ?? opportunity?.contactName ?? 'this deal'}`;

  const lineTotal = (item: EditableItem): string => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return '—';
    return formatEgp(round2(round2(quantity) * round2(unitPrice)));
  };

  return (
    <>
      <BackLink
        href={opportunityId ? `/crm/opportunities/${opportunityId}` : '/crm/opportunities'}
        label="Back to opportunity"
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[25px] font-semibold tracking-[-0.035em] text-[#16232c]">
              {heading}
            </h1>
            {quotation ? (
              <span
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[9px] font-bold tracking-[0.08em] ${STATUS_CHIP[quotation.status]}`}
              >
                {QUOTATION_STATUS_LABELS[quotation.status].toUpperCase()}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] text-[#596872]">
            {opportunity?.accountName ?? quotation?.accountName ?? 'No account linked'} ·{' '}
            {opportunity?.contactName ?? quotation?.contactName}
          </p>
          {(() => {
            const phone = opportunity?.contactPhone ?? quotation?.contactPhone ?? null;
            if (!phone) return null;
            const isWhatsApp = opportunity?.contactPhoneIsWhatsApp ?? quotation?.contactPhoneIsWhatsApp;
            return (
              <p className="mt-0.5 flex items-center gap-2 text-[10px] text-[#596872]">
                <a href={`tel:${phone}`} className="font-semibold text-[#188c81] hover:underline">
                  {phone}
                </a>
                {isWhatsApp ? (
                  <a
                    href={`https://wa.me/${phone.replace(/[^0-9]/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-[#e8f8f1] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.06em] text-[#14815f]"
                  >
                    WhatsApp
                  </a>
                ) : null}
              </p>
            );
          })()}
          <p className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-[#9aa3aa]">
            {quotation
              ? `Version ${quotation.version}${quotation.previousQuoteNumber ? ` · revises ${quotation.previousQuoteNumber}` : ''} · created by ${quotation.createdByName} on ${quotation.createdAt.toLocaleDateString()}`
              : `Owned by ${opportunity?.ownerName ?? '—'}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {quotation ? (
            <Link
              href={`/crm/quotations/${quotation.id}/print`}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dbe2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
            >
              <CrmIcon name="external" className="h-3.5 w-3.5" />
              Print view
            </Link>
          ) : null}
        </div>
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

      {quotation && quotation.status !== 'DRAFT' ? (
        <div
          className={`mt-5 rounded-xl p-4 ring-1 ${
            quotation.status === 'ACCEPTED'
              ? 'bg-[#e9f7f1] ring-[#bfe5d5]'
              : quotation.status === 'REJECTED'
                ? 'bg-[#fff4f4] ring-[#f0c5c8]'
                : quotation.status === 'EXPIRED'
                  ? 'bg-[#f5f3fd] ring-[#e2ddf5]'
                  : 'bg-[#edf7fd] ring-[#cfe6f5]'
          }`}
        >
          <p className="text-[11px] font-semibold text-[#35434c]">
            This quotation is {QUOTATION_STATUS_LABELS[quotation.status].toLowerCase()}.
            {quotation.sentAt ? ` Sent on ${quotation.sentAt.toLocaleDateString()}.` : null}
            {quotation.acceptedAt ? ` Accepted on ${quotation.acceptedAt.toLocaleDateString()}.` : null}
            {quotation.rejectedAt ? ` Rejected on ${quotation.rejectedAt.toLocaleDateString()}.` : null}
            {quotation.expiredAt ? ` Expired on ${quotation.expiredAt.toLocaleDateString()}.` : null}
          </p>
          <p className="mt-1 text-[10px] text-[#6c7a83]">
            {isRevisionAllowed(quotation.status)
              ? 'A sent quotation cannot be edited. Create a revision to make a new offer; the original stays on record exactly as it was sent.'
              : 'An accepted quotation is final. Close the deal as won from the opportunity page.'}
          </p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {/* Line items. */}
          <section className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
            <div className="flex items-center justify-between gap-3 border-b border-[#e7ebed] px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold tracking-[-0.015em] text-[#1c2831]">Line items</h2>
                <p className="mt-0.5 text-[10px] text-[#8a959d]">
                  {editing ? 'Add, edit or remove the items this quotation prices.' : `${items.length} item${items.length === 1 ? '' : 's'}`}
                </p>
              </div>
              {editing ? (
                <button
                  type="button"
                  onClick={addItem}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dbe2e5] bg-white px-2.5 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
                >
                  <CrmIcon name="plus" className="h-3 w-3" />
                  Add line item
                </button>
              ) : null}
            </div>

            <table className="w-full text-start">
              <thead className="border-b border-[#e5eaec] bg-[#f8fafb] text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                <tr>
                  <th className="px-5 py-3">#</th>
                  <th className="px-3 py-3">Description</th>
                  <th className="w-[100px] px-3 py-3 text-end">Quantity</th>
                  <th className="w-[140px] px-3 py-3 text-end">Unit price</th>
                  <th className="w-[140px] px-3 py-3 text-end">Line total</th>
                  {editing ? <th className="w-[60px] px-3 py-3" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf0f1]">
                {items.map((item, index) => (
                  <tr key={item.key}>
                    <td className="px-5 py-3 text-[10px] font-semibold text-[#9aa3aa]">{index + 1}</td>
                    <td className="px-3 py-3">
                      {editing ? (
                        <textarea
                          rows={1}
                          value={item.description}
                          onChange={(event) => setItem(item.key, { description: event.target.value })}
                          placeholder="What is being quoted?"
                          className="w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 py-1.5 text-[11px] text-[#3c4a54] outline-none placeholder:text-[#a4aeb5] focus:border-[#18b6a4]"
                        />
                      ) : (
                        <span className="text-[11px] font-medium text-[#33414a]">{item.description}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {editing ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.quantity}
                          onChange={(event) => setItem(item.key, { quantity: event.target.value })}
                          className="h-8 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-end text-[11px] text-[#3c4a54] outline-none focus:border-[#18b6a4]"
                        />
                      ) : (
                        <span className="block text-end text-[11px] text-[#33414a]">{item.quantity}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {editing ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(event) => setItem(item.key, { unitPrice: event.target.value })}
                          className="h-8 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-end text-[11px] text-[#3c4a54] outline-none focus:border-[#18b6a4]"
                        />
                      ) : (
                        <span className="block text-end text-[11px] text-[#33414a]">
                          {Number(item.unitPrice).toLocaleString('en-EG', { maximumFractionDigits: 2 })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="block text-end text-[11px] font-semibold text-[#2c3a43]">
                        {lineTotal(item)}
                      </span>
                    </td>
                    {editing ? (
                      <td className="px-3 py-3 text-end">
                        <button
                          type="button"
                          onClick={() => removeItem(item.key)}
                          disabled={items.length === 1}
                          title="Remove line item"
                          className="grid h-7 w-7 place-items-center rounded-md text-[#a4aeb5] transition hover:bg-[#fff0f1] hover:text-[#c43f47] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <CrmIcon name="x" className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Commercial fields. */}
          <section className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
            <div className="border-b border-[#e7ebed] px-5 py-4">
              <h2 className="text-sm font-semibold tracking-[-0.015em] text-[#1c2831]">Commercial terms</h2>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                    Discount (EGP)
                  </span>
                  {editing ? (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={discountAmount}
                      onChange={(event) => setDiscountAmount(event.target.value)}
                      className="mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#3c4a54] outline-none focus:border-[#18b6a4]"
                    />
                  ) : (
                    <p className="mt-1.5 flex h-9 items-center text-[11px] font-medium text-[#3c4a54]">
                      {formatEgp(Number(discountAmount))}
                    </p>
                  )}
                </label>
                <label className="block">
                  <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                    Tax (EGP)
                  </span>
                  {editing ? (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={taxAmount}
                      onChange={(event) => setTaxAmount(event.target.value)}
                      className="mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#3c4a54] outline-none focus:border-[#18b6a4]"
                    />
                  ) : (
                    <p className="mt-1.5 flex h-9 items-center text-[11px] font-medium text-[#3c4a54]">
                      {formatEgp(Number(taxAmount))}
                    </p>
                  )}
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                    Valid until
                  </span>
                  {editing ? (
                    <input
                      type="date"
                      value={validUntil}
                      onChange={(event) => setValidUntil(event.target.value)}
                      className="mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#3c4a54] outline-none focus:border-[#18b6a4]"
                    />
                  ) : (
                    <p className="mt-1.5 flex h-9 items-center text-[11px] font-medium text-[#3c4a54]">
                      {quotation?.validUntil
                        ? new Date(quotation.validUntil).toLocaleDateString()
                        : 'No expiry set'}
                    </p>
                  )}
                </label>
              </div>

              <label className="block">
                <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                  Commercial notes
                </span>
                {editing ? (
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Delivery, installation or scope notes for the team."
                    className="mt-1.5 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 py-2 text-[11px] text-[#3c4a54] outline-none placeholder:text-[#a4aeb5] focus:border-[#18b6a4]"
                  />
                ) : (
                  <p className="mt-1.5 whitespace-pre-line text-[11px] leading-5 text-[#46545d]">
                    {quotation?.notes ?? 'No notes.'}
                  </p>
                )}
              </label>

              <label className="block">
                <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                  Terms and conditions
                </span>
                {editing ? (
                  <textarea
                    rows={3}
                    value={termsConditions}
                    onChange={(event) => setTermsConditions(event.target.value)}
                    placeholder="Payment terms, warranty and validity shown to the customer."
                    className="mt-1.5 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 py-2 text-[11px] text-[#3c4a54] outline-none placeholder:text-[#a4aeb5] focus:border-[#18b6a4]"
                  />
                ) : (
                  <p className="mt-1.5 whitespace-pre-line text-[11px] leading-5 text-[#46545d]">
                    {quotation?.termsConditions ?? 'No terms set.'}
                  </p>
                )}
              </label>
            </div>
          </section>

          {/* Version history. */}
          {quotation ? (
            <section className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
              <div className="border-b border-[#e7ebed] px-5 py-4">
                <h2 className="text-sm font-semibold tracking-[-0.015em] text-[#1c2831]">Version history</h2>
                <p className="mt-0.5 text-[10px] text-[#8a959d]">
                  A saved copy of this quotation at every change
                </p>
              </div>
              {snapshots.length === 0 ? (
                <p className="px-5 py-6 text-[11px] text-[#8b969e]">No snapshots recorded.</p>
              ) : (
                <ol className="divide-y divide-[#edf0f1]">
                  {snapshots.map((snapshot) => (
                    <li key={snapshot.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                      <span className="text-[11px] font-bold text-[#188c81]">v{snapshot.version}</span>
                      <span
                        className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-bold tracking-[0.06em] ${STATUS_CHIP[snapshot.status]}`}
                      >
                        {snapshot.status}
                      </span>
                      <span className="text-[11px] font-semibold text-[#2c3a43]">
                        {formatEgp(snapshot.totalAmount)}
                      </span>
                      <span className="text-[10px] text-[#74818a]">
                        {snapshot.changeReason}
                        {snapshot.changedByName ? ` · by ${snapshot.changedByName}` : null}
                      </span>
                      <span className="ms-auto text-[9px] text-[#929da4]">
                        {snapshot.changedAt.toLocaleDateString()}{' '}
                        {snapshot.changedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-4">
          {/* Totals. */}
          <section className="rounded-xl bg-white p-5 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
            <h2 className="text-xs font-semibold text-[#2b3841]">Totals</h2>
            <div className="mt-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#7b8790]">Subtotal</span>
                <span className="text-[11px] font-semibold text-[#33414a]">{formatEgp(totals.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#7b8790]">Discount</span>
                <span className="text-[11px] font-semibold text-[#b45b1b]">
                  − {formatEgp(Number(discountAmount) || 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#7b8790]">Tax</span>
                <span className="text-[11px] font-semibold text-[#33414a]">
                  + {formatEgp(Number(taxAmount) || 0)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-[#edf0f1] pt-3">
                <span className="text-[11px] font-bold text-[#202d35]">Total</span>
                <span className="text-[17px] font-semibold tracking-[-0.03em] text-[#17242d]">
                  {formatEgp(totals.total)}
                </span>
              </div>
            </div>
            {editing ? (
              <p className="mt-3 text-[9px] leading-4 text-[#98a2a9]">
                This is a preview. Totals are recalculated from the line items when you save.
              </p>
            ) : null}
          </section>

          {/* Actions. */}
          <section className="rounded-xl bg-white p-5 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8]">
            <h2 className="text-xs font-semibold text-[#2b3841]">
              {quotation === null ? 'Create' : QUOTATION_STATUS_LABELS[quotation.status]}
            </h2>
            <div className="mt-4 flex flex-col gap-2">
              {editing ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSave}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#132932] px-3 text-[11px] font-semibold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
                  >
                    <CrmIcon name="check" className="h-3.5 w-3.5" />
                    Save draft
                  </button>
                  {quotation ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setEditing(false)}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#dbe2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa] disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  {quotation?.status === 'DRAFT' ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setEditing(true)}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#dbe2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa] disabled:opacity-60"
                      >
                        <CrmIcon name="edit" className="h-3.5 w-3.5" />
                        Edit draft
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleSend}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#132932] px-3 text-[11px] font-semibold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
                      >
                        <CrmIcon name="mail" className="h-3.5 w-3.5" />
                        Mark as sent
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleExpire}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#dbe2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa] disabled:opacity-60"
                      >
                        <CrmIcon name="clock" className="h-3.5 w-3.5" />
                        Mark expired
                      </button>
                    </>
                  ) : null}

                  {quotation?.status === 'SENT' ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleAccept}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#14815f] px-3 text-[11px] font-semibold text-white transition hover:bg-[#0f6d50] disabled:opacity-60"
                      >
                        <CrmIcon name="check" className="h-3.5 w-3.5" />
                        Mark accepted
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleReject}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#f0c5c8] bg-white px-3 text-[11px] font-semibold text-[#b83c43] transition hover:bg-[#fff5f5] disabled:opacity-60"
                      >
                        <CrmIcon name="x" className="h-3.5 w-3.5" />
                        Mark rejected
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleExpire}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#dbe2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa] disabled:opacity-60"
                      >
                        <CrmIcon name="clock" className="h-3.5 w-3.5" />
                        Mark expired
                      </button>
                    </>
                  ) : null}

                  {quotation && isRevisionAllowed(quotation.status) ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleRevise}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#132932] px-3 text-[11px] font-semibold text-white transition hover:bg-[#1b3944] disabled:opacity-60"
                    >
                      <CrmIcon name="quotation" className="h-3.5 w-3.5" />
                      Create revision
                    </button>
                  ) : null}
                </>
              )}
            </div>
            {quotation === null ? (
              <p className="mt-3 text-[9px] leading-4 text-[#98a2a9]">
                Saving creates a numbered draft quotation. You can keep editing it until you mark
                it as sent.
              </p>
            ) : null}
          </section>
        </aside>
      </div>
    </>
  );
}
