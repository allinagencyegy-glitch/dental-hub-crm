import Link from 'next/link';
import type { CustomerLifecycle, FollowUpStatus, LeadSource, LeadStatus, OpportunityStage } from '@/lib/crm-ui/types';
import { CrmIcon, type CrmIconName } from './CrmIcon';

type BadgeValue = LeadStatus | OpportunityStage | CustomerLifecycle | FollowUpStatus | LeadSource | 'ON HOLD';

const badgeStyles: Record<BadgeValue, string> = {
  NEW: 'bg-[#e9f7ff] text-[#137aa9]', CONTACTED: 'bg-[#fff4d9] text-[#9a6a00]', CONVERTED: 'bg-[#e8f8f1] text-[#14815f]',
  QUALIFICATION: 'bg-[#f1edff] text-[#6d52be]', QUOTATION: 'bg-[#e8f4ff] text-[#287bb5]', NEGOTIATION: 'bg-[#fff0e5] text-[#b45b1b]',
  PROSPECT: 'bg-[#f0edff] text-[#6c52b5]', CUSTOMER: 'bg-[#e6f8f2] text-[#118060]',
  OVERDUE: 'bg-[#ffeaeb] text-[#bd3941]', TODAY: 'bg-[#fff3dc] text-[#9e6700]', UPCOMING: 'bg-[#e9f4ff] text-[#2476ac]', COMPLETED: 'bg-[#e8f7ef] text-[#167955]',
  Facebook: 'bg-[#e9f2ff] text-[#2769b2]', WhatsApp: 'bg-[#e6f8ee] text-[#168254]', Instagram: 'bg-[#f9eafa] text-[#9b408e]', Exhibition: 'bg-[#fff0e4] text-[#a9581e]', Phone: 'bg-[#edf0ff] text-[#555fba]',
  'ON HOLD': 'bg-[#edf0f2] text-[#63707a]',
};

export function Badge({ value, dot = false }: { value: BadgeValue; dot?: boolean }) {
  return <span className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[9px] font-bold tracking-[0.08em] ${badgeStyles[value]}`}>{dot ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" /> : null}{value}</span>;
}

export function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name.replace('Dr. ', '').split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const sizes = { sm: 'h-7 w-7 text-[9px]', md: 'h-9 w-9 text-[10px]', lg: 'h-14 w-14 text-sm' };
  return <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full bg-[#dff4f1] font-bold text-[#087c71] ring-1 ring-[#bce6df] ${sizes[size]}`}>{initials}</span>;
}

export function PageHeader({ eyebrow, title, description, actionLabel, actionIcon = 'plus' }: { eyebrow?: string; title: string; description: string; actionLabel?: string; actionIcon?: CrmIconName }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#18a897]">{eyebrow}</p> : null}
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[#16232c]">{title}</h1>
        <p className="mt-1 text-[12px] text-[#75828c]">{description}</p>
      </div>
      {actionLabel ? <button type="button" title="Preview only — changes are not saved" className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#132932] px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1b3944]"><CrmIcon name={actionIcon} className="h-4 w-4" />{actionLabel}</button> : null}
    </div>
  );
}

export function MetricCard({ label, value, helper, icon, tone = 'teal', warning = false }: { label: string; value: string; helper: string; icon: CrmIconName; tone?: 'teal' | 'blue' | 'violet' | 'amber' | 'red'; warning?: boolean }) {
  const tones = { teal: 'bg-[#e6f7f4] text-[#0a897c]', blue: 'bg-[#eaf4fd] text-[#2a79ad]', violet: 'bg-[#f1edff] text-[#7057b8]', amber: 'bg-[#fff3dd] text-[#a16800]', red: 'bg-[#ffe9ea] text-[#c43f47]' };
  return (
    <div className={`rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(20,35,45,0.04),0_7px_24px_rgba(20,35,45,0.035)] ${warning ? 'ring-1 ring-[#f4c7ca]' : 'ring-1 ring-[#e4e9eb]'}`}>
      <div className="flex items-start justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.11em] text-[#7e8992]">{label}</p>
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${tones[tone]}`}><CrmIcon name={icon} className="h-4 w-4" /></span>
      </div>
      <p className={`mt-3 text-[25px] font-semibold tracking-[-0.045em] ${warning ? 'text-[#be3d45]' : 'text-[#17242c]'}`}>{value}</p>
      <p className="mt-1 text-[10px] text-[#87929a]">{helper}</p>
    </div>
  );
}

export function SectionTitle({ title, subtitle, href, linkLabel = 'View all' }: { title: string; subtitle?: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[#e7ebed] px-5 py-4">
      <div><h2 className="text-sm font-semibold tracking-[-0.015em] text-[#1c2831]">{title}</h2>{subtitle ? <p className="mt-0.5 text-[10px] text-[#8a959d]">{subtitle}</p> : null}</div>
      {href ? <Link href={href} className="flex items-center gap-1 text-[10px] font-bold text-[#118e82] transition hover:text-[#08756b]">{linkLabel}<CrmIcon name="arrow" className="h-3 w-3" /></Link> : null}
    </div>
  );
}

export function Toolbar({ placeholder, children }: { placeholder: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-t-xl border border-[#dfe5e8] bg-white p-3.5">
      <div className="relative min-w-[260px] flex-1 sm:max-w-[390px]">
        <CrmIcon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8e99a1]" />
        <input aria-label={placeholder} placeholder={placeholder} className="h-9 w-full rounded-lg border border-[#dfe4e7] bg-[#f8fafb] pl-9 pr-3 text-[11px] outline-none focus:border-[#19ad9d] focus:bg-white" />
      </div>
      {children}
      <button type="button" title="Preview filter" className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg border border-[#dce2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"><CrmIcon name="filter" className="h-3.5 w-3.5" />More filters</button>
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="mb-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#6f7d86] transition hover:text-[#118e82]"><CrmIcon name="arrow" className="h-3.5 w-3.5 rotate-180" />{label}</Link>;
}

export function DetailAction({ icon, children, primary = false }: { icon: CrmIconName; children: React.ReactNode; primary?: boolean }) {
  return <button type="button" title="Preview only — changes are not saved" className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-[11px] font-semibold transition ${primary ? 'bg-[#132932] text-white hover:bg-[#1b3944]' : 'border border-[#dbe2e5] bg-white text-[#53616b] hover:bg-[#f7f9fa]'}`}><CrmIcon name={icon} className="h-3.5 w-3.5" />{children}</button>;
}

export function InfoLine({ icon, label, value }: { icon: CrmIconName; label: string; value: string }) {
  return <div className="flex gap-3 py-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f0f4f5] text-[#6a7881]"><CrmIcon name={icon} className="h-3.5 w-3.5" /></span><div><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#9aa3aa]">{label}</p><p className="mt-0.5 text-[11px] font-medium text-[#33414a]">{value}</p></div></div>;
}
