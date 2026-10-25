'use client';

import { useMessages } from '@/i18n/I18nProvider';
import { SignOutButton } from './SignOutButton';

/**
 * The chrome the desktop sidebar and the mobile drawer share.
 *
 * Both surfaces must look like the same product: the same brand block at the
 * top, the same signed-in user card at the bottom, the same sign-out control.
 * They are rendered from one place so they cannot drift apart.
 */

function initials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function BrandBlock() {
  const m = useMessages();
  return (
    <div className="flex h-[76px] items-center gap-3 border-b border-white/[0.07] px-6">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#18b6a4] shadow-[0_8px_24px_rgba(24,182,164,0.22)]">
        <span className="text-lg font-bold tracking-[-0.08em]">DH</span>
      </div>
      <div>
        <p className="text-[15px] font-semibold tracking-[-0.02em]">{m.app.brand}</p>
        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">{m.app.tagline}</p>
      </div>
    </div>
  );
}

export function UserCard({ displayName, roleLabel }: { displayName: string; roleLabel: string }) {
  return (
    <div className="mx-4 mb-4 mt-auto rounded-xl bg-white/[0.055] p-3.5 ring-1 ring-white/[0.07]">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-[#d8f5f1] text-xs font-bold text-[#087f73]">
          {initials(displayName)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-white">{displayName}</p>
          <p className="mt-0.5 text-[10px] text-white/40">{roleLabel}</p>
        </div>
        <SignOutButton />
      </div>
    </div>
  );
}
