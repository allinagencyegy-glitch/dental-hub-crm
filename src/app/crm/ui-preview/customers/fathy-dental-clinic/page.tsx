import Link from 'next/link';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { Avatar, BackLink, Badge, DetailAction, InfoLine } from '@/components/crm/Ui';
import { customers, formatEgp, leads, opportunities } from '@/lib/crm-ui/mock-data';

export default function CustomerDetailPage() {
  const customer = customers[0];
  const opportunity = opportunities[0];
  const sourceLead = leads[0];

  return <>
    <BackLink href="/crm/ui-preview/customers" label="Back to customers & accounts" />
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-[#dff4f1] text-[#0d8175] ring-1 ring-[#bce6df]"><CrmIcon name="building" className="h-6 w-6" /></span>
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2.5"><h1 className="text-[25px] font-semibold tracking-[-0.035em] text-[#17242d]">{customer.clinic}</h1><Badge value={customer.lifecycle} dot /></div><p className="mt-1 text-[11px] text-[#7e8992]">Business account · {customer.city} · CRM record since {customer.since}</p></div>
      </div>
      <div>
        <p className="mb-1.5 text-right text-[9px] font-medium text-[#929ca3]">Preview actions · changes are not saved</p>
        <div className="flex flex-wrap justify-end gap-2"><DetailAction icon="phone">Log call</DetailAction><DetailAction icon="message">WhatsApp</DetailAction><DetailAction icon="plus" primary>New opportunity</DetailAction></div>
      </div>
    </div>

    <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-white p-4 ring-1 ring-[#dfe5e8]"><p className="text-[9px] font-bold uppercase tracking-[.1em] text-[#929ca3]">Active opportunities</p><p className="mt-2 text-xl font-semibold text-[#18252e]">{customer.activeOpportunities}</p><p className="mt-1 text-[9px] text-[#89949c]">{formatEgp(customer.activeValue)} open value</p></div>
          <div className="rounded-xl bg-white p-4 ring-1 ring-[#dfe5e8]"><p className="text-[9px] font-bold uppercase tracking-[.1em] text-[#929ca3]">Previous commercial history</p><p className="mt-2 text-xl font-semibold text-[#18252e]">0 won</p><p className="mt-1 text-[9px] text-[#89949c]">No completed orders recorded</p></div>
          <div className="rounded-xl bg-white p-4 ring-1 ring-[#dfe5e8]"><p className="text-[9px] font-bold uppercase tracking-[.1em] text-[#929ca3]">Last recorded activity</p><p className="mt-2 text-[12px] font-semibold text-[#18252e]">15 Sep 2026 · 05:18 PM</p><p className="mt-1 text-[9px] text-[#89949c]">Opportunity moved to Negotiation</p></div>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-[#dfe5e8]">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-[#202d35]">Account information</h2><p className="mt-0.5 text-[10px] text-[#8c969d]">Primary business record and ownership details</p></div><button type="button" title="Preview only — changes are not saved" className="text-[10px] font-bold text-[#128c80]">Edit account</button></div>
          <div className="mt-4 grid gap-x-8 border-t border-[#edf0f1] pt-3 sm:grid-cols-2"><InfoLine icon="building" label="Account name" value={customer.clinic} /><InfoLine icon="location" label="Location" value={customer.city} /><InfoLine icon="phone" label="Main phone" value={customer.phone} /><InfoLine icon="mail" label="Main email" value={customer.email} /><InfoLine icon="team" label="Account owner" value={customer.owner} /><InfoLine icon="calendar" label="CRM record since" value={customer.since} /></div>
        </section>

        <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-[#dfe5e8]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e7ebed] px-5 py-4"><div><h2 className="text-sm font-semibold text-[#202d35]">Active opportunities</h2><p className="mt-0.5 text-[10px] text-[#8b969e]">Open commercial work linked to this account</p></div><Link href="/crm/ui-preview/pipeline" className="text-[10px] font-bold text-[#118e82]">Open pipeline</Link></div>
          <Link href="/crm/ui-preview/opportunities/OPP-00184" className="group flex flex-wrap items-center gap-4 px-5 py-4 transition hover:bg-[#fafcfc]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#fff0e5] text-[#b45b1b]"><CrmIcon name="target" className="h-4 w-4" /></span>
            <div className="min-w-[180px] flex-1"><p className="text-[11px] font-semibold text-[#2d3a43] group-hover:text-[#11877b]">{opportunity.product}</p><p className="mt-1 text-[9px] text-[#8c969d]">{opportunity.id} · Owned by {opportunity.owner}</p></div>
            <Badge value="NEGOTIATION" dot />
            <div className="text-right"><p className="text-[12px] font-semibold text-[#29363f]">{formatEgp(opportunity.amount)}</p><p className="mt-1 text-[9px] text-[#be4249]">Next action overdue</p></div>
            <CrmIcon name="chevron" className="h-4 w-4 text-[#9ca5ab]" />
          </Link>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-[#dfe5e8]">
          <h2 className="text-sm font-semibold text-[#202d35]">Commercial & inquiry history</h2>
          <p className="mt-0.5 text-[10px] text-[#8b969e]">Traceable demand and prior outcomes for this account</p>
          <div className="mt-4 divide-y divide-[#edf0f1] border-t border-[#edf0f1]">
            <div className="grid gap-2 py-4 sm:grid-cols-[130px_minmax(0,1fr)_auto]"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">Inquiry history</p><div><p className="text-[11px] font-semibold text-[#35424b]">{sourceLead.source} · {sourceLead.channel}</p><p className="mt-1 text-[9px] leading-4 text-[#7f8b93]">{sourceLead.productInterest} inquiry captured 10 Sep 2026</p></div><Link href="/crm/ui-preview/leads/LEAD-00311" className="text-[9px] font-bold text-[#118e82]">{sourceLead.id}</Link></div>
            <div className="grid gap-2 py-4 sm:grid-cols-[130px_minmax(0,1fr)_auto]"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">Previous commercial</p><div><p className="text-[11px] font-semibold text-[#35424b]">No completed commercial history</p><p className="mt-1 text-[9px] leading-4 text-[#7f8b93]">This prospect has no Won or Lost opportunities and no completed orders.</p></div><span className="text-[9px] font-medium text-[#929ca3]">0 records</span></div>
            <div className="grid gap-2 py-4 sm:grid-cols-[130px_minmax(0,1fr)]"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">Product history</p><div className="flex flex-wrap gap-2">{customer.products.map((product) => <span key={product} className="flex items-center gap-2 rounded-lg bg-[#f1f5f5] px-3 py-2 text-[10px] font-semibold text-[#526069]"><CrmIcon name="sparkles" className="h-3.5 w-3.5 text-[#199487]" />{product}</span>)}</div></div>
          </div>
        </section>
      </div>

      <aside className="min-w-0 space-y-4">
        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-[#dfe5e8]">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-xs font-semibold text-[#2b3841]">Primary contact</h2><p className="mt-0.5 text-[9px] text-[#909aa1]">1 contact linked to this account</p></div><button type="button" title="Preview only — changes are not saved" className="text-[9px] font-bold text-[#128c80]">Edit</button></div>
          <div className="mt-4 flex items-center gap-3"><Avatar name={customer.contact} size="lg" /><div><p className="text-[12px] font-semibold text-[#35424b]">{customer.contact}</p><p className="mt-1 text-[9px] text-[#909aa1]">Decision maker · Account contact</p></div></div>
          <div className="mt-4 space-y-2 border-t border-[#edf0f1] pt-4"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">Contact channels</p><p className="flex items-center gap-2 text-[10px] text-[#627079]"><CrmIcon name="phone" className="h-3.5 w-3.5 text-[#87929a]" />{customer.phone}</p><p className="flex items-center gap-2 break-all text-[10px] text-[#627079]"><CrmIcon name="mail" className="h-3.5 w-3.5 shrink-0 text-[#87929a]" />{customer.email}</p><p className="flex items-center gap-2 text-[10px] text-[#627079]"><CrmIcon name="message" className="h-3.5 w-3.5 text-[#87929a]" />WhatsApp available</p></div>
        </section>

        <section className="rounded-xl bg-[#132932] p-5 text-white shadow-[0_10px_25px_rgba(19,41,50,.12)]">
          <div className="flex items-center gap-2 text-[#75d7cd]"><CrmIcon name="activity" className="h-4 w-4" /><p className="text-[9px] font-bold uppercase tracking-[.1em]">Recent engagement</p></div>
          <h2 className="mt-4 text-[15px] font-semibold">Commercial review recorded</h2>
          <p className="mt-2 text-[10px] leading-4 text-white/50">Negotiation stage recorded 15 Sep 2026 at 05:18 PM after the revised commercial offer.</p>
          <div className="mt-4 rounded-lg bg-white/[0.07] p-3"><p className="text-[9px] text-white/40">Current relationship</p><p className="mt-1 text-[11px] font-semibold">Prospect · Active opportunity</p></div>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-[#dfe5e8]">
          <h2 className="text-xs font-semibold text-[#2b3841]">Account ownership</h2>
          <div className="mt-4 flex items-center gap-3"><Avatar name={customer.owner} size="md" /><div><p className="text-[11px] font-semibold text-[#35424b]">{customer.owner}</p><p className="mt-0.5 text-[9px] text-[#909aa1]">Assigned sales representative</p></div></div>
        </section>
      </aside>
    </div>
  </>;
}
