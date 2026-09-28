import { ROLE_LABELS, can } from '@/server/authz/permissions';
import type { PublicUser } from '@/server/users/dto';
import { PRIMARY_NAV, SETTINGS_NAV } from './navigation';
import { SignOutButton } from './SignOutButton';
import { CrmIcon } from '@/components/crm/CrmIcon';
import Link from 'next/link';

function initials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function AppShell({ user, children }: { user: PublicUser; children: React.ReactNode }) {
  // Only nav entries the signed-in role may actually reach are rendered.
  const settingsNav = SETTINGS_NAV.filter(
    (item) => !item.permission || can(user.role, item.permission),
  );

  const navIcons: Record<string, 'home' | 'leads' | 'customers' | 'pipeline' | 'followups' | 'quotation' | 'reports' | 'team' | 'settings'> = {
    Home: 'home',
    Leads: 'leads',
    Customers: 'customers',
    Pipeline: 'pipeline',
    'Follow-ups': 'followups',
    Quotations: 'quotation',
    Reports: 'reports',
    Team: 'team',
    Settings: 'settings',
    Users: 'settings',
  };

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
          <nav className="space-y-1" aria-label="CRM navigation">
            {PRIMARY_NAV.filter((item) => !item.permission || can(user.role, item.permission)).map((item) => {
              const Icon = navIcons[item.label] || 'home';
              if (item.status !== 'available' || !item.href) {
                return (
                  <span key={item.label} aria-disabled="true" className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-white/28">
                    <CrmIcon name={Icon} className="h-[18px] w-[18px]" />
                    {item.label}
                    <span className="ml-auto rounded bg-white/[0.06] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider">Soon</span>
                  </span>
                );
              }
              return (
                <Link key={item.label} href={item.href} className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition text-white/62 hover:bg-white/[0.06] hover:text-white">
                  <CrmIcon name={Icon} className="h-[18px] w-[18px] text-white/42 group-hover:text-white/70" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <p className="mb-2 mt-8 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Settings</p>
          <nav className="space-y-1" aria-label="CRM settings navigation">
            {settingsNav.map((item) => {
              const Icon = navIcons[item.label] || 'settings';
              if (item.status !== 'available' || !item.href) {
                return (
                  <span key={item.label} aria-disabled="true" className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-white/28">
                    <CrmIcon name={Icon} className="h-[18px] w-[18px]" />
                    {item.label}
                    <span className="ml-auto rounded bg-white/[0.06] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider">Soon</span>
                  </span>
                );
              }
              return (
                <Link key={item.label} href={item.href} className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition text-white/62 hover:bg-white/[0.06] hover:text-white">
                  <CrmIcon name={Icon} className="h-[18px] w-[18px] text-white/42 group-hover:text-white/70" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mx-4 mb-4 mt-auto rounded-xl bg-white/[0.055] p-3.5 ring-1 ring-white/[0.07]">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#d8f5f1] text-xs font-bold text-[#087f73]">{initials(user.displayName)}</span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white">{user.displayName}</p>
              <p className="mt-0.5 text-[10px] text-white/40">{ROLE_LABELS[user.role]}</p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[76px] shrink-0 items-center gap-5 border-b border-[#dfe5e8] bg-white/95 px-5 backdrop-blur-xl xl:px-8">
          <div className="relative hidden w-full max-w-[430px] md:block">
            <CrmIcon name="search" className="absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-[#82909b]" />
            <input
              aria-label="Search CRM"
              className="h-10 w-full rounded-lg border border-[#dde3e6] bg-[#f7f9fa] pl-10 pr-16 text-[13px] text-[#24313b] outline-none transition placeholder:text-[#94a0a9] focus:border-[#18b6a4] focus:bg-white focus:ring-2 focus:ring-[#18b6a4]/10"
              placeholder="Search leads, accounts, contacts or opportunities..."
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-[#d8dfe3] bg-white px-1.5 py-0.5 text-[9px] font-semibold text-[#89959e]">⌘ K</kbd>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-semibold text-[#26323b]">{user.displayName}</p>
              <p className="mt-0.5 text-[10px] text-[#8b969e]">{ROLE_LABELS[user.role]}</p>
            </div>
            <button type="button" title="Notifications" className="relative grid h-10 w-10 place-items-center rounded-lg text-[#64727c] transition hover:bg-[#f1f4f5]">
              <CrmIcon name="bell" className="h-[19px] w-[19px]" />
              <span className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-[#ed5c61] ring-2 ring-white" />
            </button>
            <span className="hidden h-7 w-px bg-[#e3e8ea] sm:block" />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1680px] px-5 py-6 xl:px-8 xl:py-7">{children}</div>
        </main>
      </div>
    </div>
  );
}
