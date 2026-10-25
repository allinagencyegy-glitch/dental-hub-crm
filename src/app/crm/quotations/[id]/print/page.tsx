import Link from 'next/link';
import { requirePermission } from '@/server/auth/dal';
import { notFound } from 'next/navigation';
import { getLocale, getMessages } from '@/i18n/server';
import { formatters } from '@/i18n/format';
import { getQuotationAction } from '@/server/crm/quotations/actions';
import { PrintButton } from './PrintButton';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.quotations.print.pageTitle) };
}

interface PrintQuotationPageProps {
  params: Promise<{ id: string }>;
}

export default async function PrintQuotationPage({ params }: PrintQuotationPageProps) {
  await requirePermission('quotations:read');
  const { id } = await params;

  const quotation = await getQuotationAction(id);
  if (!quotation) notFound();

  const m = await getMessages();
  const f = formatters(await getLocale());
  const t = m.quotations;
  const status = m.quotationStatus[quotation.status];

  return (
    <div className="print:bg-white">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/crm/quotations/${quotation.id}`}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dbe2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
        >
          {t.print.backToQuotation}
        </Link>
        <PrintButton />
      </div>

      {/* The customer-facing document sheet. */}
      <article className="mx-auto max-w-[820px] rounded-xl bg-white p-10 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#dfe5e8] print:max-w-none print:rounded-none print:p-0 print:shadow-none print:ring-0">
        {/* Header: Dental Hub identity. */}
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-[#101c24] pb-6">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-[#18b6a4]">
              <span className="text-lg font-bold tracking-[-0.08em] text-white">DH</span>
            </div>
            <div>
              <p className="text-[17px] font-semibold tracking-[-0.02em] text-[#101c24]">{m.app.brand}</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#18a897]">
                {t.print.documentKind}
              </p>
            </div>
          </div>
          <div className="text-end">
            <p className="text-[19px] font-semibold tracking-[-0.03em] text-[#17242d]">
              {quotation.quoteNumber}
            </p>
            <p className="mt-1 text-[10px] text-[#6c7a83]">
              {status}
              {quotation.version > 1 ? t.print.versionSuffix(quotation.version) : null}
            </p>
          </div>
        </header>

        {/* Document facts and customer block. */}
        <section className="grid gap-6 py-6 sm:grid-cols-2">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#9aa3aa]">{t.print.preparedFor}</p>
            <p className="mt-2 text-[13px] font-semibold text-[#202d35]">
              {quotation.accountName ?? quotation.contactName}
            </p>
            <p className="mt-0.5 text-[11px] text-[#46545d]">{quotation.contactName}</p>
            {quotation.contactPhone ? (
              <p className="mt-0.5 text-[11px] text-[#46545d]">
                <span dir="ltr">{quotation.contactPhone}</span>
              </p>
            ) : null}
            {quotation.contactEmail ? (
              <p className="mt-0.5 text-[11px] text-[#46545d]">
                <span dir="ltr">{quotation.contactEmail}</span>
              </p>
            ) : null}
          </div>
          <div className="sm:text-end">
            <div className="sm:inline-block sm:text-start">
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#9aa3aa]">{t.print.quotationDate}</p>
              <p className="mt-2 text-[11px] font-medium text-[#33414a]">{f.date(quotation.createdAt)}</p>
              {quotation.validUntil ? (
                <>
                  <p className="mt-3 text-[9px] font-bold uppercase tracking-[0.12em] text-[#9aa3aa]">
                    {t.validUntil}
                  </p>
                  <p className="mt-2 text-[11px] font-medium text-[#33414a]">{f.date(quotation.validUntil)}</p>
                </>
              ) : null}
            </div>
          </div>
        </section>

        {/* Line items. */}
        <section className="overflow-hidden rounded-lg ring-1 ring-[#dfe5e8]">
          <table className="w-full text-start">
            <thead className="bg-[#f8fafb] text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
              <tr>
                <th className="px-4 py-3 text-start">{t.columns.number}</th>
                <th className="px-3 py-3 text-start">{t.columns.description}</th>
                <th className="w-[90px] px-3 py-3 text-end">{t.columns.quantity}</th>
                <th className="w-[130px] px-3 py-3 text-end">{t.columns.unitPrice}</th>
                <th className="w-[130px] px-4 py-3 text-end">{t.columns.total}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f1]">
              {quotation.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 text-[10px] font-semibold text-[#9aa3aa]">{item.sequence}</td>
                  <td className="px-3 py-3 text-[11px] font-medium text-[#33414a]">{item.description}</td>
                  <td className="px-3 py-3 text-end text-[11px] text-[#33414a]">{f.number(item.quantity)}</td>
                  <td className="px-3 py-3 text-end text-[11px] text-[#33414a]">{f.number(item.unitPrice)}</td>
                  <td className="px-4 py-3 text-end text-[11px] font-semibold text-[#2c3a43]">
                    {f.currencyExact(item.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Totals. */}
        <section className="mt-6 flex justify-end">
          <div className="w-full max-w-[280px] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#7b8790]">{t.subtotal}</span>
              <span className="text-[11px] font-semibold text-[#33414a]">{f.currencyExact(quotation.subtotal)}</span>
            </div>
            {quotation.discountAmount > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#7b8790]">{t.discount}</span>
                <span className="text-[11px] font-semibold text-[#b45b1b]">
                  − {f.currencyExact(quotation.discountAmount)}
                </span>
              </div>
            ) : null}
            {quotation.taxAmount > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#7b8790]">{t.tax}</span>
                <span className="text-[11px] font-semibold text-[#33414a]">
                  + {f.currencyExact(quotation.taxAmount)}
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between border-t-2 border-[#101c24] pt-3">
              <span className="text-[12px] font-bold text-[#202d35]">{t.total}</span>
              <span className="text-[18px] font-semibold tracking-[-0.03em] text-[#17242d]">
                {f.currencyExact(quotation.totalAmount)}
              </span>
            </div>
          </div>
        </section>

        {/* Notes and terms. */}
        {quotation.notes || quotation.termsConditions ? (
          <section className="mt-8 space-y-4">
            {quotation.notes ? (
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#9aa3aa]">{t.print.notes}</p>
                <p className="mt-1.5 whitespace-pre-line text-[11px] leading-5 text-[#46545d]">
                  {quotation.notes}
                </p>
              </div>
            ) : null}
            {quotation.termsConditions ? (
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#9aa3aa]">
                  {t.terms}
                </p>
                <p className="mt-1.5 whitespace-pre-line text-[11px] leading-5 text-[#46545d]">
                  {quotation.termsConditions}
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        <footer className="mt-10 border-t border-[#e5eaec] pt-4 text-[9px] leading-4 text-[#98a2a9]">
          <p>
            {t.print.footer(
              quotation.quoteNumber,
              status,
              quotation.sentAt ? f.date(quotation.sentAt) : null,
              quotation.createdByName,
            )}
          </p>
        </footer>
      </article>
    </div>
  );
}
