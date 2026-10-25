import { can } from '@/server/authz/permissions';
import type { PublicUser } from '@/server/users/dto';
import { getMessages } from '@/i18n/server';
import { PRIMARY_NAV, SETTINGS_NAV } from './navigation';
import { SidebarNav } from './SidebarNav';
import { MobileNav } from './MobileNav';
import { BrandBlock, UserCard } from './SidebarChrome';
import { LanguageSwitch } from './LanguageSwitch';
import { NotificationBell } from './NotificationBell';

export async function AppShell({ user, children }: { user: PublicUser; children: React.ReactNode }) {
  const m = await getMessages();
  const roleLabel = m.roles[user.role];
  // Only nav entries the signed-in role may actually reach are rendered.
  const primaryNav = PRIMARY_NAV.filter(
    (item) => !item.permission || can(user.role, item.permission),
  );
  const settingsNav = SETTINGS_NAV.filter(
    (item) => !item.permission || can(user.role, item.permission),
  );

  return (
    // print:static/print:overflow-visible: the CRM shell is fixed and scrollable,
    // which would clip the customer-facing quotation when printing. The shell
    // chrome itself is hidden in print; the document flows normally.
    <div className="fixed inset-0 z-[100] flex overflow-hidden bg-[#f4f6f8] text-[#17212b] print:static print:overflow-visible print:bg-white">
      <aside className="hidden w-[252px] shrink-0 flex-col bg-[#101c24] text-white lg:flex print:hidden">
        <BrandBlock />

        <div className="px-4 pt-6">
          <SidebarNav title={m.nav.workspace} items={primaryNav} ariaLabel={m.nav.crmNavigation} />
          <SidebarNav title={m.nav.settings} items={settingsNav} ariaLabel={m.nav.settingsNavigation} />
        </div>

        <UserCard displayName={user.displayName} roleLabel={roleLabel} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col print:block">
        <header className="flex h-[76px] shrink-0 items-center gap-5 border-b border-[#dfe5e8] bg-white/95 px-5 backdrop-blur-xl xl:px-8 print:hidden">
          {/* No global search yet: a dead control is removed rather than faked. */}
          <MobileNav
            primaryNav={primaryNav}
            settingsNav={settingsNav}
            displayName={user.displayName}
            roleLabel={roleLabel}
          />
          <div className="ms-auto flex items-center gap-3 sm:gap-4">
            <NotificationBell />
            <LanguageSwitch className="h-8 rounded-lg border border-[#dbe2e5] bg-white px-3 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]" />
            <div className="hidden text-end sm:block">
              <p className="text-xs font-semibold text-[#26323b]">{user.displayName}</p>
              <p className="mt-0.5 text-[10px] text-[#8b969e]">{roleLabel}</p>
            </div>
          </div>
        </header>

        <main data-shell-scroll className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">
          <div className="mx-auto w-full max-w-[1680px] px-5 py-6 xl:px-8 xl:py-7 print:max-w-none print:p-0">{children}</div>
        </main>
      </div>
    </div>
  );
}
