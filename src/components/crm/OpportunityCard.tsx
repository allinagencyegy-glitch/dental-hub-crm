import Link from 'next/link';
import type { Opportunity } from '@/lib/crm-ui/types';
import { formatEgp } from '@/lib/crm-ui/mock-data';
import { Avatar, Badge } from './Ui';
import { CrmIcon } from './CrmIcon';

export function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const href = opportunity.id === 'OPP-00184'
    ? '/crm/ui-preview/opportunities/OPP-00184'
    : '/crm/ui-preview/pipeline';

  return (
    <Link href={href} className={`group block rounded-xl bg-white p-4 shadow-[0_2px_10px_rgba(30,45,55,0.045)] ring-1 transition hover:-translate-y-0.5 hover:shadow-[0_10px_25px_rgba(30,45,55,0.09)] ${opportunity.isOverdue ? 'ring-[#f0c4c7]' : 'ring-[#dfe5e8]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold tracking-[-0.01em] text-[#18262f] group-hover:text-[#0c8277]">{opportunity.account}</h3>
          <p className="mt-1 text-[10px] text-[#8b969e]">{opportunity.id}</p>
        </div>
        <span aria-hidden="true" className="-mr-1 grid h-7 w-7 place-items-center rounded-md text-[#9aa4ab] group-hover:bg-[#f2f5f6]"><CrmIcon name="more" className="h-4 w-4" /></span>
      </div>
      <p className="mt-3 text-[11px] font-medium leading-4 text-[#4b5963]">{opportunity.product}</p>
      <p className="mt-2 text-[19px] font-semibold tracking-[-0.035em] text-[#17242d]">{formatEgp(opportunity.amount)}</p>
      <div className="mt-3 flex items-center justify-between border-t border-[#edf0f1] pt-3">
        <div className="flex items-center gap-2"><Avatar name={opportunity.owner} /><span className="text-[10px] font-medium text-[#65727b]">{opportunity.owner}</span></div>
        <span className="max-w-[46%] truncate text-[9px] font-medium text-[#8a959d]">{opportunity.contact}</span>
      </div>
      <div className={`mt-3 rounded-lg p-2.5 ${opportunity.isOverdue ? 'bg-[#fff0f1]' : opportunity.nextAction ? 'bg-[#f1f7f7]' : 'bg-[#f4f5f6]'}`}>
        {opportunity.nextAction ? <>
          <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.08em] ${opportunity.isOverdue ? 'text-[#c43e46]' : 'text-[#4e6f6c]'}`}><CrmIcon name={opportunity.isOverdue ? 'alert' : 'clock'} className="h-3 w-3" />{opportunity.isOverdue ? 'Overdue action' : 'Next action'}</div>
          <p className="mt-1.5 text-[10px] font-semibold text-[#35434c]">{opportunity.nextAction}</p>
          <p className={`mt-1 text-[9px] ${opportunity.isOverdue ? 'font-semibold text-[#bd454b]' : 'text-[#829098]'}`}>{opportunity.dueLabel} · {opportunity.dueAt}</p>
        </> : <div className="flex items-center gap-2 text-[10px] font-semibold text-[#8a6b48]"><CrmIcon name="alert" className="h-3.5 w-3.5" />No next action scheduled</div>}
      </div>
      {opportunity.isOnHold ? <div className="mt-3"><Badge value="ON HOLD" dot /></div> : null}
    </Link>
  );
}
