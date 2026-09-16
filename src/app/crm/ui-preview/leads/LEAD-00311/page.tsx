import Link from 'next/link';
import { Avatar, BackLink, Badge, DetailAction, InfoLine } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { leadActivities, leads } from '@/lib/crm-ui/mock-data';

export default function LeadDetailPage() {
  const lead = leads[0];

  return <>
    <BackLink href="/crm/ui-preview/leads" label="Back to lead inbox" />
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <Avatar name={lead.name} size="lg" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[25px] font-semibold tracking-[-0.035em] text-[#17242d]">{lead.business}</h1>
            <Badge value={lead.status} dot />
          </div>
          <p className="mt-1 text-[11px] text-[#596872]">{lead.name}</p>
          <p className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-[#9aa3aa]">Lead reference {lead.id}</p>
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-right text-[9px] font-medium text-[#929ca3]">Preview actions · changes are not saved</p>
        <div className="flex flex-wrap justify-end gap-2">
          <DetailAction icon="phone">Log call</DetailAction>
          <DetailAction icon="message">WhatsApp</DetailAction>
          <Link href="/crm/ui-preview/opportunities/OPP-00184" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#132932] px-3 text-[11px] font-semibold text-white transition hover:bg-[#1b3944]">
            <CrmIcon name="arrow" className="h-3.5 w-3.5" />Open opportunity
          </Link>
        </div>
      </div>
    </div>

    <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-[#dfe5e8]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[#202d35]">Lead overview</h2>
              <p className="mt-1 text-[10px] text-[#8b969e]">Captured 10 Sep 2026 at {lead.receivedAt}</p>
            </div>
            <div className="flex items-center gap-2"><span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#9aa3aa]">Source</span><Badge value={lead.source} /></div>
          </div>
          <div className="mt-5 grid gap-x-8 border-t border-[#edf0f1] pt-3 sm:grid-cols-2">
            <InfoLine icon="phone" label="Phone" value={lead.phone} />
            <InfoLine icon="mail" label="Email" value={lead.email ?? 'Not provided'} />
            <InfoLine icon="location" label="Location" value={lead.location} />
            <InfoLine icon="leads" label="Channel" value={lead.channel} />
            <InfoLine icon="sparkles" label="Product interest" value={lead.productInterest} />
            <InfoLine icon="team" label="Assigned owner" value={lead.owner} />
          </div>
          <div className="mt-3 rounded-lg bg-[#f6f8f9] p-4">
            <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">Inquiry context</p>
            <p className="mt-2 text-[11px] leading-5 text-[#46545d]">{lead.note}</p>
          </div>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-[#dfe5e8]">
          <h2 className="text-sm font-semibold text-[#202d35]">Contact & account resolution</h2>
          <p className="mt-0.5 text-[10px] text-[#8c969d]">Conversion links created from the original inquiry</p>
          <div className="mt-4 grid gap-3 border-t border-[#edf0f1] pt-4 sm:grid-cols-3">
            <div className="rounded-lg bg-[#f7f9fa] p-3"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">Contact</p><p className="mt-2 text-[11px] font-semibold text-[#35424b]">{lead.name}</p><p className="mt-1 text-[9px] font-medium text-[#168275]">Matched</p></div>
            <div className="rounded-lg bg-[#f7f9fa] p-3"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">Account</p><p className="mt-2 text-[11px] font-semibold text-[#35424b]">{lead.business}</p><p className="mt-1 text-[9px] font-medium text-[#168275]">Matched</p></div>
            <div className="rounded-lg bg-[#edf8f5] p-3"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#648b85]">Conversion result</p><Link href="/crm/ui-preview/opportunities/OPP-00184" className="mt-2 block text-[11px] font-semibold text-[#11877c] hover:underline">OPP-00184</Link><p className="mt-1 text-[9px] text-[#64817d]">Created 11 Sep 2026</p></div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-[#dfe5e8]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e7ebed] px-5 py-4">
            <div><h2 className="text-sm font-semibold text-[#202d35]">Activity timeline</h2><p className="mt-0.5 text-[10px] text-[#8b969e]">Inquiry, qualification and conversion history</p></div>
            <button type="button" title="Preview only — changes are not saved" className="text-[10px] font-bold text-[#118e82]">+ Add note</button>
          </div>
          <div className="px-5 py-2">
            {leadActivities.map((activity, index) => <div key={activity.id} className="relative flex gap-3.5 py-4">
              {index < leadActivities.length - 1 ? <span className="absolute left-[15px] top-11 h-[calc(100%-20px)] w-px bg-[#e1e6e8]" /> : null}
              <span className="z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e8f6f4] text-[#11877c] ring-4 ring-white"><CrmIcon name={activity.type === 'Call' ? 'phone' : activity.type === 'WhatsApp' ? 'message' : 'activity'} className="h-3.5 w-3.5" /></span>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-2"><p className="text-[11px] font-semibold text-[#35424b]">{activity.title}</p><span className="whitespace-nowrap text-[9px] text-[#929ca3]">{activity.time}</span></div><p className="mt-1 text-[10px] leading-4 text-[#74818a]">{activity.detail}</p><p className="mt-1.5 text-[9px] font-medium text-[#9aa3a9]">{activity.actor}</p></div>
            </div>)}
          </div>
        </section>
      </div>

      <aside className="min-w-0 space-y-4">
        <section className="rounded-xl bg-[#132932] p-5 text-white shadow-[0_10px_25px_rgba(19,41,50,.12)]">
          <div className="flex items-center gap-2 text-[#75d7cd]"><CrmIcon name="target" className="h-4 w-4" /><p className="text-[9px] font-bold uppercase tracking-[0.11em]">Next operational step</p></div>
          <h2 className="mt-4 text-[15px] font-semibold">Continue in opportunity</h2>
          <p className="mt-1.5 text-[10px] leading-4 text-white/55">The inquiry is resolved. Commercial follow-up now belongs to OPP-00184.</p>
          <Link href="/crm/ui-preview/opportunities/OPP-00184" className="mt-5 flex items-center justify-between rounded-lg bg-white/[0.07] p-3 text-[10px] font-semibold text-white transition hover:bg-white/[0.12]">Open opportunity <CrmIcon name="arrow" className="h-3.5 w-3.5 text-[#75d7cd]" /></Link>
        </section>
        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-[#dfe5e8]">
          <h2 className="text-xs font-semibold text-[#2b3841]">Lead ownership</h2>
          <div className="mt-4 flex items-center gap-3"><Avatar name={lead.owner} size="md" /><div><p className="text-[11px] font-semibold text-[#35424b]">{lead.owner}</p><p className="mt-0.5 text-[9px] text-[#909aa1]">Assigned sales representative</p></div><button type="button" title="Preview only — changes are not saved" className="ml-auto text-[9px] font-bold text-[#128c80]">Change</button></div>
        </section>
        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-[#dfe5e8]">
          <h2 className="text-xs font-semibold text-[#2b3841]">Record readiness</h2>
          <div className="mt-4 space-y-3">{['Contact details captured', 'Product interest qualified', 'Account and contact resolved'].map((item) => <p key={item} className="flex items-center gap-2 text-[10px] font-medium text-[#53616a]"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#e8f7ef] text-[#167955]"><CrmIcon name="check" className="h-3 w-3" /></span>{item}</p>)}</div>
        </section>
      </aside>
    </div>
  </>;
}
