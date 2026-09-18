import Link from 'next/link';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { Avatar, Badge, MetricCard, PageHeader, SectionTitle } from '@/components/crm/Ui';
import { dashboardMetrics, followUps, formatEgp, leads, opportunities } from '@/lib/crm-ui/mock-data';
import type { OpportunityStage } from '@/lib/crm-ui/types';
import { requireSession } from '@/server/auth/dal';

const stageMeta: Record<OpportunityStage, { label: string; color: string }> = {
  QUALIFICATION: { label: 'Qualification', color: 'bg-[#8266d4]' },
  QUOTATION: { label: 'Quotation', color: 'bg-[#4295cc]' },
  NEGOTIATION: { label: 'Negotiation', color: 'bg-[#e58b49]' },
};

export default async function PreviewHomePage() {
  const session = await requireSession();
  const firstName = session.user.displayName.trim().split(/\s+/)[0] || session.user.displayName;
  const activeOpportunities = opportunities.filter((item) => !item.isOnHold);
  const todayTasks = followUps.filter((item) => item.status === 'OVERDUE' || item.status === 'TODAY').slice(0, 4);

  return (
    <>
      <PageHeader eyebrow="Sales workspace" title={`Good morning, ${firstName}`} description="Here’s what needs your attention across the sales floor today." actionLabel="Add new lead" />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <MetricCard label="New leads" value={String(dashboardMetrics.newLeads)} helper="+4 since yesterday" icon="leads" tone="blue" />
        <MetricCard label="Open opportunities" value={String(dashboardMetrics.openOpportunities)} helper="Across 3 active stages" icon="target" tone="violet" />
        <MetricCard label="Pipeline value" value={formatEgp(dashboardMetrics.pipelineValue)} helper="Raw expected value" icon="money" tone="teal" />
        <MetricCard label="Due today" value={String(dashboardMetrics.dueToday)} helper="Next action at 1:00 PM" icon="calendar" tone="amber" />
        <MetricCard label="Overdue" value={String(dashboardMetrics.overdue)} helper="Needs attention now" icon="alert" tone="red" warning />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.42fr_1fr]">
        <div className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,.04)] ring-1 ring-[#dfe5e8]">
          <SectionTitle title="Today’s actions" subtitle="Prioritized by due time and sales impact" href="/crm/ui-preview/follow-ups" />
          <div className="divide-y divide-[#edf0f1]">
            {todayTasks.map((task) => (
              <div key={task.id} className="group flex items-center gap-3.5 px-5 py-3.5 transition hover:bg-[#fafcfc]">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${task.status === 'OVERDUE' ? 'bg-[#ffeaeb] text-[#c13f47]' : 'bg-[#eaf5f3] text-[#168477]'}`}>
                  <CrmIcon name={task.type === 'Call' ? 'phone' : task.type === 'WhatsApp' ? 'message' : task.type === 'Meeting' ? 'meeting' : 'mail'} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><p className="truncate text-[12px] font-semibold text-[#27343d]">{task.customer}</p>{task.status === 'OVERDUE' ? <Badge value="OVERDUE" /> : null}</div>
                  <p className="mt-1 truncate text-[10px] text-[#7f8b94]">{task.notes}</p>
                </div>
                <div className="hidden text-right sm:block"><p className={`text-[11px] font-semibold ${task.status === 'OVERDUE' ? 'text-[#c34047]' : 'text-[#35434c]'}`}>{task.dueTime}</p><p className="mt-1 text-[9px] text-[#98a1a8]">{task.assignedRep}</p></div>
                <button type="button" title="Preview only" className="grid h-8 w-8 place-items-center rounded-full border border-[#dfe5e8] text-[#829099] opacity-0 transition group-hover:opacity-100"><CrmIcon name="check" className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl bg-[#132932] text-white shadow-[0_10px_28px_rgba(19,41,50,.13)]">
          <div className="flex items-start justify-between px-5 py-4">
            <div><h2 className="text-sm font-semibold">Pipeline snapshot</h2><p className="mt-0.5 text-[10px] text-white/45">Active opportunities by stage</p></div>
            <Link href="/crm/ui-preview/pipeline" className="text-[10px] font-bold text-[#70d8cc]">Open pipeline →</Link>
          </div>
          <div className="px-5 pb-4">
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/38">Total open value</p>
            <p className="mt-1 text-[27px] font-semibold tracking-[-0.04em]">{formatEgp(dashboardMetrics.pipelineValue)}</p>
          </div>
          <div className="space-y-4 bg-white/[0.045] px-5 py-5">
            {(Object.keys(stageMeta) as OpportunityStage[]).map((stage) => {
              const items = activeOpportunities.filter((item) => item.stage === stage);
              const total = items.reduce((sum, item) => sum + item.amount, 0);
              const percent = (total / dashboardMetrics.pipelineValue) * 100;
              return <div key={stage}><div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-medium text-white/72">{stageMeta[stage].label}</span><span className="text-[10px] font-semibold text-white/85">{formatEgp(total)} · {items.length}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${stageMeta[stage].color}`} style={{ width: `${percent}%` }} /></div></div>;
            })}
          </div>
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(20,35,45,.04)] ring-1 ring-[#dfe5e8]">
        <SectionTitle title="Recent leads" subtitle="Latest inbound demand across active channels" href="/crm/ui-preview/leads" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left">
            <thead className="bg-[#f8fafb] text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]"><tr><th className="px-5 py-2.5">Lead</th><th className="px-3 py-2.5">Interest</th><th className="px-3 py-2.5">Source</th><th className="px-3 py-2.5">Owner</th><th className="px-3 py-2.5">Status</th><th className="px-5 py-2.5 text-right">Received</th></tr></thead>
            <tbody className="divide-y divide-[#edf0f1]">
              {leads.slice(0, 5).map((lead) => <tr key={lead.id} className="transition hover:bg-[#fafcfc]"><td className="px-5 py-3"><Link href={lead.id === 'LEAD-00311' ? '/crm/ui-preview/leads/LEAD-00311' : '/crm/ui-preview/leads'} className="flex items-center gap-3"><Avatar name={lead.name} /><div><p className="text-[11px] font-semibold text-[#24313a] hover:text-[#0b887c]">{lead.business}</p><p className="mt-0.5 text-[9px] text-[#8a959d]">{lead.name} · {lead.id}</p></div></Link></td><td className="px-3 py-3 text-[10px] font-medium text-[#4e5c66]">{lead.productInterest}</td><td className="px-3 py-3"><Badge value={lead.source} /></td><td className="px-3 py-3 text-[10px] text-[#5f6c75]">{lead.owner}</td><td className="px-3 py-3"><Badge value={lead.status} dot /></td><td className="px-5 py-3 text-right"><p className="text-[10px] font-medium text-[#56636c]">{lead.receivedAt}</p><p className="mt-0.5 text-[9px] text-[#99a2a9]">{lead.receivedDate}</p></td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
