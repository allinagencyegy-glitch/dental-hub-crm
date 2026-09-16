import { CrmIcon } from '@/components/crm/CrmIcon';
import { OpportunityCard } from '@/components/crm/OpportunityCard';
import { PageHeader } from '@/components/crm/Ui';
import { formatEgp, opportunities } from '@/lib/crm-ui/mock-data';
import type { OpportunityStage } from '@/lib/crm-ui/types';

const stages: Array<{ id: OpportunityStage; label: string; dot: string }> = [
  { id: 'QUALIFICATION', label: 'Qualification', dot: 'bg-[#846bd0]' },
  { id: 'QUOTATION', label: 'Quotation', dot: 'bg-[#4193c8]' },
  { id: 'NEGOTIATION', label: 'Negotiation', dot: 'bg-[#e48b4d]' },
];

export default function PipelinePage() {
  const active = opportunities.filter((item) => !item.isOnHold);
  const onHold = opportunities.filter((item) => item.isOnHold);
  return <>
    <PageHeader eyebrow="Revenue pipeline" title="Sales pipeline" description="Move every qualified opportunity toward a clear commercial decision." actionLabel="New opportunity" />
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-[#dfe5e8]">
      <div className="flex items-center gap-1"><button type="button" className="rounded-lg bg-[#142b34] px-3 py-2 text-[10px] font-semibold text-white">Active pipeline <span className="ml-1.5 text-white/55">{active.length}</span></button><button type="button" className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold text-[#6b7881] hover:bg-[#f4f6f7]"><CrmIcon name="pause" className="h-3 w-3" />On hold <span className="text-[#a0a8ae]">{onHold.length}</span></button></div>
      <div className="flex items-center gap-2"><button type="button" className="rounded-lg border border-[#dfe4e7] px-3 py-2 text-[10px] font-semibold text-[#5f6c75]">All owners</button><button type="button" className="rounded-lg border border-[#dfe4e7] px-3 py-2 text-[10px] font-semibold text-[#5f6c75]">All products</button><span className="mx-1 h-5 w-px bg-[#e4e8ea]" /><p className="text-[10px] text-[#8c969d]">Total <strong className="ml-1 font-semibold text-[#26333c]">{formatEgp(active.reduce((sum, item) => sum + item.amount, 0))}</strong></p></div>
    </div>
    <div className="grid gap-4 xl:grid-cols-3">
      {stages.map((stage) => {
        const items = active.filter((item) => item.stage === stage.id);
        const total = items.reduce((sum, item) => sum + item.amount, 0);
        return <section key={stage.id} className="min-w-0 rounded-xl bg-[#e9edef]/75 p-3 ring-1 ring-[#dce2e5]"><div className="mb-3 flex items-center justify-between px-1 py-1"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${stage.dot}`} /><h2 className="text-[10px] font-bold uppercase tracking-[0.11em] text-[#53616a]">{stage.label}</h2><span className="grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[9px] font-bold text-[#728089]">{items.length}</span></div><p className="text-[10px] font-semibold text-[#68757e]">{formatEgp(total)}</p></div><div className="space-y-3">{items.map((item) => <OpportunityCard key={item.id} opportunity={item} />)}<button type="button" title="Preview only" className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#c8d0d4] text-[10px] font-semibold text-[#7f8b93] transition hover:border-[#18ad9d] hover:text-[#10887c]"><CrmIcon name="plus" className="h-3.5 w-3.5" />Add opportunity</button></div></section>;
      })}
    </div>
    <section className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-dashed border-[#cbd3d7] bg-[#eef1f2] px-4 py-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-[#77848d]"><CrmIcon name="pause" className="h-4 w-4" /></span><div><h2 className="text-[11px] font-semibold text-[#45535c]">On hold opportunities</h2><p className="mt-0.5 text-[9px] text-[#8a959d]">Kept outside the active stages until work can resume</p></div><div className="ml-auto flex items-center gap-3"><p className="text-[10px] text-[#76838b]"><strong className="text-[#3f4d56]">{onHold.length}</strong> opportunity · <strong className="text-[#3f4d56]">{formatEgp(onHold.reduce((sum, item) => sum + item.amount, 0))}</strong></p><button type="button" className="rounded-lg bg-white px-3 py-2 text-[10px] font-semibold text-[#53616a] ring-1 ring-[#dbe1e4]">View on hold</button></div></section>
  </>;
}
