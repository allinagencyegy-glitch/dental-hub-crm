import Link from 'next/link';
import { Avatar, Badge, PageHeader, Toolbar } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { leads } from '@/lib/crm-ui/mock-data';

const filters = ['All', 'New', 'Contacted', 'Converted'];

export default function LeadsPage() {
  return <>
    <PageHeader eyebrow="Lead management" title="Lead inbox" description="Qualify incoming interest and keep every first response on track." actionLabel="Add lead" />
    <div className="flex items-center gap-1 border-b border-[#dce3e6]">
      {filters.map((filter, index) => <button type="button" key={filter} className={`relative px-4 pb-3 text-[11px] font-semibold transition ${index === 0 ? 'text-[#128d81]' : 'text-[#7b8790] hover:text-[#33414a]'}`}>{filter}<span className={`ml-2 rounded-full px-1.5 py-0.5 text-[9px] ${index === 0 ? 'bg-[#def4f0] text-[#0c8176]' : 'bg-[#e9edef] text-[#78858e]'}`}>{index === 0 ? leads.length : leads.filter((item) => item.status === filter.toUpperCase()).length}</span>{index === 0 ? <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#18b6a4]" /> : null}</button>)}
    </div>
    <div className="mt-4 overflow-hidden rounded-xl shadow-[0_1px_2px_rgba(20,35,45,.04)]">
      <Toolbar placeholder="Search by account, contact, phone or reference...">
        <button type="button" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dce2e5] bg-white px-3 text-[11px] font-semibold text-[#5b6871]"><span className="h-2 w-2 rounded-full bg-[#18b6a4]" />All sources<CrmIcon name="chevron" className="h-3 w-3 rotate-90" /></button>
      </Toolbar>
      <div className="overflow-hidden border-x border-b border-[#dfe5e8] bg-white">
        <table className="w-full table-fixed text-left">
          <colgroup><col className="w-[13%]" /><col className="w-[23%]" /><col className="w-[14%]" /><col className="w-[19%]" /><col className="w-[14%]" /><col className="w-[11%]" /><col className="w-[6%]" /></colgroup>
          <thead className="border-b border-[#e5eaec] bg-[#f8fafb] text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]"><tr><th className="px-4 py-3">Reference</th><th className="px-3 py-3">Contact / Account</th><th className="px-3 py-3">Source</th><th className="px-3 py-3">Product interest</th><th className="px-3 py-3">Owner</th><th className="px-3 py-3">Status</th><th className="px-2 py-3 text-center">Actions</th></tr></thead>
          <tbody className="divide-y divide-[#edf0f1]">
            {leads.map((lead) => { const href = lead.id === 'LEAD-00311' ? '/crm/ui-preview/leads/LEAD-00311' : '/crm/ui-preview/leads'; return <tr key={lead.id} className="group transition hover:bg-[#f9fbfb]"><td className="px-4 py-3.5"><Link href={href} className="text-[10px] font-bold text-[#188c81] hover:underline">{lead.id}</Link><p className="mt-1 text-[9px] leading-3 text-[#929da4]">{lead.receivedDate}</p><p className="text-[9px] leading-3 text-[#929da4]">{lead.receivedAt}</p></td><td className="px-3 py-3.5"><div className="flex min-w-0 items-center gap-2.5"><Avatar name={lead.name} size="md" /><div className="min-w-0"><Link href={href} className="block truncate text-[11px] font-semibold text-[#202e37] hover:text-[#0e897e]">{lead.business}</Link><p className="mt-0.5 truncate text-[9px] text-[#68757e]">{lead.name}</p><p className="truncate text-[9px] text-[#929da4]">{lead.phone}</p></div></div></td><td className="px-3 py-3.5"><Badge value={lead.source} /><p className="mt-1 text-[9px] text-[#7f8b93]">{lead.channel}</p></td><td className="px-3 py-3.5 text-[10px] font-medium leading-4 text-[#394750]">{lead.productInterest}</td><td className="px-3 py-3.5"><div className="flex min-w-0 items-center gap-2"><Avatar name={lead.owner} /><span className="truncate text-[10px] text-[#53616a]">{lead.owner}</span></div></td><td className="px-3 py-3.5"><Badge value={lead.status} dot /></td><td className="px-2 py-3.5"><button type="button" title="Preview actions" className="mx-auto grid h-7 w-7 place-items-center rounded-md text-[#94a0a8] opacity-20 transition group-hover:bg-white group-hover:opacity-100"><CrmIcon name="more" className="h-4 w-4" /></button></td></tr>; })}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-[#edf0f1] px-4 py-3"><p className="text-[10px] text-[#89949c]">Showing 1–{leads.length} of {leads.length} leads</p><div className="flex gap-1"><button type="button" className="h-7 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] text-[#9aa3aa]">Previous</button><button type="button" className="h-7 rounded-md border border-[#dfe4e7] px-2.5 text-[9px] font-semibold text-[#53616a]">Next</button></div></div>
      </div>
    </div>
  </>;
}
