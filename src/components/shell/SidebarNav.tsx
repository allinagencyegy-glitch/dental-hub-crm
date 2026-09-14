'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from './navigation';

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  // Reserved-but-unimplemented destinations render as inert text. No href, so
  // there is nothing to click and no fake page behind it.
  if (item.status !== 'available' || !item.href) {
    return (
      <span
        aria-disabled="true"
        title="Not available in Foundation v0"
        className="flex cursor-not-allowed select-none items-center justify-between rounded-md px-3 py-2 text-sm text-slate-500"
      >
        {item.label}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
          Soon
        </span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'block rounded-md bg-teal-500/15 px-3 py-2 text-sm font-medium text-teal-200'
          : 'block rounded-md px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white'
      }
    >
      {item.label}
    </Link>
  );
}

export function SidebarNav({ title, items }: { title: string; items: NavItem[] }) {
  const pathname = usePathname();
  if (items.length === 0) return null;

  return (
    <div className="mb-6">
      <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </p>
      <nav className="flex flex-col gap-0.5">
        {items.map((item) => (
          <NavLink key={item.label} item={item} active={item.href === pathname} />
        ))}
      </nav>
    </div>
  );
}
