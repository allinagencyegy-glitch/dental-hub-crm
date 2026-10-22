import { ROLE_LABELS, can } from '@/server/authz/permissions';
import type { PublicUser } from '@/server/users/dto';
import { PRIMARY_NAV, SETTINGS_NAV } from './navigation';
import { SidebarNav } from './SidebarNav';
import { MobileNav } from './MobileNav';
import { BrandBlock, UserCard } from './SidebarChrome';

export function AppShell({ user, children }: { user: PublicUser; children: React.ReactNode }) {
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
          <SidebarNav title="Workspace" items={primaryNav} ariaLabel="CRM navigation" />
          <SidebarNav title="Settings" items={settingsNav} ariaLabel="CRM settings navigation" />
        </div>

        <UserCard displayName={user.displayName} roleLabel={ROLE_LABELS[user.role]} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col print:block">
        <header className="flex h-[76px] shrink-0 items-center gap-5 border-b border-[#dfe5e8] bg-white/95 px-5 backdrop-blur-xl xl:px-8 print:hidden">
          {/* No global search or notifications in this slice: both were dead
              controls and have been removed rather than left faked. */}
          <MobileNav
            primaryNav={primaryNav}
            settingsNav={settingsNav}
            displayName={user.displayName}
            roleLabel={ROLE_LABELS[user.role]}
          />
          <div className="ml-auto flex items-center gap-2.5">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-semibold text-[#26323b]">{user.displayName}</p>
              <p className="mt-0.5 text-[10px] text-[#8b969e]">{ROLE_LABELS[user.role]}</p>
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
