import Link from 'next/link';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { Avatar, BackLink, Badge, DetailAction, InfoLine } from '@/components/crm/Ui';
import { formatEgp, leads, opportunities, opportunityActivities } from '@/lib/crm-ui/mock-data';

const stages = ['Qualification', 'Quotation', 'Negotiation'];

export default function OpportunityDetailPage() {
  const opportunity = opportunities[0];
  const sourceLead = leads[0];

  return <>
    <BackLink href="/crm/ui-preview/pipeline" label="Back to sales pipeline" />
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5"><h1 className="text-[25px] font-semibold tracking-[-0.035em] text-[#17242d]">{opportunity.account}</h1><Badge value={opportunity.stage} dot /></div>
        <p className="mt-1 text-[11px] text-[#596872]">{opportunity.product}</p>
        <p className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-[#9aa3aa]">Opportunity reference {opportunity.id}</p>
      </div>
      <div>
        <p className="mb-1.5 text-right text-[9px] font-medium text-[#929ca3]">Preview actions · changes are not saved</p>
        <div className="flex flex-wrap justify-end gap-2"><DetailAction icon="phone">Log call</DetailAction><DetailAction icon="activity">Add activity</DetailAction><DetailAction icon="check" primary>Mark as Won</DetailAction></div>
      </div>
    </div>

    <div className="mt-6 rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-[#dfe5e8]">
      <div className="flex items-center gap-2">
        {stages.map((stage, index) => <div key={stage} className="flex min-w-0 flex-1 items-center gap-2">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#18b6a4] text-[9px] font-bold text-white">{index < 2 ? <CrmIcon name="check" className="h-3 w-3" /> : index + 1}</div>
          <div className="min-w-0 flex-1"><p className={`truncate text-[9px] font-bold uppercase tracking-[0.08em] ${index === 2 ? 'text-[#148c80]' : 'text-[#6e7b84]'}`}>{stage}</p>{index < stages.length - 1 ? <div className="mt-1.5 h-1 rounded-full bg-[#18b6a4]" /> : null}</div>
        </div>)}
      </div>
    </div>

    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">
      <div className="min-w-0 space-y-5">
        <section className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          <div className="rounded-xl bg-white p-4 ring-1 ring-[#dfe5e8]"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">Expected amount</p><p className="mt-3 text-[22px] font-semibold tracking-[-0.04em] text-[#17242d]">{formatEgp(opportunity.amount)}</p><p className="mt-1 text-[9px] text-[#89949c]">Currency: EGP</p></div>
          <div className="rounded-xl bg-white p-4 ring-1 ring-[#dfe5e8]"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">Current stage</p><p className="mt-3 text-[22px] font-semibold text-[#17242d]">Negotiation</p><p className="mt-1 text-[9px] text-[#89949c]">Commercial terms in review</p></div>
          <div className="rounded-xl bg-white p-4 ring-1 ring-[#dfe5e8]"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">Opportunity status</p><p className="mt-3 text-[22px] font-semibold text-[#17242d]">Active</p><p className="mt-1 text-[9px] text-[#89949c]">Not On Hold, Won or Lost</p></div>
          <div className="rounded-xl bg-white p-4 ring-1 ring-[#dfe5e8]"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">Sales owner</p><div className="mt-3 flex items-center gap-2"><Avatar name={opportunity.owner} size="md" /><p className="text-[13px] font-semibold text-[#17242d]">{opportunity.owner}</p></div><p className="mt-1 text-[9px] text-[#89949c]">Primary opportunity owner</p></div>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-[#dfe5e8]">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-[#202d35]">Opportunity details</h2><p className="mt-0.5 text-[10px] text-[#8c969d]">Commercial, ownership and attribution fields</p></div><button type="button" title="Preview only — changes are not saved" className="text-[10px] font-bold text-[#128c80]">Edit details</button></div>
          <div className="mt-4 grid gap-x-8 border-t border-[#edf0f1] pt-3 sm:grid-cols-2">
            <InfoLine icon="building" label="Account" value={opportunity.account} />
            <InfoLine icon="team" label="Primary contact" value={opportunity.contact} />
            <InfoLine icon="phone" label="Contact phone" value={opportunity.phone} />
            <InfoLine icon="sparkles" label="Product interest" value={opportunity.product} />
            <InfoLine icon="money" label="Expected amount" value={formatEgp(opportunity.amount)} />
            <InfoLine icon="money" label="Currency" value="EGP — Egyptian Pound" />
            <InfoLine icon="team" label="Opportunity owner" value={opportunity.owner} />
            <InfoLine icon="target" label="Status" value="Active" />
            <InfoLine icon="leads" label="Source attribution" value={`${sourceLead.source} · ${sourceLead.channel}`} />
            <InfoLine icon="leads" label="Source lead" value={opportunity.sourceLead ?? 'Direct opportunity'} />
          </div>
          <div className="mt-3 rounded-lg bg-[#f6f8f9] p-4"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">Sales context</p><p className="mt-2 text-[11px] leading-5 text-[#46545d]">{opportunity.note}</p></div>
        </section>

        <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-[#dfe5e8]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e7ebed] px-5 py-4"><div><h2 className="text-sm font-semibold text-[#202d35]">Opportunity timeline</h2><p className="mt-0.5 text-[10px] text-[#8b969e]">Stage, commercial and contact history</p></div><button type="button" title="Preview only — changes are not saved" className="text-[10px] font-bold text-[#118e82]">+ Add activity</button></div>
          <div className="divide-y divide-[#edf0f1]">{opportunityActivities.map((activity) => <div key={activity.id} className="flex gap-3.5 px-5 py-4"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#edf6f5] text-[#16877b]"><CrmIcon name={activity.type === 'Email' ? 'mail' : activity.type === 'Meeting' ? 'meeting' : 'pipeline'} className="h-3.5 w-3.5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-2"><p className="text-[11px] font-semibold text-[#35424b]">{activity.title}</p><span className="whitespace-nowrap text-[9px] text-[#929ca3]">{activity.time}</span></div><p className="mt-1 text-[10px] leading-4 text-[#74818a]">{activity.detail}</p><p className="mt-1 text-[9px] font-medium text-[#9aa3a9]">{activity.actor}</p></div></div>)}</div>
        </section>
      </div>

      <aside className="min-w-0 space-y-4">
        <section className="rounded-xl bg-[#fff0f1] p-5 ring-1 ring-[#f0c5c8]">
          <div className="flex items-center gap-2 text-[#bd3d45]"><CrmIcon name="alert" className="h-4 w-4" /><p className="text-[9px] font-bold uppercase tracking-[0.1em]">Overdue next action</p></div>
          <h2 className="mt-4 text-[15px] font-semibold text-[#3f2b2d]">{opportunity.nextAction}</h2>
          <p className="mt-1.5 text-[10px] leading-4 text-[#836467]">Call {opportunity.contact} and confirm the chosen configuration before the offer window closes.</p>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#edcfd1] pt-4"><div><p className="text-[9px] text-[#a87579]">Due {opportunity.dueLabel}</p><p className="mt-0.5 text-xs font-bold text-[#b83c43]">{opportunity.dueAt}</p></div><button type="button" title="Preview only — changes are not saved" className="rounded-lg bg-[#bd4047] px-3 py-2 text-[10px] font-bold text-white">Complete action</button></div>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-[#dfe5e8]">
          <div className="flex items-center justify-between gap-3"><h2 className="text-xs font-semibold text-[#2b3841]">Primary contact</h2><Link href="/crm/ui-preview/customers/fathy-dental-clinic" className="text-[9px] font-bold text-[#128c80]">Open account</Link></div>
          <div className="mt-4 flex items-center gap-3"><Avatar name={opportunity.contact} size="md" /><div><p className="text-[11px] font-semibold text-[#35424b]">{opportunity.contact}</p><p className="mt-0.5 text-[9px] text-[#909aa1]">Decision maker</p></div></div>
          <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" title="Preview only — changes are not saved" className="flex items-center justify-center gap-1.5 rounded-lg bg-[#f3f6f7] py-2.5 text-[9px] font-semibold text-[#53616a]"><CrmIcon name="phone" className="h-3 w-3" />Call</button><button type="button" title="Preview only — changes are not saved" className="flex items-center justify-center gap-1.5 rounded-lg bg-[#edf8f5] py-2.5 text-[9px] font-semibold text-[#168275]"><CrmIcon name="message" className="h-3 w-3" />WhatsApp</button></div>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-[#dfe5e8]">
          <div className="flex items-center justify-between gap-3"><h2 className="text-xs font-semibold text-[#2b3841]">Commercial document</h2><Badge value="QUOTATION" /></div>
          <div className="mt-4 rounded-lg bg-[#f6f8f9] p-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-white text-[#4387b4] ring-1 ring-[#dfe5e8]"><CrmIcon name="quotation" className="h-4 w-4" /></span><div><p className="text-[10px] font-semibold text-[#35424b]">QT-2026-0187</p><p className="mt-0.5 text-[9px] text-[#8d979f]">Sent 15 Sep 2026 · Revision 2</p></div></div></div>
          <div className="mt-3 flex justify-between text-[10px]"><span className="text-[#89949c]">Quoted total</span><strong className="font-semibold text-[#35424b]">{formatEgp(opportunity.amount)}</strong></div>
          <p className="mt-3 border-t border-[#edf0f1] pt-3 text-[9px] leading-4 text-[#8b969e]">Quotation workspace is planned. Reference shown for commercial context only.</p>
        </section>
      </aside>
    </div>
  </>;
}
