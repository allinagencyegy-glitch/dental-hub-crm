'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from './navigation';
import { isNavItemActive } from './nav-active';
import { CrmIcon } from '@/components/crm/CrmIcon';

const navIcons: Record<string, 'home' | 'leads' | 'customers' | 'pipeline' | 'opportunities' | 'followups' | 'quotation' | 'reports' | 'team' | 'settings'> = {
  Home: 'home',
  Leads: 'leads',
  Customers: 'customers',
  Pipeline: 'pipeline',
  Opportunities: 'opportunities',
  'Follow-ups': 'followups',
  Quotations: 'quotation',
  Reports: 'reports',
  Team: 'team',
  Settings: 'settings',
  Users: 'settings',
  Password: 'settings',
};

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = navIcons[item.label] || 'home';
  // Reserved-but-unimplemented destinations render as inert text. No href, so
  // there is nothing to click and no fake page behind it.
  if (item.status !== 'available' || !item.href) {
    return (
      <span
        aria-disabled="true"
        title="Not yet implemented"
        className="flex cursor-not-allowed select-none items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-white/28"
      >
        <CrmIcon name={Icon} className="h-[18px] w-[18px]" />
        {item.label}
        <span className="ml-auto rounded bg-white/[0.06] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider">Soon</span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition ${active ? 'bg-[#18b6a4] text-white shadow-[0_7px_22px_rgba(24,182,164,0.18)]' : 'text-white/62 hover:bg-white/[0.06] hover:text-white'}`}
    >
      <CrmIcon name={Icon} className={`h-[18px] w-[18px] ${active ? 'text-white' : 'text-white/42 group-hover:text-white/70'}`} />
      {item.label}
    </Link>
  );
}

export function SidebarNav({
  title,
  items,
  ariaLabel,
  onNavigate,
}: {
  title: string;
  items: NavItem[];
  ariaLabel?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  if (items.length === 0) return null;

  return (
    <div className="mb-6">
      <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
        {title}
      </p>
      <nav className="space-y-1" aria-label={ariaLabel ?? title}>
        {items.map((item) => (
          <NavLink
            key={item.label}
            item={item}
            active={isNavItemActive(pathname, item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
    </div>
  );
}
