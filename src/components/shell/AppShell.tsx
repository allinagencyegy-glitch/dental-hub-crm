import { ROLE_LABELS, can } from '@/server/authz/permissions';
import type { PublicUser } from '@/server/users/dto';
import { PRIMARY_NAV, SETTINGS_NAV } from './navigation';
import { SidebarNav } from './SidebarNav';
import { SignOutButton } from './SignOutButton';

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

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-white/10 bg-slate-900/60 px-4 py-6 md:flex">
        <div className="mb-8 px-3">
          <p className="text-base font-semibold tracking-tight text-white">Dental Hub CRM</p>
          <p className="mt-0.5 text-xs text-slate-500">Foundation v0</p>
        </div>

        <SidebarNav title="Workspace" items={PRIMARY_NAV} />
        <SidebarNav title="Settings" items={settingsNav} />

        <p className="mt-auto px-3 text-[11px] leading-relaxed text-slate-600">
          Items marked <span className="font-semibold text-slate-500">Soon</span> are reserved and
          not yet implemented.
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-white/10 bg-slate-900/40 px-6 py-4">
          <p className="text-sm font-medium text-slate-300 md:hidden">Dental Hub CRM</p>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium text-white">{user.displayName}</p>
              <p className="text-xs text-slate-400">{ROLE_LABELS[user.role]}</p>
            </div>
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-500/20 text-xs font-semibold text-teal-200"
            >
              {initials(user.displayName)}
            </span>
            <SignOutButton />
          </div>
        </header>

        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
