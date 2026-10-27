import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/server/auth/dal';
import { getLocale, getMessages } from '@/i18n/server';
import { catalogLabel, formatters } from '@/i18n/format';
import { getCustomerAction } from '@/server/crm/customers/actions';
import type { CustomerDeal } from '@/server/crm/customers/repository';
import { isOpportunityStage, type OpportunityStage } from '@/server/crm/opportunities/stage';
import { isQuotationStatus, type QuotationStatus } from '@/server/crm/quotations/status';
import { Avatar, BackLink } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.customers.detail.pageTitle) };
}

const STAGE_CHIP: Record<OpportunityStage, string> = {
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

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('opportunities:read');
  const { id } = await params;
  const customer = await getCustomerAction(id);
  // Missing and out of scope resolve the same way: no existence leak.
  if (!customer) notFound();

  const m = await getMessages();
  const format = formatters(await getLocale());
  const t = m.customers.detail;

  const stageLabel = (stage: string) => (isOpportunityStage(stage) ? m.opportunityStage[stage] : stage);
  const stageChip = (stage: string) => (isOpportunityStage(stage) ? STAGE_CHIP[stage] : STAGE_CHIP.ON_HOLD);
  const categoryLabel = (deal: CustomerDeal) =>
    deal.categoryName ? catalogLabel(m.catalog.productCategories, deal.categoryCode, deal.categoryName) : t.noCategory;

  const cards = [
    { key: 'purchases', label: t.purchasesCard, value: String(customer.summary.purchases), hint: null },
    {
      key: 'value',
      label: t.valueCard,
      value: customer.summary.totalValue === null ? t.notRecorded : format.currency(customer.summary.totalValue),
      hint: customer.summary.purchasesWithoutValue > 0 ? t.withoutValue(customer.summary.purchasesWithoutValue) : null,
    },
    { key: 'last', label: t.lastPurchaseCard, value: format.date(customer.summary.lastPurchaseAt), hint: null },
    { key: 'open', label: t.openDealsCard, value: String(customer.summary.openDeals), hint: null },
  ];

  const dealRow = (deal: CustomerDeal, dateLine: string, showItems: boolean) => (
    <li key={deal.opportunityId} className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-[#1c2831]">{categoryLabel(deal)}</span>
            <span
              className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] ${stageChip(deal.stage)}`}
            >
              {stageLabel(deal.stage)}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-[#8a959d]">
            {dateLine} · {t.owner}: {deal.ownerName}
          </p>
          {deal.acceptedQuotation ? (
            <Link
              href={`/crm/quotations/${deal.acceptedQuotation.id}`}
              className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-[#188c81] hover:underline"
            >
              <CrmIcon name="quotation" className="h-3 w-3" />
              {t.viaQuotation(deal.acceptedQuotation.quoteNumber)}
            </Link>
          ) : null}
        </div>
        <div className="text-end">
          <p className="whitespace-nowrap text-[13px] font-semibold text-[#2c3a43]">
            {deal.value === null ? <span className="text-[11px] font-medium text-[#a4aeb5]">{t.notRecorded}</span> : format.currency(deal.value)}
          </p>
          <Link
            href={`/crm/opportunities/${deal.opportunityId}`}
            className="mt-1 inline-block text-[10px] font-semibold text-[#188c81] hover:underline"
          >
            {t.openDeal}
          </Link>
        </div>
      </div>
      {showItems && deal.items.length > 0 ? (
        <ul className="mt-2.5 space-y-1 rounded-lg bg-[#f7f9fa] px-3 py-2.5">
          {deal.items.map((item, index) => (
            <li key={index} className="flex justify-between gap-3 text-[10px] text-[#394750]">
              <span className="min-w-0">{item.description}</span>
              <span className="shrink-0 text-[#8a959d]">× {item.quantity}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );

  return (
    <>
      <BackLink href="/crm/customers" label={t.back} />
      <div className="flex min-w-0 items-center gap-4">
        <Avatar name={customer.name} size="lg" />
        <div className="min-w-0">
          <h1 className="text-[25px] font-semibold tracking-[-0.035em] text-[#1c2831]">{customer.name}</h1>
          <p className="mt-1 text-[11px] text-[#8a959d]">
            {t.customerSince(format.date(customer.summary.firstPurchaseAt))}
            {customer.accountNames.length > 0 ? ` · ${customer.accountNames.join(' · ')}` : ''}
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((card) => (
          <div key={card.key} className="rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#e4e9eb]">
            <p className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#7e8992]">{card.label}</p>
            <p className="mt-2.5 text-[20px] font-semibold tracking-[-0.04em] text-[#17242c]">{card.value}</p>
            {card.hint ? <p className="mt-0.5 text-[10px] text-[#89949c]">{card.hint}</p> : null}
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-xl border border-[#dfe5e8] bg-white p-5">
            <h2 className="text-sm font-semibold text-[#1c2831]">{t.purchaseHistory}</h2>
            <p className="mt-0.5 text-[10px] text-[#8a959d]">{t.purchaseHistoryHint}</p>
            <ul className="mt-4 divide-y divide-[#edf0f1] border-t border-[#e5eaec] pt-4">
              {customer.purchases.map((deal) => dealRow(deal, t.wonOn(format.date(deal.wonAt!)), true))}
            </ul>
          </section>

          <section className="rounded-xl border border-[#dfe5e8] bg-white p-5">
            <h2 className="text-sm font-semibold text-[#1c2831]">{t.openDeals}</h2>
            <p className="mt-0.5 text-[10px] text-[#8a959d]">{t.openDealsHint}</p>
            {customer.openDeals.length === 0 ? (
              <p className="mt-4 border-t border-[#e5eaec] pt-4 text-[11px] text-[#89949c]">{t.noOpenDeals}</p>
            ) : (
              <ul className="mt-4 divide-y divide-[#edf0f1] border-t border-[#e5eaec] pt-4">
                {customer.openDeals.map((deal) => dealRow(deal, t.openedOn(format.date(deal.createdAt)), false))}
              </ul>
            )}
          </section>

          {customer.lostDeals.length > 0 ? (
            <section className="rounded-xl border border-[#dfe5e8] bg-white p-5">
              <h2 className="text-sm font-semibold text-[#1c2831]">{t.lostDeals}</h2>
              <ul className="mt-4 divide-y divide-[#edf0f1] border-t border-[#e5eaec] pt-4">
                {customer.lostDeals.map((deal) => dealRow(deal, t.lostOn(format.date(deal.lostAt!)), false))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="space-y-5">
          <section className="rounded-xl border border-[#dfe5e8] bg-white p-5">
            <h2 className="text-sm font-semibold text-[#1c2831]">{t.contact}</h2>
            <dl className="mt-4 space-y-3 border-t border-[#e5eaec] pt-4 text-[11px]">
              <div>
                <dt className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#9aa3aa]">{t.phone}</dt>
                {customer.phones.length === 0 ? (
                  <dd className="mt-0.5 text-[#a4aeb5]">{t.notRecorded}</dd>
                ) : (
                  customer.phones.map((phone) => (
                    <dd key={phone.value} className="mt-1 flex flex-wrap items-center gap-2">
                      <a href={`tel:${phone.value}`} className="font-semibold text-[#188c81] hover:underline">
                        <bdi dir="ltr">{phone.value}</bdi>
                      </a>
                      {phone.isWhatsApp ? (
                        <a
                          href={`https://wa.me/${phone.value.replace(/[^0-9]/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full bg-[#e8f8f1] px-2 py-0.5 text-[9px] font-semibold text-[#14815f]"
                        >
                          <CrmIcon name="message" className="h-3 w-3" />
                          {t.whatsapp}
                        </a>
                      ) : null}
                    </dd>
                  ))
                )}
              </div>
              <div>
                <dt className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#9aa3aa]">{t.email}</dt>
                <dd className="mt-0.5 font-medium text-[#33414a]">
                  {customer.email ? <bdi dir="ltr">{customer.email}</bdi> : <span className="text-[#a4aeb5]">{t.notRecorded}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#9aa3aa]">{t.clinic}</dt>
                <dd className="mt-0.5 font-medium text-[#33414a]">
                  {customer.accountNames.length > 0 ? customer.accountNames.join(' · ') : <span className="text-[#a4aeb5]">{t.notRecorded}</span>}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-[#dfe5e8] bg-white p-5">
            <h2 className="text-sm font-semibold text-[#1c2831]">{t.quotations}</h2>
            <p className="mt-0.5 text-[10px] text-[#8a959d]">{t.quotationsHint}</p>
            {customer.quotations.length === 0 ? (
              <p className="mt-4 border-t border-[#e5eaec] pt-4 text-[11px] text-[#89949c]">{t.noQuotations}</p>
            ) : (
              <ul className="mt-4 divide-y divide-[#edf0f1] border-t border-[#e5eaec]">
                {customer.quotations.map((quotation) => (
                  <li key={quotation.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <Link href={`/crm/quotations/${quotation.id}`} className="text-[11px] font-bold text-[#188c81] hover:underline">
                        <bdi dir="ltr">{quotation.quoteNumber}</bdi>
                      </Link>
                      <p className="mt-0.5 text-[9px] text-[#929da4]">{format.date(quotation.updatedAt)}</p>
                    </div>
                    <div className="text-end">
                      <p className="whitespace-nowrap text-[11px] font-semibold text-[#2c3a43]">{format.currency(quotation.totalAmount)}</p>
                      {isQuotationStatus(quotation.status) ? (
                        <span
                          className={`mt-1 inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] ${QUOTATION_CHIP[quotation.status]}`}
                        >
                          {m.quotationStatus[quotation.status]}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
