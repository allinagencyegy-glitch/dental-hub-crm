'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CrmIcon, type CrmIconName } from './CrmIcon';

const nav: Array<{ label: string; href?: string; icon: CrmIconName; disabled?: boolean }> = [
  { label: 'Home', href: '/crm/ui-preview', icon: 'home' },
  { label: 'Leads', href: '/crm/ui-preview/leads', icon: 'leads' },
  { label: 'Customers', href: '/crm/ui-preview/customers', icon: 'customers' },
  { label: 'Pipeline', href: '/crm/ui-preview/pipeline', icon: 'pipeline' },
  { label: 'Follow-ups', href: '/crm/ui-preview/follow-ups', icon: 'followups' },
  { label: 'Quotations', icon: 'quotation', disabled: true },
  { label: 'Reports', icon: 'reports', disabled: true },
];

const secondaryNav: Array<{ label: string; icon: CrmIconName }> = [
  { label: 'Team', icon: 'team' },
  { label: 'Settings', icon: 'settings' },
];

function isActive(pathname: string, href: string) {
  if (href === '/crm/ui-preview') return pathname === href;
  if (href.endsWith('/pipeline')) return pathname.startsWith(href) || pathname.includes('/opportunities/');
  return pathname.startsWith(href);
}

function initials(displayName: string) {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function PreviewShell({ children, displayName }: { children: React.ReactNode; displayName: string }) {
  const pathname = usePathname();

  return (
    <div className="fixed inset-0 z-[100] flex overflow-hidden bg-[#f4f6f8] text-[#17212b]">
      <aside className="hidden w-[252px] shrink-0 flex-col bg-[#101c24] text-white lg:flex">
        <div className="flex h-[76px] items-center gap-3 border-b border-white/[0.07] px-6">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#18b6a4] shadow-[0_8px_24px_rgba(24,182,164,0.22)]">
            <span className="text-lg font-bold tracking-[-0.08em]">DH</span>
          </div>
          <div>
            <p className="text-[15px] font-semibold tracking-[-0.02em]">Dental Hub</p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Sales CRM</p>
          </div>
        </div>

        <div className="px-4 pt-6">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Workspace</p>
          <nav className="space-y-1" aria-label="CRM preview navigation">
            {nav.map((item) => {
              if (!item.href || item.disabled) {
                return (
                  <span key={item.label} aria-disabled="true" className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-white/28">
                    <CrmIcon name={item.icon} className="h-[18px] w-[18px]" />
                    {item.label}
                    <span className="ml-auto rounded bg-white/[0.06] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider">Soon</span>
                  </span>
                );
              }
              const active = isActive(pathname, item.href);
              return (
                <Link key={item.label} href={item.href} aria-current={active ? 'page' : undefined} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition ${active ? 'bg-[#18b6a4] text-white shadow-[0_7px_22px_rgba(24,182,164,0.18)]' : 'text-white/62 hover:bg-white/[0.06] hover:text-white'}`}>
                  <CrmIcon name={item.icon} className={`h-[18px] w-[18px] ${active ? 'text-white' : 'text-white/42 group-hover:text-white/70'}`} />
                  {item.label}
                  {item.label === 'Follow-ups' ? <span className={`ml-auto grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold ${active ? 'bg-white text-[#0d8f82]' : 'bg-[#ef5b62] text-white'}`}>5</span> : null}
                </Link>
              );
            })}
          </nav>

          <p className="mb-2 mt-8 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Management</p>
          <nav className="space-y-1" aria-label="CRM management navigation">
            {secondaryNav.map((item) => (
              <button type="button" title="Preview only" key={item.label} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-white/55 transition hover:bg-white/[0.06] hover:text-white">
                <CrmIcon name={item.icon} className="h-[18px] w-[18px] text-white/38" />
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="mx-4 mb-4 mt-auto rounded-xl bg-white/[0.055] p-3.5 ring-1 ring-white/[0.07]">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#d8f5f1] text-xs font-bold text-[#087f73]">{initials(displayName)}</span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white">{displayName}</p>
              <p className="mt-0.5 text-[10px] text-white/40">Foundation account</p>
            </div>
            <CrmIcon name="more" className="ml-auto h-4 w-4 text-white/35" />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[76px] shrink-0 items-center gap-5 border-b border-[#dfe5e8] bg-white/95 px-5 backdrop-blur-xl xl:px-8">
          <div className="relative hidden w-full max-w-[430px] md:block">
            <CrmIcon name="search" className="absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-[#82909b]" />
            <input aria-label="Search CRM" className="h-10 w-full rounded-lg border border-[#dde3e6] bg-[#f7f9fa] pl-10 pr-16 text-[13px] text-[#24313b] outline-none transition placeholder:text-[#94a0a9] focus:border-[#18b6a4] focus:bg-white focus:ring-2 focus:ring-[#18b6a4]/10" placeholder="Search leads, accounts, contacts or opportunities..." />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-[#d8dfe3] bg-white px-1.5 py-0.5 text-[9px] font-semibold text-[#89959e]">⌘ K</kbd>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <span className="hidden items-center gap-2 rounded-full bg-[#edf9f7] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#087d71] sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-[#18b6a4] shadow-[0_0_0_3px_rgba(24,182,164,0.14)]" />
              Mock data
            </span>
            <button type="button" title="Preview notifications" className="relative grid h-10 w-10 place-items-center rounded-lg text-[#64727c] transition hover:bg-[#f1f4f5]">
              <CrmIcon name="bell" className="h-[19px] w-[19px]" />
              <span className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-[#ed5c61] ring-2 ring-white" />
            </button>
            <span className="hidden h-7 w-px bg-[#e3e8ea] sm:block" />
            <div className="hidden text-right sm:block">
              <p className="text-xs font-semibold text-[#26323b]">{displayName}</p>
              <p className="mt-0.5 text-[10px] text-[#8b969e]">Signed in via Foundation</p>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1680px] px-5 py-6 xl:px-8 xl:py-7">{children}</div>
        </main>
      </div>
    </div>
  );
}
